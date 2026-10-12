/**
 * Errores del dominio. Los códigos SHR-xxx son los de Contrato_SharedFile;
 * la traducción a HTTP vive solo en middleware/manejoErrores.js.
 */
class ErrorDominio extends Error {
    constructor(mensaje, codigo) {
        super(mensaje);
        this.name = this.constructor.name;
        this.codigo = codigo;
    }
}

/** SHR-001 / SHR-101: el elemento o la relación no existe, o no es del solicitante. */
class NoEncontrado extends ErrorDominio {
    constructor(mensaje, codigo = "SHR-001") {
        super(mensaje, codigo);
    }
}

/** SHR-002: el solicitante no tiene permiso "compartir" sobre el elemento. */
class SinPermisoCompartir extends ErrorDominio {
    constructor(mensaje = "No tiene permiso para compartir este elemento; pídaselo al propietario") {
        super(mensaje, "SHR-002");
    }
}

/** SHR-003: el usuario destinatario no existe en Authentication. */
class DestinatarioInexistente extends ErrorDominio {
    constructor(destinatario) {
        super(`El usuario "${destinatario}" no existe`, "SHR-003");
    }
}

/** SHR-004: ya hay una compartición activa con ese destinatario. */
class YaCompartido extends ErrorDominio {
    constructor(destinatario) {
        super(
            `El elemento ya está compartido con ${destinatario}; use ActualizarPermisosCompartidos para cambiar el nivel`,
            "SHR-004"
        );
    }
}

/** STG-103 (propagado): Storage rechazó aplicar el permiso. */
class RechazoDeStorage extends ErrorDominio {
    constructor(detalle) {
        super(`Storage rechazó aplicar el permiso: ${detalle}`, "STG-103");
    }
}

class SolicitudInvalida extends ErrorDominio {
    constructor(mensaje) {
        super(mensaje, "SOLICITUD_INVALIDA");
    }
}

class NoAutenticado extends ErrorDominio {
    constructor() {
        super("Token ausente o inválido", "NO_AUTENTICADO");
    }
}

/** Storage no responde: 503, no "no encontrado". */
class StorageNoDisponible extends ErrorDominio {
    constructor(detalle) {
        super(`Distributed Storage no está disponible: ${detalle}`, "STORAGE_NO_DISPONIBLE");
    }
}

/** Auth caído no es "token inválido" (503 y no 401). Mismo criterio que Storage. */
class ServicioAuthNoDisponible extends ErrorDominio {
    constructor(detalle) {
        super(`No se pudo consultar Authentication Service: ${detalle}`, "AUTH_NO_DISPONIBLE");
    }
}

module.exports = {
    ErrorDominio, NoEncontrado, SinPermisoCompartir, DestinatarioInexistente,
    YaCompartido, RechazoDeStorage, SolicitudInvalida, NoAutenticado,
    StorageNoDisponible, ServicioAuthNoDisponible,
};
