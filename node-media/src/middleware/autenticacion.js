// src/middleware/autenticacion.js
const { NoAutenticado } = require("../dominio/errores");

function crearMiddlewareAutenticacion(validador) {
    return async function autenticacion(req, _res, siguiente) {
        try {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;

        const usuario = await validador.validar(token);
        if (!usuario) throw new NoAutenticado();

        req.usuario = usuario;
        req.token = token;   // se reenvía a Storage para que ÉL aplique permisos
        siguiente();
        } catch (error) {
        siguiente(error);
        }
    };
}

module.exports = { crearMiddlewareAutenticacion };