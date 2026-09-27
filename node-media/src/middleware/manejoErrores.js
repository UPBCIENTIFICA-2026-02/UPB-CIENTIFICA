const {
    ErrorDominio, NoEncontrado, PermisoDenegado,
    NoAutenticado, SolicitudInvalida, FuenteNoDisponible,
    ServicioAuthNoDisponible,
} = require("../dominio/errores");

/*
 * ANTES este archivo importaba `CuotaExcedida` (que no existe en el dominio de
 * node-media, es de Storage) y NO importaba `FuenteNoDisponible`, que sí usaba
 * más abajo. Como el Map se construye al cargar el módulo, `require` de este
 * archivo lanzaba un ReferenceError y el servicio NO ARRANCABA en absoluto.
 */
const MAPA_HTTP = new Map([
  [NoAutenticado, 401],
  [PermisoDenegado, 403],
  [NoEncontrado, 404],
  [SolicitudInvalida, 400],
  [FuenteNoDisponible, 503],          // Storage caído → 503, no 500
  [ServicioAuthNoDisponible, 503],    // Auth caído → 503, nunca 401
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
