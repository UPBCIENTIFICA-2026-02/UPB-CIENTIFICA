require("dotenv").config();
const path = require("path");

module.exports = {
    puerto: Number(process.env.PUERTO || 8084),
    raizAlmacenamiento: process.env.RAIZ_ALMACENAMIENTO || "/srv/home",
    rutaBd: path.resolve(process.env.RUTA_BD || "./datos/metadatos.db"),
    cuotaPorDefecto: Number(process.env.CUOTA_POR_DEFECTO || 5368709120),
    rutaCuotas: path.resolve(process.env.RUTA_CUOTAS || "./cuotas.conf"),
    modoAutenticacion: process.env.MODO_AUTENTICACION || "simulado",
    urlAuthSoap: process.env.URL_AUTH_SOAP,
    namespaceAuth: process.env.NAMESPACE_AUTH || "urn:upbcientifica-auth",
};