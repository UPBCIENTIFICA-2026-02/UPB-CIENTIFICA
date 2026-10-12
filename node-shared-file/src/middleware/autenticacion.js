const { NoAutenticado } = require("../dominio/errores");

/**
 * Extrae el token del header Authorization, lo valida con la estrategia
 * configurada y deja el usuario en req.usuario para las capas siguientes.
 *
 * El token también se guarda en req.token: Shared File llama a Storage EN
 * NOMBRE del usuario, para que sea Storage quien vuelva a comprobar sus
 * permisos (igual que hace node-media).
 */
function crearMiddlewareAutenticacion(validador) {
    return async function autenticacion(req, _res, siguiente) {
        try {
            const header = req.headers.authorization || "";
            const token = header.startsWith("Bearer ") ? header.slice(7) : null;

            const usuario = await validador.validar(token);
            if (!usuario) throw new NoAutenticado();

            req.usuario = usuario;
            req.token = token;
            siguiente();
        } catch (error) {
            siguiente(error);
        }
    };
}

module.exports = { crearMiddlewareAutenticacion };
