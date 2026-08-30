/**
 * Jerarquía de errores del dominio. La capa de rutas los traduce a códigos HTTP;
 * el dominio nunca conoce HTTP.
 */
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

class CuotaExcedida extends ErrorDominio {
    constructor(usados, cuota) {
        super(
        `Cuota excedida: ${usados} bytes usados de ${cuota} disponibles`,
        "CUOTA_EXCEDIDA"
        );
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

module.exports = {
    ErrorDominio, NoEncontrado, PermisoDenegado,
    CuotaExcedida, NoAutenticado, SolicitudInvalida,
};