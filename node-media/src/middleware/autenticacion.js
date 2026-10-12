// src/middleware/autenticacion.js
const { NoAutenticado, ServicioNoAutorizado } = require("../dominio/errores");

/**
 * `servicio`: nombre del servicio en el mapa de servicios autorizados del
 * directorio (storage, sharedfile, album, streaming...). Si se indica, además de
 * validar el token se exige que el perfil del usuario pueda usarlo (D2).
 */
function crearMiddlewareAutenticacion(validador, servicio = null) {
    return async function autenticacion(req, _res, siguiente) {
        try {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;

        const usuario = await validador.validar(token);
        if (!usuario) throw new NoAutenticado();
        if (servicio && !(await validador.autorizarServicio(usuario, servicio))) {
            throw new ServicioNoAutorizado(servicio);
        }

        req.usuario = usuario;
        req.token = token;   // se reenvía a Storage para que ÉL aplique permisos
        siguiente();
        } catch (error) {
        siguiente(error);
        }
    };
}

module.exports = { crearMiddlewareAutenticacion };