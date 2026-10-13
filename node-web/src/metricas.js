/**
 * Métricas para Prometheus (módulo de monitoreo, M1): disponibilidad, tráfico,
 * errores y latencia de este servicio, más CPU y memoria del proceso.
 *
 *   http_peticiones_total{metodo,ruta,estado}
 *   http_peticion_duracion_segundos{metodo,ruta}   (histograma)
 *   process_* / nodejs_*                           (prom-client por defecto)
 *
 * `ruta` es la PLANTILLA de Express (/storage/archivos/:id), no la URL real:
 * con ids en la etiqueta, Prometheus guardaría una serie por archivo.
 *
 * GET /metrics no lleva token: lo lee Prometheus desde node-monitoreo. En
 * producción el cortafuegos de la VM solo deja llegar a node-monitoreo
 * (análisis de vulnerabilidades, V-13). Copia deliberada en cada servicio:
 * en SOA no se comparte código, se comparte contrato.
 */
import client from "prom-client";

function rutaDe(req) {
    if (req.route) return `${req.baseUrl || ""}${req.route.path}`;
    return req.baseUrl || "otra";
}

/**
 * @param servicio  nombre que aparece en la etiqueta `servicio`
 * @param extras    (registro, client) => void, para métricas propias del servicio
 */
function crearMetricas(servicio, extras = () => {}) {
    const registro = new client.Registry();
    registro.setDefaultLabels({ servicio });
    client.collectDefaultMetrics({ register: registro });

    const peticiones = new client.Counter({
        name: "http_peticiones_total",
        help: "Peticiones HTTP atendidas, por método, ruta y código de estado.",
        labelNames: ["metodo", "ruta", "estado"],
        registers: [registro],
    });
    const duracion = new client.Histogram({
        name: "http_peticion_duracion_segundos",
        help: "Tiempo de respuesta de las peticiones HTTP.",
        labelNames: ["metodo", "ruta"],
        buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30],
        registers: [registro],
    });
    extras(registro, client);

    function middleware(req, res, siguiente) {
        if (req.path === "/metrics") return siguiente();
        const fin = duracion.startTimer();
        res.on("finish", () => {
            const etiquetas = { metodo: req.method, ruta: rutaDe(req) };
            fin(etiquetas);
            peticiones.inc({ ...etiquetas, estado: String(res.statusCode) });
        });
        siguiente();
    }

    async function endpoint(_req, res) {
        res.set("Content-Type", registro.contentType);
        res.end(await registro.metrics());
    }

    return { middleware, endpoint };
}

export { crearMetricas };
