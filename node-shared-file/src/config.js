require("dotenv").config();

const modoAutenticacion = process.env.MODO_AUTENTICACION || "simulado";

module.exports = {
    puerto: Number(process.env.PUERTO || 8085),
    databaseUrl: process.env.DATABASE_URL,
    urlStorage: process.env.URL_STORAGE || "http://127.0.0.1:8084",
    modoAutenticacion,
    modoDirectorio: process.env.MODO_DIRECTORIO || modoAutenticacion,
    urlAuthSoap: process.env.URL_AUTH_SOAP,
    namespaceAuth: process.env.NAMESPACE_AUTH || "http://192.168.1.195/soap",
    plantillaHome: process.env.PLANTILLA_HOME || "/srv/home/{uid}",
};
