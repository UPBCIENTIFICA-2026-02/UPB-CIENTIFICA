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

/**
 * La cabecera Range pide un tramo que el archivo no puede satisfacer.
 * Se traduce a 416, que es lo que espera un reproductor de vídeo para
 * reintentar pidiendo el archivo completo.
 */
class RangoNoSatisfacible extends ErrorDominio {
    constructor(tamanoTotal) {
        super(
        `El rango solicitado no es válido para un archivo de ${tamanoTotal} bytes`,
        "RANGO_NO_SATISFACIBLE"
        );
        this.tamanoTotal = tamanoTotal;
    }
}

/**
 * El Authentication Service no responde.
 *
 * Se distingue de NoAutenticado a propósito: "no pude comprobar tu token" (503)
 * y "tu token no vale" (401) son cosas distintas. Si se devolviera 401 cuando
 * node-soap está caído, los clientes borrarían sesiones que siguen siendo
 * válidas y obligarían a los usuarios a entrar de nuevo sin motivo.
 */
class ServicioAuthNoDisponible extends ErrorDominio {
    constructor(detalle) {
        super(
        `No se pudo validar el token contra Authentication Service: ${detalle}`,
        "AUTH_NO_DISPONIBLE"
        );
    }
}

module.exports = {
    ErrorDominio, NoEncontrado, PermisoDenegado,
    CuotaExcedida, NoAutenticado, SolicitudInvalida,
    RangoNoSatisfacible, ServicioAuthNoDisponible,
};