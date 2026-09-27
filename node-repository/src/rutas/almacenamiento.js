const express = require("express");
const multer = require("multer");

// Los archivos se reciben en memoria y los persiste la capa de almacenamiento.
// TODO: para archivos muy grandes, migrar a almacenamiento en disco por streaming.
const subida = multer({ storage: multer.memoryStorage() });

/**
 * Traduce la cabecera Range a algo que el dominio entienda.
 *
 * Vive aquí y no en el dominio porque parsear "bytes=0-1023" es un detalle del
 * protocolo HTTP, y el dominio no conoce HTTP. Al dominio le llegan dos números.
 *
 * Solo se admite un rango simple (un tramo). RFC 7233 permite varios, pero eso
 * obliga a respuestas multipart/byteranges que ningún reproductor necesita.
 * Un Range mal formado se ignora y se sirve el archivo completo, como manda la
 * norma.
 *
 * @returns {{inicio: number|null, fin: number|null}|null}
 */
function parsearRango(cabecera) {
    if (!cabecera) return null;

    const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
    if (!m) return null;

    const [, crudoInicio, crudoFin] = m;
    if (crudoInicio === "" && crudoFin === "") return null;

    // "bytes=-500" = los últimos 500 bytes: inicio queda null y lo resuelve el
    // dominio, que es quien conoce el tamaño del archivo.
    return {
        inicio: crudoInicio === "" ? null : Number(crudoInicio),
        fin: crudoFin === "" ? null : Number(crudoFin),
    };
}

/**
 * Capa de presentación/API. Solo traduce HTTP <-> dominio.
 * Ninguna regla de negocio vive aquí.
 */
function crearRutasAlmacenamiento(archivoService) {
    const router = express.Router();

    // GET /storage/directorios/:id
    router.get("/directorios/:id", async (req, res, siguiente) => {
        try {
        res.json(await archivoService.listarDirectorio(req.params.id, req.usuario));
        } catch (e) { siguiente(e); }
    });

    // POST /storage/directorios
    router.post("/directorios", async (req, res, siguiente) => {
        try {
        const { nombre, directorioPadreId = "root" } = req.body || {};
        res.status(201).json(
            await archivoService.crearDirectorio(nombre, directorioPadreId, req.usuario)
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

    /**
     * GET /storage/archivos/:id/descargar
     *
     * Admite Range para que node-media pueda servir vídeo: sin esto, saltar en
     * la línea de tiempo obliga a descargar el archivo entero cada vez.
     */
    router.get("/archivos/:id/descargar", async (req, res, siguiente) => {
        try {
        const { nombre, tamanoBytes, flujo, parcial, inicio, fin, longitud } =
            await archivoService.descargarArchivo(
            req.params.id, req.usuario, parsearRango(req.headers.range)
            );

        res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
        res.setHeader("Accept-Ranges", "bytes");

        if (parcial) {
            res.status(206);
            res.setHeader("Content-Range", `bytes ${inicio}-${fin}/${tamanoBytes}`);
            res.setHeader("Content-Length", longitud);
        } else {
            res.setHeader("Content-Length", tamanoBytes);
        }

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
    router.get("/cuota", async (req, res, siguiente) => {
        try {
        res.json(await archivoService.consultarCuota(req.usuario));
        } catch (e) { siguiente(e); }
    });

    return router;
}

module.exports = { crearRutasAlmacenamiento };
