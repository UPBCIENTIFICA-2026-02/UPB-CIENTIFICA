const express = require("express");
const config = require("./config");

const { crearPool, aplicarEsquema } = require("./datos/db");
const MetadatosRepository = require("./datos/MetadatosRepository");
const AlmacenamientoFisico = require("./datos/AlmacenamientoFisico");
const CuotasRepository = require("./datos/CuotasRepository");
const ArchivoService = require("./dominio/ArchivoService");
const { crearValidador } = require("./auth/ValidadorToken");
const { crearMiddlewareAutenticacion } = require("./middleware/autenticacion");
const { manejoErrores } = require("./middleware/manejoErrores");
const { crearRutasAlmacenamiento } = require("./rutas/almacenamiento");

/** Composition root: único lugar donde se instancian y conectan las dependencias. */
async function construirAplicacion() {
    const pool = crearPool(config.databaseUrl);
    await aplicarEsquema(pool);

    const metadatos = new MetadatosRepository(pool);
    const almacenamiento = new AlmacenamientoFisico(config.raizAlmacenamiento);
    const cuotas = new CuotasRepository(config.rutaCuotas, config.cuotaPorDefecto);
    const archivoService = new ArchivoService({ metadatos, almacenamiento, cuotas });
    const validador = crearValidador(config);

    const app = express();
    app.use(express.json());

    // Sonda de salud: la usará node-monitoreo. Verifica también la BD.
    app.get("/health", async (_req, res) => {
        try {
        await pool.query("SELECT 1");
        res.json({ estado: "ok", servicio: "distributed-storage", bd: "ok", version: "0.1.0" });
        } catch {
        res.status(503).json({ estado: "degradado", servicio: "distributed-storage", bd: "error" });
        }
    });

    app.use("/storage",
        crearMiddlewareAutenticacion(validador),
        crearRutasAlmacenamiento(archivoService)
    );

    app.use(manejoErrores);
    return { app, pool };
    }

    if (require.main === module) {
    construirAplicacion()
        .then(({ app }) => {
        app.listen(config.puerto, () => {
            console.log("=========================================================");
            console.log(" Distributed Storage Service");
            console.log(` Puerto: ${config.puerto}`);
            console.log(` Almacenamiento: ${config.raizAlmacenamiento}`);
            console.log(` Autenticación: ${config.modoAutenticacion}`);
            console.log("=========================================================");
        });
        })
        .catch((e) => {
        console.error("No se pudo iniciar el servicio:", e.message);
        process.exit(1);
        });
}

module.exports = { construirAplicacion };