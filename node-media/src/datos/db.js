const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

function crearPool(connectionString) {
    const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });
    pool.on("error", (err) => console.error("[postgres] error en cliente inactivo:", err));
    return pool;
}

async function aplicarEsquema(pool) {
    const sql = fs.readFileSync(
        path.join(__dirname, "..", "..", "db", "schema.sql"), "utf-8"
    );
    await pool.query(sql);
}

module.exports = { crearPool, aplicarEsquema };