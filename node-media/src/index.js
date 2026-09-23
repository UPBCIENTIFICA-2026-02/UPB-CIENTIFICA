const express = require("express");
const config = require("./config");

const { crearPool, aplicarEsquema } = require("./datos/db");
const CatalogoRepository = require("./datos/CatalogoRepository");
const { crearFuente } = require("./datos/FuenteMedios");
const Ffmpeg = require("./datos/ffmpeg");
const IndexadorService = require("./dominio/IndexadorService");
const AlbumService = require("./dominio/AlbumService");
const StreamingService = require("./dominio/StreamingService");
const { crearValidador } = require("./auth/ValidadorToken");
const { crearMiddlewareAutenticacion } = require("./middleware/autenticacion");
const { manejoErrores } = require("./middleware/manejoErrores");
const { crearRutasAlbum } = require("./rutas/album");
const { crearRutasStreaming } = require("./rutas/streaming");

/** Composition root: único lugar donde se instancian y conectan dependencias. */
async function construirAplicacion() {
    const pool = crearPool(config.databaseUrl);
    await aplicarEsquema(pool);

    const catalogo = new CatalogoRepository(pool);
    const fuente = crearFuente(config);
    const ffmpeg = new Ffmpeg(config);
    const indexador = new IndexadorService({ catalogo, fuente, ffmpeg });
    const albumService = new AlbumService({ catalogo, fuente, indexador });
    const streamingService = new StreamingService({ catalogo, fuente });
    const validador = crearValidador(config);

    const app = express();
    app.use(express.json());

    app.get("/health", async (_req, res) => {
        try {
        await pool.query("SELECT 1");
        res.json({
            estado: "ok", servicio: "media", bd: "ok",
            fuente: config.fuenteMedios, version: "0.1.0",
        });
        } catch {
        res.status(503).json({ estado: "degradado", servicio: "media", bd: "error" });
        }
    });

    const auth = crearMiddlewareAutenticacion(validador);
    app.use("/album", auth, crearRutasAlbum(albumService));
    app.use("/streaming", auth, crearRutasStreaming(streamingService));

    app.use(manejoErrores);
    return { app, pool };
}

if (require.main === module) {
    construirAplicacion()
        .then(({ app }) => {
        app.listen(config.puerto, () => {
            console.log("=========================================================");
            console.log(" Media Service (Photo Album + Streaming)");
            console.log(` Puerto: ${config.puerto}`);
            console.log(` Fuente de medios: ${config.fuenteMedios}`);
            console.log(` Miniaturas: ${config.dirMiniaturas}`);
            console.log("=========================================================");
        });
        })
        .catch((e) => {
        console.error("No se pudo iniciar el servicio:", e.message);
        process.exit(1);
        });
}

module.exports = { construirAplicacion };