const express = require("express");
const fs = require("fs");
const { Readable } = require("stream");

/** Capa de presentación/API del Photo Album. Solo traduce HTTP <-> dominio. */
function crearRutasAlbum(albumService) {
  const router = express.Router();

  // --- fotos ---

  router.get("/fotos", async (req, res, siguiente) => {
    try {
      res.json(await albumService.listarFotos(req.usuario, Number(req.query.pagina || 0)));
    } catch (e) { siguiente(e); }
  });

  router.get("/fotos/buscar", async (req, res, siguiente) => {
    try {
      res.json(await albumService.buscarFotos(req.usuario, req.query.criterioTexto));
    } catch (e) { siguiente(e); }
  });

  router.get("/fotos/:id", async (req, res, siguiente) => {
    try {
      res.json(await albumService.obtenerFoto(req.params.id, req.usuario));
    } catch (e) { siguiente(e); }
  });

  router.get("/fotos/:id/miniatura", async (req, res, siguiente) => {
    try {
      const ruta = await albumService.rutaMiniatura(req.params.id, req.usuario);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      fs.createReadStream(ruta).on("error", siguiente).pipe(res);
    } catch (e) { siguiente(e); }
  });

  router.get("/fotos/:id/contenido", async (req, res, siguiente) => {
    try {
      const { flujo, tamanoBytes } = await albumService.abrirContenido(
        req.params.id, req.usuario, req.token
      );
      if (tamanoBytes) res.setHeader("Content-Length", tamanoBytes);
      // StorageApiSource devuelve un stream web; NfsSource uno de Node.
      const nodeStream = typeof flujo.pipe === "function" ? flujo : Readable.fromWeb(flujo);
      nodeStream.on("error", siguiente).pipe(res);
    } catch (e) { siguiente(e); }
  });

  // Borra la foto: el archivo en Storage y su entrada en el catálogo.
  router.delete("/fotos/:id", async (req, res, siguiente) => {
    try {
      await albumService.eliminarFoto(req.params.id, req.usuario, req.token);
      res.status(204).end();
    } catch (e) { siguiente(e); }
  });

  // --- indexación ---

  router.post("/indexar", async (req, res, siguiente) => {
    try {
      res.json(await albumService.indexar(req.usuario, req.token));
    } catch (e) { siguiente(e); }
  });

  // --- álbumes ---

  router.get("/albumes", async (req, res, siguiente) => {
    try {
      res.json(await albumService.listarAlbumes(req.usuario));
    } catch (e) { siguiente(e); }
  });

  router.post("/albumes", async (req, res, siguiente) => {
    try {
      const { nombre, descripcion } = req.body || {};
      res.status(201).json(await albumService.crearAlbum(nombre, descripcion, req.usuario));
    } catch (e) { siguiente(e); }
  });

  router.get("/albumes/:id", async (req, res, siguiente) => {
    try {
      res.json(await albumService.verAlbum(req.params.id, req.usuario));
    } catch (e) { siguiente(e); }
  });

  router.post("/albumes/:id/fotos", async (req, res, siguiente) => {
    try {
      const { medioId, orden } = req.body || {};
      await albumService.agregarFoto(req.params.id, medioId, orden, req.usuario);
      res.status(204).end();
    } catch (e) { siguiente(e); }
  });

  router.delete("/albumes/:id/fotos/:medioId", async (req, res, siguiente) => {
    try {
      await albumService.quitarFoto(req.params.id, req.params.medioId, req.usuario);
      res.status(204).end();
    } catch (e) { siguiente(e); }
  });

  router.delete("/albumes/:id", async (req, res, siguiente) => {
    try {
      await albumService.eliminarAlbum(req.params.id, req.usuario);
      res.status(204).end();
    } catch (e) { siguiente(e); }
  });

  return router;
}

module.exports = { crearRutasAlbum };