const express = require("express");
const { Readable } = require("stream");

/** Capa de presentación/API del Streaming. Conforme a Contrato_Streaming. */
function crearRutasStreaming(streamingService) {
  const router = express.Router();

  router.get("/catalogo", async (req, res, siguiente) => {
    try {
      res.json(await streamingService.catalogoVideos(req.usuario, Number(req.query.pagina || 0)));
    } catch (e) { siguiente(e); }
  });

  router.get("/buscar", async (req, res, siguiente) => {
    try {
      res.json(await streamingService.buscar(req.usuario, req.query.criterioTexto));
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

  return router;
}

module.exports = { crearRutasStreaming };