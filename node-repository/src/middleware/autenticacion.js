const { NoAutenticado } = require("../dominio/errores");

/**
 * Extrae el token del header Authorization, lo valida con la estrategia
 * configurada y deja el usuario en req.usuario para las capas siguientes.
 */
function crearMiddlewareAutenticacion(validador) {
    return async function autenticacion(req, _res, siguiente) {
        try {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;

        const usuario = await validador.validar(token);
        if (!usuario) throw new NoAutenticado();

        req.usuario = usuario;
        siguiente();
        } catch (error) {
        siguiente(error);
        }
    };
}

module.exports = { crearMiddlewareAutenticacion };