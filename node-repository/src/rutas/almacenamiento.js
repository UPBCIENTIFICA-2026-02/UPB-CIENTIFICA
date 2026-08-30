const express = require("express");
const multer = require("multer");

// Los archivos se reciben en memoria y los persiste la capa de almacenamiento.
// TODO: para archivos muy grandes, migrar a almacenamiento en disco por streaming.
const subida = multer({ storage: multer.memoryStorage() });

/**
 * Capa de presentación/API. Solo traduce HTTP <-> dominio.
 * Ninguna regla de negocio vive aquí.
 */
function crearRutasAlmacenamiento(archivoService) {
    const router = express.Router();

    // GET /storage/directorios/:id
    router.get("/directorios/:id", (req, res, siguiente) => {
        try {
        res.json(archivoService.listarDirectorio(req.params.id, req.usuario));
        } catch (e) { siguiente(e); }
    });

    // POST /storage/directorios
    router.post("/directorios", (req, res, siguiente) => {
        try {
        const { nombre, directorioPadreId = "root" } = req.body || {};
        res.status(201).json(
            archivoService.crearDirectorio(nombre, directorioPadreId, req.usuario)
        );
        } catch (e) { siguiente(e); }
    });

    // POST /storage/archivos  (multipart)
    router.post("/archivos", subida.single("archivo"), async (req, res, siguiente) => {
        try {
        const dto = await archivoService.subirArchivo(
            {
            nombre: req.file?.originalname,
            buffer: req.file?.buffer,
            directorioDestino: req.query.directorioDestino || "root",
            sobrescribir: req.query.sobrescribir === "true",
            },
            req.usuario
        );
        res.status(201).json(dto);
        } catch (e) { siguiente(e); }
    });

    // GET /storage/archivos/:id/descargar
    router.get("/archivos/:id/descargar", (req, res, siguiente) => {
        try {
        const { nombre, tamanoBytes, flujo } =
            archivoService.descargarArchivo(req.params.id, req.usuario);

        res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
        res.setHeader("Content-Length", tamanoBytes);
        flujo.on("error", siguiente);
        flujo.pipe(res);
        } catch (e) { siguiente(e); }
    });

    // DELETE /storage/archivos/:id
    router.delete("/archivos/:id", async (req, res, siguiente) => {
        try {
        await archivoService.eliminarArchivo(req.params.id, req.usuario);
        res.status(204).end();
        } catch (e) { siguiente(e); }
    });

    // GET /storage/cuota
    router.get("/cuota", (req, res, siguiente) => {
        try {
        res.json(archivoService.consultarCuota(req.usuario));
        } catch (e) { siguiente(e); }
    });

    return router;
}

module.exports = { crearRutasAlmacenamiento };