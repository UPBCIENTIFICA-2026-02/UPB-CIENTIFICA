const path = require("path");
const { puedeLeer, puedeEscribir } = require("./permisos");
const {
    NoEncontrado, PermisoDenegado, CuotaExcedida, SolicitudInvalida,
    RangoNoSatisfacible,
} = require("./errores");

/**
 * Capa de dominio: reglas de negocio puras (cuotas, permisos, versionado).
 * No conoce HTTP, ni SQL, ni el sistema de archivos.
 *
 * QUÉ ES "root" (decisión necesaria para que node-media y node-sync encajen):
 * la raíz es el Home DEL USUARIO que pregunta, no un directorio compartido por
 * todos. El esquema ya lo daba a entender —el índice único de la raíz es
 * (propietario, nombre)— y es lo coherente con el resto del sistema:
 * node-sync escribe en /srv/home/<uid> y node-media indexa "el Home del
 * usuario". Antes `listarDirectorio("root")` devolvía los nodos raíz de TODOS
 * los usuarios filtrados por permisos, así que el indexador de node-media
 * acababa registrando archivos ajenos como propios.
 */
class ArchivoService {
    constructor({ metadatos, almacenamiento, cuotas }) {
        this.metadatos = metadatos;
        this.almacenamiento = almacenamiento;
        this.cuotas = cuotas;
    }

    /**
     * Forma pública de un nodo.
     *
     * `propietario`, `grupo` y `permisos` se exponen porque node-media necesita
     * los tres para aplicar EL MISMO modelo de permisos Unix que este servicio;
     * sin ellos tendría que inventarse una regla propia, que es justo el error
     * que advierte dominio/permisos.js.
     */
    #aDto(nodo) {
        return {
        id: nodo.id,
        nombre: nodo.nombre,
        tipo: nodo.tipo,
        tamanoBytes: Number(nodo.tamano_bytes),
        version: nodo.version,
        directorioContenedorId: nodo.directorio_contenedor_id,
        propietario: nodo.propietario,
        grupo: nodo.grupo,
        permisos: nodo.permisos,
        };
    }

    async #obtenerOFallar(id) {
        const nodo = await this.metadatos.buscarPorId(id);
        if (!nodo) throw new NoEncontrado(`nodo ${id}`);
        return nodo;
    }

    async listarDirectorio(directorioId, usuario) {
        if (directorioId === "root") {
        // Solo el Home del usuario: ver la nota de la cabecera de la clase.
        const hijos = await this.metadatos.listarHijosRaiz(usuario.id);
        return hijos.filter((n) => puedeLeer(n, usuario)).map((n) => this.#aDto(n));
        }

        const directorio = await this.#obtenerOFallar(directorioId);
        if (directorio.tipo !== "directorio") {
        throw new SolicitudInvalida("El identificador no corresponde a un directorio");
        }
        if (!puedeLeer(directorio, usuario)) throw new PermisoDenegado("listar el directorio");

        const hijos = await this.metadatos.listarHijos(directorioId);
        return hijos.filter((n) => puedeLeer(n, usuario)).map((n) => this.#aDto(n));
    }

    async subirArchivo({ nombre, buffer, directorioDestino, sobrescribir }, usuario) {
        if (!nombre || !buffer) throw new SolicitudInvalida("Falta el archivo o su nombre");

        const contenedorId = directorioDestino === "root" ? null : directorioDestino;

        // En la raíz no hay nodo contenedor que consultar: cada usuario escribe
        // en su propio Home, así que no hace falta comprobar permisos. Dentro de
        // un directorio sí, porque puede ser de otro usuario.
        if (contenedorId) {
        const contenedor = await this.#obtenerOFallar(contenedorId);
        if (contenedor.tipo !== "directorio") {
            throw new SolicitudInvalida("El destino no es un directorio");
        }
        if (!puedeEscribir(contenedor, usuario)) {
            throw new PermisoDenegado("escribir en el directorio destino");
        }
        }

        // --- Control de cuota (RF-04) ---
        const usados = await this.metadatos.espacioUsado(usuario.id);
        const cuota = this.cuotas.cuotaDe(usuario.id);
        const existente = await this.metadatos.buscarPorNombreEnDirectorio(
        nombre, contenedorId, usuario.id
        );
        const tamanoLiberado = existente ? Number(existente.tamano_bytes) : 0;
        if (usados - tamanoLiberado + buffer.length > cuota) {
        throw new CuotaExcedida(usados, cuota);
        }

        if (existente && !sobrescribir) {
        throw new SolicitudInvalida(
            "Ya existe un archivo con ese nombre; use sobrescribir=true para versionarlo"
        );
        }

        if (existente) {
        const rutaRelativa = path.posix.join(
            usuario.id, `${existente.id}.v${existente.version + 1}`
        );
        const { tamanoBytes } = await this.almacenamiento.guardar(rutaRelativa, buffer);
        const actualizado = await this.metadatos.nuevaVersion(
            existente.id, tamanoBytes, rutaRelativa
        );
        return this.#aDto(actualizado);
        }

        const nodo = await this.metadatos.crear({
        nombre, tipo: "archivo", propietario: usuario.id,
        grupo: usuario.grupos?.[0] || "usuarios", permisos: "rw-r-----",
        tamanoBytes: 0, directorioContenedorId: contenedorId, rutaFisica: null,
        });

        const rutaRelativa = path.posix.join(usuario.id, `${nodo.id}.v1`);
        const { tamanoBytes } = await this.almacenamiento.guardar(rutaRelativa, buffer);
        const definitivo = await this.metadatos.fijarContenido(
        nodo.id, tamanoBytes, rutaRelativa
        );

        return this.#aDto(definitivo);
    }

    /**
     * Abre el contenido de un archivo, entero o por tramos.
     *
     * `rango` viene ya parseado de la capa de rutas: { inicio, fin }, donde
     * cualquiera de los dos puede ser null ("desde aquí hasta el final" o "los
     * últimos N bytes"). El dominio es quien resuelve esos nulos porque es quien
     * conoce el tamaño del archivo.
     */
    async descargarArchivo(archivoId, usuario, rango = null) {
        const nodo = await this.#obtenerOFallar(archivoId);
        if (nodo.tipo !== "archivo") throw new SolicitudInvalida("El recurso no es un archivo");
        if (!puedeLeer(nodo, usuario)) throw new PermisoDenegado("descargar el archivo");

        const total = Number(nodo.tamano_bytes);

        if (!rango) {
        return {
            nombre: nodo.nombre,
            tamanoBytes: total,
            flujo: this.almacenamiento.abrirLectura(nodo.ruta_fisica),
            parcial: false,
        };
        }

        let inicio;
        let fin;

        if (rango.inicio === null) {
        // Sufijo: "bytes=-500" son los últimos 500 bytes.
        const solicitados = Math.min(rango.fin, total);
        inicio = total - solicitados;
        fin = total - 1;
        } else {
        inicio = rango.inicio;
        fin = rango.fin === null ? total - 1 : Math.min(rango.fin, total - 1);
        }

        if (total === 0 || inicio > fin || inicio < 0 || inicio >= total) {
        throw new RangoNoSatisfacible(total);
        }

        return {
        nombre: nodo.nombre,
        tamanoBytes: total,
        flujo: this.almacenamiento.abrirLectura(nodo.ruta_fisica, { inicio, fin }),
        parcial: true,
        inicio,
        fin,
        longitud: fin - inicio + 1,
        };
    }

    async eliminarArchivo(archivoId, usuario) {
        const nodo = await this.#obtenerOFallar(archivoId);

        // La ruta dice "archivos": un directorio se borraría en cascada con todo
        // su contenido, que no es lo que pide quien llama a este endpoint.
        if (nodo.tipo !== "archivo") {
        throw new SolicitudInvalida("El recurso no es un archivo");
        }
        if (!puedeEscribir(nodo, usuario)) throw new PermisoDenegado("eliminar el archivo");

        await this.almacenamiento.eliminar(nodo.ruta_fisica);
        await this.metadatos.eliminar(archivoId);
    }

    async crearDirectorio(nombre, directorioPadreId, usuario) {
        if (!nombre) throw new SolicitudInvalida("Falta el nombre del directorio");
        const contenedorId = directorioPadreId === "root" ? null : directorioPadreId;

        if (contenedorId) {
        const padre = await this.#obtenerOFallar(contenedorId);
        if (padre.tipo !== "directorio") {
            throw new SolicitudInvalida("El padre no es un directorio");
        }
        if (!puedeEscribir(padre, usuario)) {
            throw new PermisoDenegado("crear en el directorio padre");
        }
        }

        const nodo = await this.metadatos.crear({
        nombre, tipo: "directorio", propietario: usuario.id,
        grupo: usuario.grupos?.[0] || "usuarios", permisos: "rwxr-----",
        tamanoBytes: 0, directorioContenedorId: contenedorId, rutaFisica: null,
        });
        return this.#aDto(nodo);
    }

    async consultarCuota(usuario) {
        const usados = await this.metadatos.espacioUsado(usuario.id);
        const cuota = this.cuotas.cuotaDe(usuario.id);
        return { usados, cuota, disponibles: Math.max(0, cuota - usados) };
    }
}

module.exports = ArchivoService;
