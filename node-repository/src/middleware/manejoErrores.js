const {
    ErrorDominio, NoEncontrado, PermisoDenegado,
    CuotaExcedida, NoAutenticado, SolicitudInvalida,
    RangoNoSatisfacible, ServicioAuthNoDisponible,
} = require("../dominio/errores");

const MAPA_HTTP = new Map([
    [NoAutenticado, 401],
    [PermisoDenegado, 403],
    [NoEncontrado, 404],
    [CuotaExcedida, 413],
    [RangoNoSatisfacible, 416],
    [SolicitudInvalida, 400],
    [ServicioAuthNoDisponible, 503],   // Auth caído → 503, nunca 401
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

    console.error("[error-no-controlado]", error);
    return res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Error interno del servicio" });
}

module.exports = { manejoErrores };