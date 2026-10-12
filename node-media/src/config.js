require("dotenv").config();
const path = require("path");

module.exports = {
    puerto: Number(process.env.PUERTO || 8083),
    databaseUrl: process.env.DATABASE_URL,
    fuenteMedios: process.env.FUENTE_MEDIOS || "storage-api",
    urlStorage: process.env.URL_STORAGE || "http://node-repository:8084",
    // Shared File (shared-file-svc), en la VM node-repository. Lo compartido con
    // el usuario también sale en su álbum y su catálogo.
    urlCompartidos: process.env.URL_COMPARTIDOS || "http://node-repository:8085",
    raizNfs: process.env.RAIZ_NFS || "/srv/home",
    dirMiniaturas: path.resolve(process.env.DIR_MINIATURAS || "./miniaturas"),
    anchoMiniatura: Number(process.env.ANCHO_MINIATURA || 320),
    ffmpegBin: process.env.FFMPEG_BIN || "ffmpeg",
    ffprobeBin: process.env.FFPROBE_BIN || "ffprobe",
    modoAutenticacion: process.env.MODO_AUTENTICACION || "simulado",
    urlAuthSoap: process.env.URL_AUTH_SOAP,
    namespaceAuth: process.env.NAMESPACE_AUTH || "urn:upbcientifica-auth",
};