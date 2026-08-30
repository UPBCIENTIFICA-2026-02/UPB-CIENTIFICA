const path = require("path");
const { puedeLeer, puedeEscribir } = require("./permisos");
const {
    NoEncontrado, PermisoDenegado, CuotaExcedida, SolicitudInvalida,
} = require("./errores");

/**
 * Capa de dominio: reglas de negocio puras (cuotas, permisos, versionado).
 * No conoce HTTP, ni SQL, ni el sistema de archivos.
 */
class ArchivoService {
    constructor({ metadatos, almacenamiento, cuotas }) {
        this.metadatos = metadatos;
        this.almacenamiento = almacenamiento;
        this.cuotas = cuotas;
    }

    #aDto(nodo) {
        return {
        id: nodo.id,
        nombre: nodo.nombre,
        tipo: nodo.tipo,
        tamanoBytes: Number(nodo.tamano_bytes),
        version: nodo.version,
        directorioContenedorId: nodo.directorio_contenedor_id,
        };
    }

    async #obtenerOFallar(id) {
        const nodo = await this.metadatos.buscarPorId(id);
        if (!nodo) throw new NoEncontrado(`nodo ${id}`);
        return nodo;
    }

    async listarDirectorio(directorioId, usuario) {
        if (directorioId === "root") {
        const hijos = await this.metadatos.listarHijos(null);
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

        if (contenedorId) {
        const contenedor = await this.#obtenerOFallar(contenedorId);
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

    async descargarArchivo(archivoId, usuario) {
        const nodo = await this.#obtenerOFallar(archivoId);
        if (nodo.tipo !== "archivo") throw new SolicitudInvalida("El recurso no es un archivo");
        if (!puedeLeer(nodo, usuario)) throw new PermisoDenegado("descargar el archivo");

        return {
        nombre: nodo.nombre,
        tamanoBytes: Number(nodo.tamano_bytes),
        flujo: this.almacenamiento.abrirLectura(nodo.ruta_fisica),
        };
    }

    async eliminarArchivo(archivoId, usuario) {
        const nodo = await this.#obtenerOFallar(archivoId);
        if (!puedeEscribir(nodo, usuario)) throw new PermisoDenegado("eliminar el archivo");

        await this.almacenamiento.eliminar(nodo.ruta_fisica);
        await this.metadatos.eliminar(archivoId);
    }

    async crearDirectorio(nombre, directorioPadreId, usuario) {
        if (!nombre) throw new SolicitudInvalida("Falta el nombre del directorio");
        const contenedorId = directorioPadreId === "root" ? null : directorioPadreId;

        if (contenedorId) {
        const padre = await this.#obtenerOFallar(contenedorId);
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