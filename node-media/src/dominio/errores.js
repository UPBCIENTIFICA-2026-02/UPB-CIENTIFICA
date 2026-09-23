    /** Jerarquía de errores del dominio. La capa de rutas los traduce a HTTP. */
    class ErrorDominio extends Error {
    constructor(mensaje, codigo) {
        super(mensaje);
        this.name = this.constructor.name;
        this.codigo = codigo;
    }
    }

    class NoEncontrado extends ErrorDominio {
    constructor(recurso) {
        super(`No se encontró el recurso: ${recurso}`, "NO_ENCONTRADO");
    }
    }

    class PermisoDenegado extends ErrorDominio {
    constructor(accion) {
        super(`No tiene permisos para: ${accion}`, "PERMISO_DENEGADO");
    }
    }

    class NoAutenticado extends ErrorDominio {
    constructor() {
        super("Token ausente o inválido", "NO_AUTENTICADO");
    }
    }

    class SolicitudInvalida extends ErrorDominio {
    constructor(detalle) {
        super(detalle, "SOLICITUD_INVALIDA");
    }
    }

    class FuenteNoDisponible extends ErrorDominio {
    constructor(detalle) {
        super(`No se pudo acceder al almacenamiento: ${detalle}`, "FUENTE_NO_DISPONIBLE");
    }
    }

    module.exports = {
    ErrorDominio, NoEncontrado, PermisoDenegado,
    NoAutenticado, SolicitudInvalida, FuenteNoDisponible,
    };