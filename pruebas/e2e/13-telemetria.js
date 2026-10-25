/**
 * 13 — PRECISIÓN de la telemetría transversal (Prometheus + Grafana).
 *
 * No basta con que Prometheus "tenga datos": aquí se comprueba que lo que
 * reporta COINCIDE con la realidad medida por otro camino.
 *
 *   Recolección   todos los objetivos arriba y cada servicio/máquina cubierto.
 *   Contadores    se hacen exactamente N peticiones y el contador de
 *                 Prometheus (y el del histograma de latencia) sube exactamente N.
 *   Negocio       se sube un archivo de B bytes y la métrica de espacio usado
 *                 del usuario sube exactamente B (y coincide con GET /storage/cuota).
 *   Máquinas      memoria total y número de CPU de cada VPS según node_exporter
 *                 = lo que dice el propio sistema operativo (por SSH).
 *   HPC           las métricas del gestor = GET /cluster/estado.
 *   Alertas       el estado de las alertas corresponde al estado real
 *                 (p. ej. clúster apagado → EjecutorHPCDesconectado disparada).
 *   Grafana       responde a través del portal (/monitoreo) con su base de datos sana.
 *
 * Prometheus solo escucha en 127.0.0.1 de pasd_nodo1: se usa un túnel SSH de
 * solo lectura (lib/ssh.js). Requiere el entorno "vps".
 */
const { pedir } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");
const ssh = require("../lib/ssh");

const N = 25;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const mon = cfg.monitoreo || {};
    if (!mon.ssh || !cfg.ssh) {
        await informe.omitir("telemetría", `el entorno ${cfg.nombre} no define el acceso SSH a Prometheus (usa --entorno vps)`);
        return;
    }
    const yo = await ctx.como("principal");
    let prom, objetivos = [];

    const consulta = async (expr) => {
        const r = await pedir(`${prom.url}/api/v1/query?query=${encodeURIComponent(expr)}`);
        if (r.estado !== 200) throw new Error(`PromQL ${expr} → ${r.estado}`);
        return r.json.data.result;
    };
    const valor = async (expr) => {
        const r = await consulta(expr);
        return r.length ? Number(r[0].value[1]) : 0;
    };
    /** Espera a que Prometheus haga un raspado nuevo (scrape_interval = 15 s) y la expresión cambie. */
    const esperarCambio = async (expr, antes, segundos = 50) => {
        const fin = Date.now() + segundos * 1000;
        let v = antes;
        while (Date.now() < fin) {
            await esperar(3000);
            v = await valor(expr);
            if (v !== antes) { await esperar(16000); return valor(expr); }   // un raspado más, por si llegó a medias
        }
        return v;
    };

    informe.seccion("Recolección de métricas");
    await informe.prueba("túnel SSH a Prometheus (127.0.0.1:9095 en pasd_nodo1) y /-/healthy", async () => {
        prom = await ssh.tunel(cfg, mon.ssh, mon.prometheusRemoto);
        ctx.alFinal("túnel a Prometheus", async () => prom.cerrar());
        const r = await pedir(`${prom.url}/-/healthy`);
        estado(r, 200);
    });
    await informe.prueba("todos los objetivos de Prometheus están arriba", async () => {
        requiere(prom, "sin túnel");
        const r = await pedir(`${prom.url}/api/v1/targets?state=active`);
        objetivos = r.json.data.activeTargets;
        const caidos = objetivos.filter((t) => t.health !== "up");
        console.log(`            ${objetivos.length} objetivos, ${caidos.length} caídos`);
        verificar(!caidos.length, caidos.map((t) => `${t.labels.job} ${t.labels.instance}: ${t.lastError}`).join("; "));
    });
    await informe.prueba("cada servicio y cada VPS tiene su objetivo (métricas, exporter o sonda)", async () => {
        requiere(objetivos.length, "sin objetivos");
        const urls = objetivos.map((t) => decodeURIComponent(t.scrapeUrl)).join(" ");
        const esperados = {
            "Storage /metrics": "node-repository:8084/metrics", "Shared File /metrics": "node-repository:8085/metrics",
            "Media /metrics": "node-media:8083/metrics", "node-web /metrics": "node-web:8080/metrics",
            "gestor HPC /metrics": "node-rmi:9102/metrics", "Authentication (sonda)": "node-soap:8081",
            "File Sync (sonda TCP)": "node-sync:9090", "OpenLDAP (sonda TCP)": "node-soap:636",
            "exporter pasd_nodo1": "node-soap:9100", "exporter pasd_nodo2": "node-repository:9100",
            "exporter pasd_nodo3": "node-media:9100",
        };
        const faltan = Object.entries(esperados).filter(([, u]) => !urls.includes(u)).map(([n]) => n);
        verificar(!faltan.length, `sin objetivo: ${faltan.join(", ")}`);
    });

    informe.seccion("Precisión: contadores y latencia");
    const sel = '{servicio="storage",metodo="GET",ruta="/storage/cuota",estado="200"}';
    const exprHisto = 'sum(http_peticion_duracion_segundos_count{servicio="storage",metodo="GET",ruta="/storage/cuota"})';
    let histoAntes;
    await informe.prueba(`${N} peticiones reales → el contador sube exactamente ${N}`, async () => {
        requiere(prom, "sin túnel");
        const expr = `sum(http_peticiones_total${sel})`;
        const antes = await valor(expr);
        histoAntes = await valor(exprHisto);
        for (let i = 0; i < N; i++) estado(await yo.storage.cuota(), 200, `petición ${i + 1}`);
        const despues = await esperarCambio(expr, antes);
        console.log(`            http_peticiones_total: ${antes} → ${despues}`);
        igual(despues - antes, N, "incremento del contador");
    });
    await informe.prueba(`el histograma de latencia registró las mismas ${N} peticiones`, async () => {
        requiere(histoAntes !== undefined, "no se midió el contador");
        // El histograma no lleva la etiqueta "estado": se compara su INCREMENTO, no el total.
        const histo = await valor(exprHisto);
        console.log(`            http_peticion_duracion_segundos_count: ${histoAntes} → ${histo}`);
        igual(histo - histoAntes, N, "observaciones nuevas en el histograma");
        const p95 = await valor('histogram_quantile(0.95, sum by (le) (rate(http_peticion_duracion_segundos_bucket{servicio="storage",ruta="/storage/cuota"}[2m])))');
        console.log(`            latencia p95 de /storage/cuota: ${(p95 * 1000).toFixed(1)} ms`);
    });

    informe.seccion("Precisión: métricas de negocio");
    await informe.prueba("subir B bytes → almacenamiento_bytes_usados del usuario sube exactamente B", async () => {
        requiere(prom, "sin túnel");
        const expr = `sum(almacenamiento_bytes_usados{usuario="${yo.uid}"})`;
        const antes = await valor(expr);
        const B = 123457;
        const r = await yo.storage.subir(ctx.nombre("telemetria.bin"), Buffer.alloc(B, 7));
        estado(r, 201);
        ctx.alFinal("archivo de telemetría", () => yo.storage.eliminar(r.json.id));
        const despues = await esperarCambio(expr, antes);
        console.log(`            ${yo.uid}: ${antes} → ${despues} bytes`);
        igual(despues - antes, B, "incremento de bytes usados");
        const cuota = (await yo.storage.cuota()).json;
        igual(despues, Number(cuota.usados), "Prometheus vs GET /storage/cuota");
    });

    informe.seccion("Precisión: métricas de las máquinas (node_exporter vs sistema operativo)");
    for (const [nodo, destino] of Object.entries(cfg.ssh.maquinas)) {
        await informe.prueba(`${nodo}: memoria total y CPUs coinciden con /proc/meminfo y nproc`, async () => {
            requiere(prom, "sin túnel");
            const so = ssh.ejecutar(cfg, destino, "grep MemTotal /proc/meminfo; nproc");
            const memSo = Number(so.match(/MemTotal:\s+(\d+)/)[1]) * 1024;
            const cpuSo = Number(so.trim().split("\n").pop());
            const memProm = await valor(`node_memory_MemTotal_bytes{nodo="${nodo}"}`);
            const cpuProm = await valor(`count(node_cpu_seconds_total{nodo="${nodo}",mode="idle"})`);
            console.log(`            memoria ${(memSo / 2 ** 30).toFixed(2)} GiB · ${cpuSo} CPU`);
            igual(memProm, memSo, "memoria total");
            igual(cpuProm, cpuSo, "número de CPU");
        });
    }

    informe.seccion("Precisión: métricas del clúster HPC y alertas");
    let cluster;
    await informe.prueba("métricas del gestor = GET /cluster/estado", async () => {
        requiere(prom, "sin túnel");
        cluster = (await yo.hpc.cluster()).json;
        const enFalla = await valor('sum(hpc_nodos{estado="EN_FALLA"})');
        const disponibles = await valor('sum(hpc_nodos{estado="DISPONIBLE"})');
        const conectado = await valor("hpc_ejecutor_conectado");
        const procesos = await valor("hpc_procesos_total");
        console.log(`            API: ${cluster.nodosDisponibles} disponibles, ${cluster.nodosEnFalla} en falla, ` +
            `ejecutor ${cluster.ejecutorConectado ? "conectado" : "DESCONECTADO"}`);
        igual(enFalla, cluster.nodosEnFalla, "nodos en falla");
        igual(disponibles, cluster.nodosDisponibles, "nodos disponibles");
        igual(conectado === 1, cluster.ejecutorConectado, "ejecutor conectado");
        igual(procesos, cluster.procesosTotales, "procesos totales");
    });
    await informe.prueba("las alertas del clúster reflejan su estado real", async () => {
        requiere(cluster, "sin estado del clúster");
        const r = await pedir(`${prom.url}/api/v1/alerts`);
        const activas = r.json.data.alerts.filter((a) => a.state === "firing").map((a) => a.labels.alertname);
        console.log(`            alertas disparadas: ${activas.length ? [...new Set(activas)].join(", ") : "ninguna"}`);
        igual(activas.includes("EjecutorHPCDesconectado"), !cluster.ejecutorConectado, "EjecutorHPCDesconectado disparada");
        igual(activas.includes("NodoHPCEnFalla"), cluster.nodosEnFalla > 0, "NodoHPCEnFalla disparada");
        verificar(!activas.includes("ServicioCaido"), "hay un servicio caído según las sondas");
    });
    await informe.prueba("las sondas de disponibilidad coinciden con una petición directa", async () => {
        requiere(prom, "sin túnel");
        const sondas = await consulta("probe_success");
        const caidas = sondas.filter((s) => s.value[1] !== "1").map((s) => s.metric.instance);
        verificar(!caidas.length, `sondas fallando: ${caidas.join(", ")}`);
        // la petición directa: el mismo /health que sondea blackbox
        estado(await pedir(`${cfg.storage.raiz || cfg.storage.api}/health`), 200, "Storage /health directo");
        console.log(`            ${sondas.length} sondas con probe_success = 1`);
    });
    await informe.prueba("reglas de alerta cargadas y evaluándose sin errores", async () => {
        requiere(prom, "sin túnel");
        const r = await pedir(`${prom.url}/api/v1/rules?type=alert`);
        const reglas = r.json.data.groups.flatMap((g) => g.rules);
        const malas = reglas.filter((x) => x.health !== "ok");
        console.log(`            ${reglas.length} reglas de alerta`);
        verificar(reglas.length >= 5, "muy pocas reglas de alerta");
        verificar(!malas.length, malas.map((x) => `${x.name}: ${x.lastError}`).join("; "));
    });

    informe.seccion("Visualización (Grafana)");
    await informe.prueba("Grafana responde por el portal (/monitoreo) con la base de datos sana", async () => {
        requiere(mon.grafanaPublico, "sin URL pública de Grafana");
        const r = await pedir(`${mon.grafanaPublico}/api/health`);
        estado(r, 200);
        igual(r.json?.database, "ok", "base de datos de Grafana");
    });
}

module.exports = { nombre: "13 Precisión de la telemetría transversal", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
