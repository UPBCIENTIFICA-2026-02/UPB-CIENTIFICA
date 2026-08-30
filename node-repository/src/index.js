const express = require("express");
const config = require("./config");

const { abrirConexion, aplicarEsquema } = require("./datos/db");
const MetadatosRepository = require("./datos/MetadatosRepository");
const AlmacenamientoFisico = require("./datos/AlmacenamientoFisico");
const CuotasRepository = require("./datos/CuotasRepository");
const ArchivoService = require("./dominio/ArchivoService");
const { crearValidador } = require("./auth/ValidadorToken");
const { crearMiddlewareAutenticacion } = require("./middleware/autenticacion");
const { manejoErrores } = require("./middleware/manejoErrores");

/**
 * Composition root: único lugar donde se instancian y conectan las dependencias.
 * Facilita sustituirlas en pruebas (BD en memoria, almacenamiento falso, etc.).
 */
function construirAplicacion() {
    const db = abrirConexion(config.rutaBd);
    aplicarEsquema(db);

    const metadatos = new MetadatosRepository(db);
    const almacenamiento = new AlmacenamientoFisico(config.raizAlmacenamiento);
    const cuotas = new CuotasRepository(config.rutaCuotas, config.cuotaPorDefecto);
    const archivoService = new ArchivoService({ metadatos, almacenamiento, cuotas });
    const validador = crearValidador(config);

    const app = express();
    app.use(express.json());

    // Sonda de salud: la usará node-monitoreo cuando exista.
    app.get("/health", (_req, res) =>
        res.json({ estado: "ok", servicio: "distributed-storage", version: "0.1.0" })
    );

    const { crearRutasAlmacenamiento } = require("./rutas/almacenamiento");
    app.use("/storage",
        crearMiddlewareAutenticacion(validador),
        crearRutasAlmacenamiento(archivoService)
    );

    app.use(manejoErrores);
    return app;
    }

    if (require.main === module) {
    const app = construirAplicacion();
    app.listen(config.puerto, () => {
        console.log("=========================================================");
        console.log(" Distributed Storage Service");
        console.log(` Puerto: ${config.puerto}`);
        console.log(` Almacenamiento: ${config.raizAlmacenamiento}`);
        console.log(` Autenticación: ${config.modoAutenticacion}`);
        console.log("=========================================================");
    });
}

module.exports = { construirAplicacion };