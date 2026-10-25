#!/usr/bin/env node
/**
 * Prueba de carga: N usuarios virtuales repiten operaciones reales durante un
 * tiempo y se mide latencia (p50/p95/p99), rendimiento y errores por operación.
 *
 * Sirve para la sección de resultados del informe y para ver dónde está el
 * cuello de botella (la caché de 5 s del ValidadorSoap existe justo para que
 * Authentication no lo sea).
 *
 *   node pruebas/carga/carga.js                          10 usuarios, 30 s, escenario mixto
 *   node pruebas/carga/carga.js --usuarios 50 --duracion 60 --escenario lectura
 *   node pruebas/carga/carga.js --entorno vps-pasarela --ca ruta/ca.crt
 *
 * Escenarios:
 *   lectura   cuota, listar Home, álbum, catálogo, lista de trabajos
 *   mixto     lo anterior + subir, descargar (con Range) y borrar un archivo de 64 KB
 *   escritura solo subir/descargar/borrar
 *
 * Umbrales (código de salida 1 si se superan): --max-errores 1 (%), --max-p95 2000 (ms).
 * Los usuarios virtuales se reparten entre los usuarios de prueba de entornos.json.
 */
const { cargarConfig, leerArgumentos } = require("../lib/config");
const { Contexto, cerrarSesiones } = require("../lib/contexto");
const { Informe, colores } = require("../lib/informe");

const args = leerArgumentos();
const cfg = cargarConfig(args);
const USUARIOS = Number(args.usuarios || 10);
const DURACION_S = Number(args.duracion || 30);
const ESCENARIO = args.escenario || "mixto";
const MAX_ERRORES = Number(args["max-errores"] ?? 1);
const MAX_P95 = Number(args["max-p95"] ?? 2000);
const RAMPA_MS = Math.min(5000, DURACION_S * 200);

const medidas = new Map(); // operación -> { ms: [], errores, estados: Map }

function anotar(op, ms, ok, estado) {
    if (!medidas.has(op)) medidas.set(op, { ms: [], errores: 0, estados: new Map() });
    const m = medidas.get(op);
    m.ms.push(ms);
    if (!ok) {
        m.errores++;
        m.estados.set(estado, (m.estados.get(estado) || 0) + 1);
    }
}

async function medir(op, fn, esperado = [200]) {
    const t = performance.now();
    try {
        const r = await fn();
        anotar(op, performance.now() - t, esperado.includes(r.estado), r.estado);
        return r;
    } catch (e) {
        anotar(op, performance.now() - t, false, e.sinRespuesta ? "sin respuesta" : e.message);
        return null;
    }
}

const percentil = (ordenados, p) => ordenados.length ? ordenados[Math.min(ordenados.length - 1, Math.floor(p / 100 * ordenados.length))] : 0;

async function usuarioVirtual(n, c, fin) {
    const contenido = Buffer.alloc(64 * 1024, n % 256);
    let i = 0;
    while (Date.now() < fin) {
        if (ESCENARIO !== "escritura") {
            await medir("storage: cuota", () => c.storage.cuota());
            await medir("storage: listar Home", () => c.storage.listar("root"));
            // Página 1: la 0 dispara el refresco del índice (como mucho 1/min por usuario).
            await medir("album: fotos", () => c.medios.fotos({ pagina: 1 }));
            await medir("streaming: catálogo", () => c.medios.catalogo({ pagina: 1 }));
            await medir("hpc: listar trabajos", () => c.hpc.listar(), [200, 403]);
        }
        if (ESCENARIO !== "lectura") {
            const nombre = `carga-${process.pid}-${n}-${i++}.bin`;
            const s = await medir("storage: subir 64 KB", () => c.storage.subir(nombre, contenido), [201]);
            if (s?.json?.id) {
                await medir("storage: descargar", () => c.storage.descargar(s.json.id));
                await medir("storage: descargar Range", () => c.storage.descargar(s.json.id, "bytes=0-1023"), [206]);
                await medir("storage: borrar", () => c.storage.eliminar(s.json.id), [204]);
            }
        }
    }
}

async function main() {
    const ctx = new Contexto(cfg, new Informe("carga"));
    const roles = Object.keys(cfg.usuarios);
    const clientes = [];
    for (const rol of roles) clientes.push(await ctx.como(rol));

    console.log(`Prueba de carga — entorno ${cfg.nombre}, escenario ${ESCENARIO}`);
    console.log(`  ${USUARIOS} usuarios virtuales · ${DURACION_S} s · rampa ${RAMPA_MS} ms · usuarios reales: ${clientes.map((c) => c.uid).join(", ")}`);

    const inicio = Date.now();
    const fin = inicio + DURACION_S * 1000;
    const progreso = setInterval(() => {
        const ops = [...medidas.values()].reduce((a, m) => a + m.ms.length, 0);
        process.stdout.write(`\r  ${Math.round((Date.now() - inicio) / 1000)} s · ${ops} operaciones   `);
    }, 1000);

    await Promise.all(Array.from({ length: USUARIOS }, async (_, n) => {
        await new Promise((r) => setTimeout(r, (RAMPA_MS / USUARIOS) * n));
        return usuarioVirtual(n, clientes[n % clientes.length], fin);
    }));
    clearInterval(progreso);
    const segundos = (Date.now() - inicio) / 1000;
    await cerrarSesiones(cfg);

    console.log(`\n\n  ${"operación".padEnd(26)} ${"n".padStart(6)} ${"op/s".padStart(7)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"p99".padStart(7)} ${"máx".padStart(7)} ${"errores".padStart(9)}`);
    let totalOps = 0, totalErr = 0, peorP95 = 0;
    const problemas = [];
    for (const [op, m] of medidas) {
        const o = [...m.ms].sort((a, b) => a - b);
        const p95 = percentil(o, 95);
        totalOps += o.length;
        totalErr += m.errores;
        peorP95 = Math.max(peorP95, p95);
        const pct = (m.errores / o.length) * 100;
        const linea = `  ${op.padEnd(26)} ${String(o.length).padStart(6)} ${(o.length / segundos).toFixed(1).padStart(7)} ` +
            `${percentil(o, 50).toFixed(0).padStart(7)} ${p95.toFixed(0).padStart(7)} ${percentil(o, 99).toFixed(0).padStart(7)} ` +
            `${o[o.length - 1].toFixed(0).padStart(7)} ${`${pct.toFixed(1)}%`.padStart(9)}`;
        console.log(pct > MAX_ERRORES || p95 > MAX_P95 ? colores.rojo(linea) : linea);
        if (m.errores) problemas.push(`${op}: ${[...m.estados].map(([e, n]) => `${n}× ${e}`).join(", ")}`);
    }
    const pctTotal = totalOps ? (totalErr / totalOps) * 100 : 100;
    console.log(`\n  Total ${totalOps} operaciones en ${segundos.toFixed(1)} s = ${(totalOps / segundos).toFixed(1)} op/s · errores ${pctTotal.toFixed(2)}%`);
    if (problemas.length) console.log(colores.amarillo(`  Errores por estado:\n    ${problemas.join("\n    ")}`));

    const ok = pctTotal <= MAX_ERRORES && peorP95 <= MAX_P95;
    console.log(ok
        ? colores.verde(`\n  Dentro de los umbrales (errores ≤ ${MAX_ERRORES}%, p95 ≤ ${MAX_P95} ms).`)
        : colores.rojo(`\n  Fuera de los umbrales (errores ≤ ${MAX_ERRORES}%, p95 ≤ ${MAX_P95} ms).`));
    process.exitCode = ok ? 0 : 1; // no exit(): ver ejecutar.js
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
