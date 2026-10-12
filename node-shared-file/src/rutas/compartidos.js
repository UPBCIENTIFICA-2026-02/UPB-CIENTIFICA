const express = require("express");

/**
 * Capa de presentación/API de Shared File. Solo traduce HTTP <-> dominio.
 *
 * El contrato fija las OPERACIONES, no las rutas. Las de compartir, listar y
 * revocar son las que ya esperaban la app móvil y TRASPASO §3.4; el resto
 * sigue el mismo estilo.
 *
 *   POST   /compartir                       CompartirArchivo      { archivoId, destinatarioTipo, destinatarioId, nivelPermiso, expiracion? }
 *   POST   /compartir-directorio            CompartirDirectorio   { directorioId, ... }
 *   PATCH  /compartir/:id                   ActualizarPermisosCompartidos { nuevoNivelPermiso }
 *   DELETE /compartir/:id                   DejarDeCompartir (por compartidoId)
 *   DELETE /compartir?elementoId&destinatarioTipo&destinatarioId   DejarDeCompartir (por elemento + destinatario)
 *   GET    /compartidos-conmigo?pagina      ListarCompartidosConmigo
 *   GET    /que-yo-comparto?pagina          ListarQueYoComparto
 *   GET    /permisos-efectivos/:elementoId  ObtenerPermisosEfectivos
 *   GET    /home                            ObtenerHome
 *   GET    /home/contenido                  ListarContenidoHome
 *   GET    /cuota                           ObtenerCuotaUsuario
 *
 * El uid sale SIEMPRE del token (req.usuario), nunca del cuerpo.
 */
function crearRutasCompartidos(servicio) {
    const router = express.Router();
    const manejar = (fn) => async (req, res, siguiente) => {
        try { await fn(req, res); } catch (e) { siguiente(e); }
    };

    router.post("/compartir", manejar(async (req, res) => {
        res.status(201).json(await servicio.compartirArchivo(req.body || {}, req.usuario, req.token));
    }));

    router.post("/compartir-directorio", manejar(async (req, res) => {
        res.status(201).json(await servicio.compartirDirectorio(req.body || {}, req.usuario, req.token));
    }));

    router.patch("/compartir/:id", manejar(async (req, res) => {
        res.json(await servicio.actualizarPermisos(
            req.params.id, (req.body || {}).nuevoNivelPermiso, req.usuario, req.token
        ));
    }));

    router.delete("/compartir/:id", manejar(async (req, res) => {
        await servicio.dejarDeCompartir(req.params.id, req.usuario, req.token);
        res.status(204).end();
    }));

    router.delete("/compartir", manejar(async (req, res) => {
        await servicio.dejarDeCompartirElemento({
            elementoId: req.query.elementoId,
            destinatarioTipo: req.query.destinatarioTipo,
            destinatarioId: req.query.destinatarioId,
        }, req.usuario, req.token);
        res.status(204).end();
    }));

    router.get("/compartidos-conmigo", manejar(async (req, res) => {
        res.json(await servicio.compartidosConmigo(req.usuario, req.token, req.query.pagina));
    }));

    router.get("/que-yo-comparto", manejar(async (req, res) => {
        res.json(await servicio.queYoComparto(req.usuario, req.token, req.query.pagina));
    }));

    router.get("/permisos-efectivos/:elementoId", manejar(async (req, res) => {
        res.json(await servicio.permisosEfectivos(
            req.params.elementoId, req.query.usuarioObjetivo, req.usuario, req.token
        ));
    }));

    router.get("/home", manejar(async (req, res) => {
        res.json(await servicio.obtenerHome(req.usuario, req.token));
    }));

    router.get("/home/contenido", manejar(async (req, res) => {
        res.json(await servicio.listarContenidoHome(req.token));
    }));

    router.get("/cuota", manejar(async (req, res) => {
        res.json(await servicio.obtenerCuota(req.token));
    }));

    return router;
}

module.exports = { crearRutasCompartidos };
