const {
    ErrorDominio, NoEncontrado, SinPermisoCompartir, DestinatarioInexistente,
    YaCompartido, RechazoDeStorage, SolicitudInvalida, NoAutenticado,
    StorageNoDisponible, ServicioAuthNoDisponible, ServicioNoAutorizado,
} = require("../dominio/errores");

const MAPA_HTTP = new Map([
    [NoAutenticado, 401],
    [ServicioNoAutorizado, 403],
    [SinPermisoCompartir, 403],
    [NoEncontrado, 404],
    [DestinatarioInexistente, 404],
    [YaCompartido, 409],
    [RechazoDeStorage, 409],
    [SolicitudInvalida, 400],
    [StorageNoDisponible, 503],
    [ServicioAuthNoDisponible, 503],
]);

/** Traduce errores de dominio a HTTP. Única capa que conoce códigos de estado. */
function manejoErrores(error, _req, res, _siguiente) {
    for (const [Clase, estado] of MAPA_HTTP) {
        if (error instanceof Clase) {
            return res.status(estado).json({ error: error.codigo, mensaje: error.message });
        }
    }
    if (error instanceof ErrorDominio) {
        return res.status(400).json({ error: error.codigo, mensaje: error.message });
    }
    // JSON mal formado en el cuerpo (lo lanza express.json).
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ error: "SOLICITUD_INVALIDA", mensaje: "El cuerpo no es JSON válido" });
    }

    console.error("[error-no-controlado]", error);
    return res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Error interno del servicio" });
}

module.exports = { manejoErrores };
