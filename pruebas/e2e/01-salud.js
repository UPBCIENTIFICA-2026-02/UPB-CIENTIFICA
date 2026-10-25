/**
 * 01 — Prueba de humo: ¿está todo arriba?
 *
 * No necesita sesión. Si esta suite falla, el resto va a fallar por la misma
 * causa: arréglala primero.
 */
const net = require("net");
const { pedir } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");

function puertoAbierto(direccion, tiempoMs = 4000) {
    const [host, puerto] = direccion.split(":");
    return new Promise((resolver) => {
        const s = net.connect({ host, port: Number(puerto), timeout: tiempoMs });
        s.once("connect", () => { s.destroy(); resolver(true); });
        s.once("timeout", () => { s.destroy(); resolver(false); });
        s.once("error", () => resolver(false));
    });
}

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;

    informe.seccion("Sondas de vida (/health) y bases de datos");
    for (const [nombre, clave] of [["Storage", "storage"], ["Shared File", "compartidos"], ["Media", "medios"]]) {
        await informe.prueba(`${nombre} GET /health → estado ok y BD ok`, async () => {
            const raiz = requiere(cfg[clave].raiz, "no se alcanza directo en este entorno (solo por la pasarela)");
            const r = await pedir(`${raiz}/health`);
            estado(r, 200);
            igual(r.json?.estado, "ok", "estado");
            if (r.json?.bd !== undefined) igual(r.json.bd, "ok", "base de datos");
        });
    }

    await informe.prueba("node-web GET /salud → arriba", async () => {
        const r = await pedir(`${cfg.web.raiz}/salud`);
        estado(r, 200);
        igual(r.json?.estado, "arriba", "estado");
    });

    await informe.prueba("job-api responde (GET /cluster/estado sin token → 401)", async () => {
        const r = await pedir(`${cfg.hpc.api}/cluster/estado`);
        estado(r, 401);
    });

    await informe.prueba("Authentication responde en su endpoint SOAP", async () => {
        requiere(cfg.auth.modo === "soap", "modo simulado: los servicios no consultan a Authentication");
        // node-soap real sirve el WSDL con ?wsdl; auth-local contesta texto a cualquier GET.
        const r = await pedir(`${cfg.auth.url}?wsdl`);
        estado(r, 200);
        verificar(/definitions|auth-local OK/.test(r.texto), "la respuesta no es el WSDL ni auth-local", r.texto);
    });

    await informe.prueba(`File Sync acepta conexiones en ${cfg.sync.direccion}`, async () => {
        verificar(await puertoAbierto(cfg.sync.direccion), "el puerto no acepta conexiones (¿syncd o la VM UbuntuServer1 apagados?)");
    });

    informe.seccion("Métricas para Prometheus (adenda A: GET /metrics sin autenticación)");
    const metricas = [
        ["node-web", cfg.web.raiz && `${cfg.web.raiz}/metrics`],
        ["Storage", cfg.storage.raiz && `${cfg.storage.raiz}/metrics`],
        ["Shared File", cfg.compartidos.raiz && `${cfg.compartidos.raiz}/metrics`],
        ["Media", cfg.medios.raiz && `${cfg.medios.raiz}/metrics`],
        ["gestor-cluster", cfg.hpc.metricas],
    ];
    for (const [nombre, url] of metricas) {
        await informe.prueba(`${nombre} expone /metrics`, async () => {
            requiere(url, "no se alcanza desde aquí en este entorno (cortafuegos: solo node-monitoreo)");
            const r = await pedir(url);
            if (nombre === "node-web" && cfg.nombre !== "local" && r.estado !== 200) {
                requiere(false, `Nginx no publica /metrics hacia fuera (estado ${r.estado}); es lo esperado`);
            }
            estado(r, 200);
            verificar(r.texto.includes("# HELP"), "no tiene formato de exposición de Prometheus");
        });
    }

    informe.seccion("Monitoreo");
    await informe.prueba("Prometheus /-/healthy", async () => {
        const url = requiere(cfg.monitoreo.prometheus, "solo escucha en 127.0.0.1 de nodo1");
        estado(await pedir(`${url}/-/healthy`), 200);
    });
    await informe.prueba("Grafana /api/health", async () => {
        const url = requiere(cfg.monitoreo.grafana, "solo escucha en 127.0.0.1 de nodo1 (se ve en /monitoreo/)");
        const r = await pedir(`${url}/api/health`);
        if (r.estado === 404) {
            // Con serve_from_sub_path la ruta cuelga de /monitoreo.
            estado(await pedir(`${url}/monitoreo/api/health`), 200);
        } else {
            estado(r, 200);
        }
    });

    await informe.prueba("Prometheus ve a todos sus objetivos arriba", async () => {
        const url = requiere(cfg.monitoreo.prometheus, "solo escucha en 127.0.0.1 de nodo1");
        const r = await pedir(`${url}/api/v1/targets?state=active`);
        estado(r, 200);
        const objetivos = r.json?.data?.activeTargets || [];
        verificar(objetivos.length > 0, "Prometheus no tiene objetivos configurados");
        const caidos = objetivos.filter((o) => o.health !== "up").map((o) => `${o.labels?.job}@${o.scrapeUrl}`);
        verificar(caidos.length === 0, `objetivos caídos: ${caidos.join(", ")}`);
    });
}

module.exports = { nombre: "01 Salud de los servicios", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
