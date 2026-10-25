/**
 * "En SOA no se comparte código": ValidadorToken.js y permisos.js son COPIAS
 * deliberadas en cada servicio (CLAUDE.md, TRASPASO §11). El riesgo de una
 * copia es que alguien cambie una y olvide las demás; esta prueba lo detecta.
 *
 * Se compara el CÓDIGO, sin comentarios: cada copia puede explicar en su
 * cabecera de dónde viene.
 *
 *   node --test pruebas/unitarias
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");

function soloCodigo(archivo) {
    return fs.readFileSync(path.join(RAIZ, archivo), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")   // comentarios de bloque
        .replace(/^\s*\/\/.*$/gm, "")        // comentarios de línea completa
        .replace(/\s+\/\/[^"'`\n]*$/gm, "") // comentarios al final de la línea
        .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

function mismasCopias(archivos) {
    const [referencia, ...resto] = archivos;
    const base = soloCodigo(referencia);
    for (const otro of resto) {
        assert.equal(soloCodigo(otro), base, `${otro} se separó de ${referencia}: cambia las dos (o todas) a la vez`);
    }
}

test("ValidadorToken.js es igual en Storage, Shared File y Media", () => {
    mismasCopias([
        "node-repository/src/auth/ValidadorToken.js",
        "node-shared-file/src/auth/ValidadorToken.js",
        "node-media/src/auth/ValidadorToken.js",
    ]);
});

test("permisos.js (modelo Unix) es igual en Storage y Media", () => {
    mismasCopias([
        "node-repository/src/dominio/permisos.js",
        "node-media/src/dominio/permisos.js",
    ]);
});

test("las dos copias de permisos.js dan el mismo resultado en todos los casos", () => {
    const a = require(path.join(RAIZ, "node-repository/src/dominio/permisos.js"));
    const b = require(path.join(RAIZ, "node-media/src/dominio/permisos.js"));
    const usuarios = [{ id: "ana", grupos: ["g1"] }, { id: "beto", grupos: ["g2"] }, { id: "carla", grupos: [] }];
    const cadenas = ["rw-------", "rwxr-----", "rw-rw-r--", "---------", "r--r--r--", "------rw-"];
    for (const permisos of cadenas) {
        for (const u of usuarios) {
            const nodo = { propietario: "ana", grupo: "g1", permisos };
            assert.equal(a.puedeLeer(nodo, u), b.puedeLeer(nodo, u), `leer ${permisos} ${u.id}`);
            assert.equal(a.puedeEscribir(nodo, u), b.puedeEscribir(nodo, u), `escribir ${permisos} ${u.id}`);
        }
    }
});
