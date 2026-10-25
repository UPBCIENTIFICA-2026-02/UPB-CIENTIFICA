#!/usr/bin/env node
/**
 * Ejecuta TODAS las pruebas unitarias del monorepo, cada una con su herramienta:
 *
 *   node --test   node-repository, node-shared-file, node-web, pruebas/unitarias
 *   mvn test      RMIUPBCientifica (common, gestor-cluster, job-api, job-runner)
 *   go test       node-sync (en Windows se omite: el Control inteligente de
 *                 aplicaciones bloquea los binarios de Go; córrelo en UbuntuServer1)
 *
 *   node pruebas/unitarias.js            todas
 *   node pruebas/unitarias.js node       solo las de Node
 *   node pruebas/unitarias.js java go    solo esas
 *
 * No necesita servicios levantados ni bases de datos.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { colores } = require("./lib/informe");

const RAIZ = path.resolve(__dirname, "..");
const WINDOWS = process.platform === "win32";

function buscarMaven() {
    const enPath = spawnSync(WINDOWS ? "where" : "which", ["mvn"], { encoding: "utf8" });
    if (enPath.status === 0) return "mvn";
    // Herramientas portables del PC de desarrollo (TRASPASO §3.6).
    const sdk = path.join(os.homedir(), "sdk");
    if (!fs.existsSync(sdk)) return null;
    for (const d of fs.readdirSync(sdk).filter((n) => /maven/i.test(n))) {
        const mvn = path.join(sdk, d, "bin", WINDOWS ? "mvn.cmd" : "mvn");
        if (fs.existsSync(mvn)) return mvn;
    }
    return null;
}

function correr(titulo, comando, args, cwd) {
    console.log(`\n${colores.gris("─".repeat(70))}\n▶ ${titulo}\n  ${colores.gris(`${comando} ${args.join(" ")}  (en ${path.relative(RAIZ, cwd) || "."})`)}`);
    const inicio = Date.now();
    // shell: npm y mvn son .cmd en Windows.
    const r = spawnSync(comando, args, { cwd, stdio: "inherit", shell: WINDOWS });
    return { titulo, ok: r.status === 0, segundos: (Date.now() - inicio) / 1000 };
}

const grupos = {
    node: () => [
        ...["node-repository", "node-shared-file", "node-web"].map((d) =>
            correr(`${d} (node:test)`, "npm", ["test", "--silent"], path.join(RAIZ, d))),
        correr("copias deliberadas entre servicios", process.execPath,
            ["--test", "pruebas/unitarias/*.test.js"], RAIZ),
    ],
    java: () => {
        const mvn = buscarMaven();
        if (!mvn) return [{ titulo: "RMIUPBCientifica (Maven)", omitida: "no se encontró mvn en el PATH ni en %USERPROFILE%\\sdk" }];
        return [correr("RMIUPBCientifica (JUnit, Maven)", mvn, ["-q", "test"], path.join(RAIZ, "RMIUPBCientifica"))];
    },
    go: () => {
        if (WINDOWS) {
            return [{ titulo: "node-sync (go test)", omitida: "Windows bloquea los binarios de Go: ejecuta 'go test ./...' en UbuntuServer1" }];
        }
        return [correr("node-sync (go test)", "go", ["test", "./..."], path.join(RAIZ, "node-sync"))];
    },
};

const pedidos = process.argv.slice(2).filter((a) => grupos[a]);
const resultados = (pedidos.length ? pedidos : Object.keys(grupos)).flatMap((g) => grupos[g]());

console.log(`\n${"═".repeat(70)}`);
for (const r of resultados) {
    const marca = r.omitida ? colores.amarillo("–") : r.ok ? colores.verde("✓") : colores.rojo("✗");
    const extra = r.omitida ? colores.gris(r.omitida) : colores.gris(`${r.segundos.toFixed(1)} s`);
    console.log(` ${marca} ${r.titulo.padEnd(42)} ${extra}`);
}
const fallas = resultados.filter((r) => !r.omitida && !r.ok).length;
console.log("═".repeat(70));
process.exit(fallas ? 1 : 0);
