const express = require("express");
const fs = require("fs");
const { Readable } = require("stream");

/** Capa de presentación/API del Streaming. Conforme a Contrato_Streaming. */
function crearRutasStreaming(streamingService) {
  const router = express.Router();

  router.get("/catalogo", async (req, res, siguiente) => {
    try {
      // ordenPor: RECIENTES (por defecto) | MAS_VISTOS | ALFABETICO
      res.json(await streamingService.catalogoVideos(
        req.usuario, Number(req.query.pagina || 0), 50, req.query.ordenPor, req.token
      ));
    } catch (e) { siguiente(e); }
  });

  router.get("/buscar", async (req, res, siguiente) => {
    try {
      res.json(await streamingService.buscar(req.usuario, req.query.criterioTexto, req.query.ordenPor));
    } catch (e) { siguiente(e); }
  });

  // Vista previa del video (fotograma del segundo 1), generada al indexar.
  router.get("/:id/miniatura", async (req, res, siguiente) => {
    try {
      const ruta = await streamingService.rutaMiniatura(req.params.id, req.usuario);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      fs.createReadStream(ruta).on("error", siguiente).pipe(res);
    } catch (e) { siguiente(e); }
  });

  router.get("/:id/sesion", async (req, res, siguiente) => {
    try {
      res.json(await streamingService.iniciarSesion(req.params.id, req.usuario));
    } catch (e) { siguiente(e); }
  });

  /**
   * Entrega el video. Propaga la cabecera Range para que el reproductor pueda
   * saltar en la línea de tiempo sin descargar el archivo completo.
   */
  router.get("/:id/contenido", async (req, res, siguiente) => {
    try {
      const rango = req.headers.range || null;
      const { flujo, tamanoBytes, estado, contentRange } =
        await streamingService.abrirContenido(req.params.id, req.usuario, req.token, rango);

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "video/mp4");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (tamanoBytes) res.setHeader("Content-Length", tamanoBytes);
      res.status(estado === 206 || contentRange ? 206 : 200);

      const nodeStream = typeof flujo.pipe === "function" ? flujo : Readable.fromWeb(flujo);
      nodeStream.on("error", siguiente).pipe(res);
    } catch (e) { siguiente(e); }
  });

  // Borra el video: el archivo en Storage y su entrada en el catálogo.
  router.delete("/:id", async (req, res, siguiente) => {
    try {
      await streamingService.eliminarVideo(req.params.id, req.usuario, req.token);
      res.status(204).end();
    } catch (e) { siguiente(e); }
  });

  return router;
}

module.exports = { crearRutasStreaming };