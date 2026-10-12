const {
    NoEncontrado, SinPermisoCompartir, DestinatarioInexistente, YaCompartido,
    SolicitudInvalida,
} = require("./errores");

const NIVELES = ["LECTURA", "LECTURA_ESCRITURA", "LECTURA_ESCRITURA_COMPARTIR"];
const COMPARTIR = "LECTURA_ESCRITURA_COMPARTIR";
const TIPOS_DESTINATARIO = ["USUARIO", "GRUPO"];
const POR_PAGINA = 50;

/**
 * Reglas de negocio de Shared File Service (Contrato_SharedFile).
 *
 * Reparto de responsabilidades, tal como lo pide el contrato:
 *   - Shared File decide QUIÉN comparte con quién y lo registra (relaciones).
 *   - Storage es la fuente de verdad de los bytes y de los PERMISOS EFECTIVOS:
 *     aquí no se reimplementa esa regla, se le pregunta (nivelEfectivo) y se le
 *     pide que aplique cada compartición en sus validaciones.
 *
 * Política institucional: compartición AUTOMÁTICA (estadoInvitacion = ACTIVO).
 * Por eso AceptarInvitacion/RechazarInvitacion no se exponen (el contrato dice
 * que "aplican solo si la política exige aceptación explícita").
 *
 * No conoce HTTP ni SQL: recibe el repositorio, el cliente de Storage, el
 * directorio de usuarios y un emisor de eventos por el constructor.
 */
class ComparticionService {
    constructor({ relaciones, storage, directorio, eventos }) {
        this.relaciones = relaciones;
        this.storage = storage;
        this.directorio = directorio;
        this.eventos = eventos;
    }

    // ------------------------------------------------------------ CompartirArchivo / CompartirDirectorio

    /** CompartirArchivo (§3.1). */
    compartirArchivo(datos, usuario, token) {
        return this.#compartir({ ...datos, elementoId: datos.archivoId }, "ARCHIVO", usuario, token);
    }

    /** CompartirDirectorio (§3.2): el permiso se hereda a todo el contenido, presente y futuro. */
    compartirDirectorio(datos, usuario, token) {
        return this.#compartir({ ...datos, elementoId: datos.directorioId }, "DIRECTORIO", usuario, token);
    }

    async #compartir({ elementoId, destinatarioTipo, destinatarioId, nivelPermiso, expiracion },
                     elementoTipo, usuario, token) {
        // 1. Validación de la solicitud.
        if (!elementoId) {
            throw new SolicitudInvalida(elementoTipo === "ARCHIVO" ? "Falta archivoId" : "Falta directorioId");
        }
        if (!TIPOS_DESTINATARIO.includes(destinatarioTipo)) {
            throw new SolicitudInvalida("destinatarioTipo debe ser USUARIO o GRUPO");
        }
        const destinatario = String(destinatarioId || "").trim();
        if (!destinatario) throw new SolicitudInvalida("Falta destinatarioId");
        if (!NIVELES.includes(nivelPermiso)) {
            throw new SolicitudInvalida(`nivelPermiso debe ser ${NIVELES.join(", ")}`);
        }
        const fechaExpiracion = this.#leerExpiracion(expiracion);

        // 2. El elemento existe y el solicitante puede compartirlo (lo dice Storage).
        const nodo = await this.storage.obtenerNodo(elementoId, token);
        const codigoNoEncontrado = elementoTipo === "DIRECTORIO" ? "SHR-101" : "SHR-001";
        if (!nodo) {
            throw new NoEncontrado(`No existe el ${elementoTipo.toLowerCase()} ${elementoId} o no tiene acceso`, codigoNoEncontrado);
        }
        const tipoReal = nodo.tipo === "directorio" ? "DIRECTORIO" : "ARCHIVO";
        if (tipoReal !== elementoTipo) {
            throw new SolicitudInvalida(tipoReal === "DIRECTORIO"
                ? "El elemento es un directorio: use CompartirDirectorio"
                : "El elemento es un archivo: use CompartirArchivo");
        }
        if (nodo.nivelEfectivo !== COMPARTIR) throw new SinPermisoCompartir();

        // 3. El destinatario existe (Authentication) y no es el dueño.
        if (destinatarioTipo === "USUARIO") {
            if (destinatario === nodo.propietario) {
                throw new SolicitudInvalida("No se puede compartir con el propietario del elemento");
            }
            if (destinatario === usuario.id) {
                throw new SolicitudInvalida("No se puede compartir consigo mismo");
            }
            if (!(await this.directorio.existeUsuario(destinatario))) {
                throw new DestinatarioInexistente(destinatario);
            }
        }

        // 4. SHR-004: ya compartido con ese destinatario.
        if (await this.relaciones.buscarVigente(elementoId, destinatarioTipo, destinatario)) {
            throw new YaCompartido(destinatario);
        }

        // 5 y 6. Registrar la relación y que Storage la aplique, en la misma transacción.
        let relacion;
        try {
            relacion = await this.relaciones.registrar({
                elementoId, elementoTipo, nombreElemento: nodo.nombre,
                propietarioId: usuario.id, duenioElemento: nodo.propietario,
                destinatarioTipo, destinatarioId: destinatario, nivelPermiso,
                estadoInvitacion: "ACTIVO", fechaExpiracion,
            }, () => this.storage.otorgarAcceso(elementoId, {
                destinatarioTipo, destinatarioId: destinatario, nivel: nivelPermiso,
                expiraEn: fechaExpiracion ? fechaExpiracion.toISOString() : null,
            }, token));
        } catch (e) {
            if (e.code === "23505") throw new YaCompartido(destinatario); // carrera entre dos peticiones
            throw e;
        }

        // 7. Evento ArchivoCompartido.
        this.eventos.emitir("ArchivoCompartido", {
            compartidoId: relacion.id, elementoId, elementoTipo, propietarioId: usuario.id,
            destinatarioTipo, destinatarioId: destinatario, nivelPermiso,
        });

        return {
            compartidoId: relacion.id,
            fechaCompartido: relacion.fecha_creacion,
            estadoInvitacion: relacion.estado_invitacion,
        };
    }

    #leerExpiracion(expiracion) {
        if (expiracion === undefined || expiracion === null || expiracion === "") return null;
        const fecha = new Date(expiracion);
        if (Number.isNaN(fecha.getTime())) throw new SolicitudInvalida("expiracion no es una fecha válida (ISO-8601)");
        if (fecha <= new Date()) throw new SolicitudInvalida("expiracion tiene que ser una fecha futura");
        return fecha;
    }

    // ------------------------------------------------------------ DejarDeCompartir

    /** DejarDeCompartir (§3.3) por compartidoId. */
    async dejarDeCompartir(compartidoId, usuario, token) {
        const relacion = await this.relaciones.buscarPorId(compartidoId);
        if (!relacion || !["ACTIVO", "PENDIENTE"].includes(relacion.estado_invitacion)) {
            throw new NoEncontrado(`No existe la compartición ${compartidoId}`);
        }
        await this.#exigirPuedeGestionar(relacion, usuario, token);

        // Primero Storage: la revocación tiene que ser inmediata (regla del
        // contrato), y si Storage falla la relación sigue vigente aquí también.
        await this.storage.revocarAcceso(relacion.elemento_id, relacion.destinatario_tipo,
            relacion.destinatario_id, token);
        await this.relaciones.marcarRevocada(relacion.id);

        this.eventos.emitir("ComparticionRevocada", {
            compartidoId: relacion.id, elementoId: relacion.elemento_id, revocadaPor: usuario.id,
        });
    }

    /** DejarDeCompartir (§3.3) por archivoId + destinatario. */
    async dejarDeCompartirElemento({ elementoId, destinatarioTipo, destinatarioId }, usuario, token) {
        if (!elementoId || !TIPOS_DESTINATARIO.includes(destinatarioTipo) || !destinatarioId) {
            throw new SolicitudInvalida("Indique compartidoId, o elementoId + destinatarioTipo + destinatarioId");
        }
        const relacion = await this.relaciones.buscarVigente(elementoId, destinatarioTipo, destinatarioId);
        if (!relacion) throw new NoEncontrado("No hay una compartición vigente con ese destinatario");
        return this.dejarDeCompartir(relacion.id, usuario, token);
    }

    /**
     * Puede revocar o modificar una relación "solo el propietario original o
     * quien tenga compartir" (§3.3). Quien creó la relación pero ya perdió el
     * nivel "compartir" (lo degradaron) no puede: Storage tampoco se lo permitiría.
     */
    async #exigirPuedeGestionar(relacion, usuario, token) {
        if (relacion.duenio_elemento === usuario.id) return;
        const nodo = await this.storage.obtenerNodo(relacion.elemento_id, token);
        if (!nodo || nodo.nivelEfectivo !== COMPARTIR) {
            throw new SinPermisoCompartir("Solo el propietario original o quien tenga permiso de compartir puede modificar esta compartición");
        }
    }

    // ------------------------------------------------------------ ActualizarPermisosCompartidos

    /** ActualizarPermisosCompartidos (§3.4). */
    async actualizarPermisos(compartidoId, nuevoNivelPermiso, usuario, token) {
        if (!NIVELES.includes(nuevoNivelPermiso)) {
            throw new SolicitudInvalida(`nuevoNivelPermiso debe ser ${NIVELES.join(", ")}`);
        }
        const relacion = await this.relaciones.buscarPorId(compartidoId);
        if (!relacion || relacion.estado_invitacion !== "ACTIVO") {
            throw new NoEncontrado(`No existe la compartición ${compartidoId}`);
        }
        await this.#exigirPuedeGestionar(relacion, usuario, token);

        // SHR-201: degradar a quien ya volvió a compartir NO revoca sus
        // subcomparticiones; el contrato pide advertirlo explícitamente.
        let advertencia = null;
        if (relacion.nivel_permiso === COMPARTIR && nuevoNivelPermiso !== COMPARTIR
            && relacion.destinatario_tipo === "USUARIO") {
            const n = await this.relaciones.contarSubcomparticiones(relacion.elemento_id, relacion.destinatario_id);
            if (n > 0) {
                advertencia = {
                    codigo: "SHR-201",
                    mensaje: `${relacion.destinatario_id} ya compartió este elemento con ${n} destinatario(s). ` +
                        "Esas comparticiones siguen vigentes: revóquelas aparte si hace falta.",
                };
            }
        }

        await this.storage.otorgarAcceso(relacion.elemento_id, {
            destinatarioTipo: relacion.destinatario_tipo, destinatarioId: relacion.destinatario_id,
            nivel: nuevoNivelPermiso,
            expiraEn: relacion.fecha_expiracion ? new Date(relacion.fecha_expiracion).toISOString() : null,
        }, token);
        const actualizada = await this.relaciones.actualizarNivel(relacion.id, nuevoNivelPermiso);

        return { compartidoId: actualizada.id, nivelPermiso: actualizada.nivel_permiso, advertencia };
    }

    // ------------------------------------------------------------ Listados

    /** ListarCompartidosConmigo (§3.5): excluye revocadas, caducadas y huérfanas. */
    async compartidosConmigo(usuario, token, pagina = 0) {
        const filas = await this.relaciones.compartidasCon(
            usuario.id, usuario.grupos || [], POR_PAGINA, this.#desplazamiento(pagina)
        );
        return this.#conMetadatos(filas, token);
    }

    /** ListarQueYoComparto (§3.5). */
    async queYoComparto(usuario, token, pagina = 0) {
        const filas = await this.relaciones.compartidasPor(usuario.id, POR_PAGINA, this.#desplazamiento(pagina));
        return this.#conMetadatos(filas, token);
    }

    #desplazamiento(pagina) {
        const p = Number(pagina) || 0;
        if (p < 0) throw new SolicitudInvalida("La página no puede ser negativa");
        return p * POR_PAGINA;
    }

    /**
     * Completa cada relación con los metadatos actuales de Storage. Si Storage
     * ya no lo entrega (se borró, o se revocó el acceso), la relación es
     * huérfana y no se lista (caso límite §8 de CompartirArchivo).
     */
    async #conMetadatos(filas, token) {
        const nodos = await Promise.all(filas.map((f) => this.storage.obtenerNodo(f.elemento_id, token)));
        return filas
            .map((f, i) => [f, nodos[i]])
            .filter(([, nodo]) => nodo)
            .map(([f, nodo]) => ({
                compartidoId: f.id,
                elementoId: f.elemento_id,
                elementoTipo: f.elemento_tipo,
                nombre: nodo.nombre,
                tamanoBytes: nodo.tamanoBytes,
                propietario: nodo.propietario,
                compartidoPor: f.propietario_id,
                destinatarioTipo: f.destinatario_tipo,
                destinatarioId: f.destinatario_id,
                nivelPermiso: f.nivel_permiso,
                estadoInvitacion: f.estado_invitacion,
                fechaCompartido: f.fecha_creacion,
                fechaExpiracion: f.fecha_expiracion,
            }));
    }

    // ------------------------------------------------------------ ObtenerPermisosEfectivos

    /**
     * ObtenerPermisosEfectivos (§3.6). El cálculo lo hace Storage (misma regla
     * que aplica al servir los bytes); aquí se añaden las relaciones que
     * explican el resultado.
     *
     * Solo para el propio solicitante: para calcularlo sobre OTRO usuario
     * harían falta sus grupos, y Authentication no tiene una operación que
     * los entregue a un tercero con garantías. PENDIENTE.
     */
    async permisosEfectivos(elementoId, usuarioObjetivo, usuario, token) {
        if (usuarioObjetivo && usuarioObjetivo !== usuario.id) {
            throw new SolicitudInvalida("Por ahora solo se puede consultar el permiso efectivo propio");
        }
        const nodo = await this.storage.obtenerNodo(elementoId, token);
        const fuentes = nodo && nodo.propietario !== usuario.id
            ? await this.relaciones.queAplicanA(elementoId, usuario.id, usuario.grupos || [])
            : [];
        return {
            usuarioId: usuario.id,
            elementoId,
            nivelResultante: nodo ? nodo.nivelEfectivo : "NINGUNO",
            esPropietario: Boolean(nodo && nodo.propietario === usuario.id),
            fuentes: fuentes.map((f) => ({
                compartidoId: f.id, destinatarioTipo: f.destinatario_tipo,
                destinatarioId: f.destinatario_id, nivelPermiso: f.nivel_permiso,
                compartidoPor: f.propietario_id, fechaExpiracion: f.fecha_expiracion,
            })),
            // El acceso heredado de un directorio compartido también cuenta en
            // nivelResultante; las relaciones de ese directorio no se listan aquí.
        };
    }

    // ------------------------------------------------------------ Home y cuota (fachadas sobre Storage)

    /** ObtenerHome (§3.8). */
    async obtenerHome(usuario, token) {
        const [homePath, contenido] = await Promise.all([
            this.directorio.homeDe(usuario.id), this.storage.listarHome(token),
        ]);
        return { homePath, contenido };
    }

    /** ListarContenidoHome (§3.8). */
    listarContenidoHome(token) {
        return this.storage.listarHome(token);
    }

    /** ObtenerCuotaUsuario (fachada sobre Storage). */
    obtenerCuota(token) {
        return this.storage.cuota(token);
    }
}

module.exports = ComparticionService;
