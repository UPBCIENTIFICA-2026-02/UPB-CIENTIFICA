// Script de inicialización: npm run init-db
const config = require("../config");
const { abrirConexion, aplicarEsquema } = require("./db");

const db = abrirConexion(config.rutaBd);
aplicarEsquema(db);
console.log(`Esquema aplicado en ${config.rutaBd}`);
db.close();