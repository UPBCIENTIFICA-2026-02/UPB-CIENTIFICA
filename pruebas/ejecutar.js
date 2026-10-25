#!/usr/bin/env node
/**
 * Ejecuta las suites E2E de pruebas/e2e/ en orden y deja el resultado en
 * pruebas/resultados/ (JSON + JUnit XML, que sirve como evidencia para el
 * informe o para cualquier visor de pruebas).
 *
 *   node pruebas/ejecutar.js                      todas, entorno local
 *   node pruebas/ejecutar.js storage compartir    solo las que contienen esas palabras
 *   node pruebas/ejecutar.js 01 03                por número
 *   node pruebas/ejecutar.js --entorno vps-pasarela --ca C:\ruta\upbc-ca.crt
 *   node pruebas/ejecutar.js --lista              muestra las suites y sale
 *
 * Opciones comunes: ver lib/config.js. Código de salida 0 solo si no hay fallas.
 */
const fs = require("fs");
const path = require("path");
const { cargarConfig, leerArgumentos } = require("./lib/config");
const { Informe, colores } = require("./lib/informe");
const { Contexto, cerrarSesiones, ID_EJECUCION } = require("./lib/contexto");

const DIR_SUITES = path.join(__dirname, "e2e");
const DIR_RESULTADOS = path.join(__dirname, "resultados");

function suites(filtros) {
    const todas = fs.readdirSync(DIR_SUITES).filter((f) => /^\d+.*\.js$/.test(f)).sort();
    if (!filtros.length) return todas;
    return todas.filter((f) => filtros.some((p) => f.toLowerCase().includes(p.toLowerCase())));
}

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function junit(resultadosPorSuite) {
    const bloques = resultadosPorSuite.map(({ nombre, resultados, duracionMs }) => {
        const fallas = resultados.filter((r) => r.resultado === "FALLA").length;
        const omitidas = resultados.filter((r) => r.resultado === "OMITIDA").length;
        const casos = resultados.map((r) => {
            const t = ((r.duracionMs || 0) / 1000).toFixed(3);
            const nombreCaso = r.seccion ? `${r.seccion} › ${r.nombre}` : r.nombre;
            const cuerpo = r.resultado === "FALLA" ? `<failure message="${xml(r.motivo)}"/>`
                : r.resultado === "OMITIDA" ? `<skipped message="${xml(r.motivo)}"/>` : "";
            return `    <testcase classname="${xml(nombre)}" name="${xml(nombreCaso)}" time="${t}">${cuerpo}</testcase>`;
        }).join("\n");
        return `  <testsuite name="${xml(nombre)}" tests="${resultados.length}" failures="${fallas}" skipped="${omitidas}" time="${(duracionMs / 1000).toFixed(3)}">\n${casos}\n  </testsuite>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="UPB-CIENTIFICA E2E">\n${bloques.join("\n")}\n</testsuites>\n`;
}

async function main() {
    const args = leerArgumentos();
    const archivos = suites(args._);

    if (args.lista || args.ayuda) {
        console.log("Suites disponibles:");
        for (const f of suites([])) console.log(`  ${f.padEnd(28)} ${require(path.join(DIR_SUITES, f)).nombre}`);
        console.log("\nOpciones: ver la cabecera de pruebas/lib/config.js");
        return;
    }
    if (!archivos.length) {
        console.error(`Ninguna suite coincide con: ${args._.join(", ")}. Usa --lista.`);
        process.exit(2);
    }

    const cfg = cargarConfig(args);
    console.log("UPB-CIENTÍFICA — pruebas de punta a punta");
    console.log(`  entorno ${cfg.nombre} (${cfg.descripcion})`);
    console.log(`  auth ${cfg.auth.modo} · ejecución ${ID_EJECUCION} · ${archivos.length} suites` +
        (cfg.ca ? ` · CA ${cfg.ca}` : ""));

    const porSuite = [];
    const inicioTotal = Date.now();
    for (const archivo of archivos) {
        const suite = require(path.join(DIR_SUITES, archivo));
        const informe = new Informe(suite.nombre, { detalle: cfg.detalle });
        const ctx = new Contexto(cfg, informe);
        console.log(`\n▶ ${suite.nombre}`);
        const inicio = Date.now();
        try {
            await suite.ejecutar(ctx);
        } catch (e) {
            console.log(colores.rojo(`\n  La suite se detuvo: ${e.message}`));
            informe.resultados.push({ suite: suite.nombre, nombre: "(suite detenida)", resultado: "FALLA", motivo: e.message });
        } finally {
            await ctx.limpiar();
        }
        porSuite.push({ nombre: suite.nombre, resultados: informe.resultados, duracionMs: Date.now() - inicio, conteo: informe.contar() });
    }
    await cerrarSesiones(cfg);

    // ------------------------------------------------------------- resumen
    console.log(`\n${"═".repeat(72)}`);
    const total = { OK: 0, FALLA: 0, OMITIDA: 0 };
    for (const s of porSuite) {
        for (const k of Object.keys(total)) total[k] += s.conteo[k];
        const marca = s.conteo.FALLA ? colores.rojo("✗") : colores.verde("✓");
        console.log(` ${marca} ${s.nombre.padEnd(46)} ${String(s.conteo.OK).padStart(3)} ok ${String(s.conteo.FALLA).padStart(3)} fallas ${String(s.conteo.OMITIDA).padStart(3)} omit. ${colores.gris(`${(s.duracionMs / 1000).toFixed(1)} s`)}`);
    }
    console.log("═".repeat(72));
    console.log(` Total: ${total.OK} OK · ${total.FALLA} fallas · ${total.OMITIDA} omitidas · ${((Date.now() - inicioTotal) / 1000).toFixed(1)} s`);

    const fallas = porSuite.flatMap((s) => s.resultados.filter((r) => r.resultado === "FALLA"));
    if (fallas.length) {
        console.log(colores.rojo("\n Fallas:"));
        for (const f of fallas) console.log(`  - [${f.suite}] ${f.nombre}\n      ${f.motivo}`);
    }

    fs.mkdirSync(DIR_RESULTADOS, { recursive: true });
    const base = path.join(DIR_RESULTADOS, `e2e-${cfg.nombre}-${ID_EJECUCION}`);
    fs.writeFileSync(`${base}.json`, JSON.stringify({
        ejecucion: ID_EJECUCION, fecha: new Date().toISOString(), entorno: cfg.nombre, auth: cfg.auth.modo,
        total, suites: porSuite,
    }, null, 2));
    fs.writeFileSync(`${base}.xml`, junit(porSuite));
    console.log(colores.gris(`\n Resultados: ${path.relative(process.cwd(), base)}.json / .xml`));

    // exitCode y no exit(): en Windows, salir con sockets de fetch abiertos aborta Node.
    process.exitCode = total.FALLA === 0 ? 0 : 1;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
