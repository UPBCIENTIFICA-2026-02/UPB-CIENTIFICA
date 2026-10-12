const express = require("express");
const config = require("./config");

const { crearPool, aplicarEsquema } = require("./datos/db");
const ComparticionesRepository = require("./datos/ComparticionesRepository");
const StorageCliente = require("./datos/StorageCliente");
const { crearDirectorio } = require("./datos/DirectorioUsuarios");
const EmisorEventos = require("./datos/EmisorEventos");
const ComparticionService = require("./dominio/ComparticionService");
const { crearValidador } = require("./auth/ValidadorToken");
const { crearMiddlewareAutenticacion } = require("./middleware/autenticacion");
const { manejoErrores } = require("./middleware/manejoErrores");
const { crearRutasCompartidos } = require("./rutas/compartidos");

/** Composition root: único lugar donde se instancian y conectan las dependencias. */
async function construirAplicacion() {
    const pool = crearPool(config.databaseUrl);
    await aplicarEsquema(pool);

    const servicio = new ComparticionService({
        relaciones: new ComparticionesRepository(pool),
        storage: new StorageCliente(config.urlStorage),
        directorio: crearDirectorio(config),
        eventos: new EmisorEventos(),
    });
    const validador = crearValidador(config);

    const app = express();

    // Registro de accesos: método, ruta, estado, duración y origen. Sin
    // cabeceras ni cuerpos (llevan el token y los datos del usuario).
    app.use((req, res, siguiente) => {
        const inicio = Date.now();
        res.on("finish", () => {
            console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.originalUrl} ` +
                `${res.statusCode} ${Date.now() - inicio}ms`);
        });
        siguiente();
    });

    app.use(express.json({ limit: "64kb" }));

    // Sonda de salud (node-monitoreo). Comprueba la BD propia.
    app.get("/health", async (_req, res) => {
        try {
            await pool.query("SELECT 1");
            res.json({ estado: "ok", servicio: "shared-file", bd: "ok", version: "0.1.0" });
        } catch {
            res.status(503).json({ estado: "degradado", servicio: "shared-file", bd: "error" });
        }
    });

    app.use("/shared-file",
        crearMiddlewareAutenticacion(validador),
        crearRutasCompartidos(servicio)
    );

    app.use(manejoErrores);
    return { app, pool };
}

if (require.main === module) {
    construirAplicacion()
        .then(({ app }) => {
            app.listen(config.puerto, () => {
                console.log("=========================================================");
                console.log(" Shared File Service (shared-file-svc)");
                console.log(` Puerto:         ${config.puerto}`);
                console.log(` Storage:        ${config.urlStorage}`);
                console.log(` Autenticación:  ${config.modoAutenticacion}`);
                console.log(` Destinatarios:  ${config.modoDirectorio}`);
                console.log("=========================================================");
            });
        })
        .catch((e) => {
            console.error("No se pudo iniciar el servicio:", e.message);
            process.exit(1);
        });
}

module.exports = { construirAplicacion };
