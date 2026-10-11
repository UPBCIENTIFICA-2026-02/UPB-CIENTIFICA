const config = require("../config");
const { crearPool, aplicarEsquema } = require("./db");

(async () => {
  const pool = crearPool(config.databaseUrl);
  await aplicarEsquema(pool);
  console.log("Esquema de catalogo-medios aplicado");
  await pool.end();
})().catch((e) => {
  console.error("Error aplicando el esquema:", e.message);
  process.exit(1);
});