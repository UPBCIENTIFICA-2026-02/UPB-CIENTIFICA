/**
 * Configuración de las pruebas: entorno (entornos.json) + argumentos + variables.
 *
 * Prioridad, de más a menos: argumentos de la línea de órdenes, variables de
 * entorno UPBC_*, entornos.json.
 *
 *   --entorno local|vps|vps-pasarela   (o UPBC_ENTORNO; por defecto local)
 *   --ca ruta/ca.crt                   CA interna (HTTPS de node-soap, Nginx, syncd)
 *   --modo-auth soap|simulado          cómo validan los servicios (por defecto, el del entorno)
 *   --hpc-espera 180                   segundos máximos esperando un trabajo HPC
 *   --hpc-lenguaje py|c                programa de prueba (c solo tiene sentido con OpenMPI real)
 *   --video ruta.mp4                   video para Streaming (si no, se genera con ffmpeg si lo hay)
 *   --incluir-limite-login             prueba el 429 de node-web (ver 07-pasarela-web.js)
 *   --sin-limpiar                      no borra lo que crean las pruebas
 *   --detalle                          imprime cuerpos de respuesta en los fallos
 *
 * Variables: UPBC_CLAVE_<uid> (clave de cada usuario de prueba),
 * UPBC_<SERVICIO>_API (p. ej. UPBC_STORAGE_API=http://10.0.0.5:8084).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RAIZ_PRUEBAS = path.resolve(__dirname, "..");
const RAIZ_REPO = path.resolve(RAIZ_PRUEBAS, "..");

const BANDERAS = new Set(["incluir-limite-login", "sin-limpiar", "detalle", "ayuda", "lista"]);

function leerArgumentos(argv = process.argv.slice(2)) {
    const opciones = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) { opciones._.push(a); continue; }
        const clave = a.slice(2);
        if (BANDERAS.has(clave)) { opciones[clave] = true; continue; }
        opciones[clave] = argv[++i];
    }
    return opciones;
}

/**
 * fetch no deja pasar una CA por petición: la lee de NODE_EXTRA_CA_CERTS al
 * ARRANCAR el proceso. Si llega --ca y no está puesta, se relanza el mismo
 * script con la variable y se termina con su código de salida.
 */
function relanzarConCaSiHaceFalta(args) {
    const ca = args.ca || process.env.UPBC_CA;
    if (!ca) return;
    const absoluta = path.resolve(ca);
    if (!fs.existsSync(absoluta)) {
        console.error(`No existe el certificado de la CA: ${absoluta}`);
        process.exit(2);
    }
    if (process.env.NODE_EXTRA_CA_CERTS === absoluta) return;
    const r = spawnSync(process.execPath, process.argv.slice(1), {
        stdio: "inherit",
        env: { ...process.env, NODE_EXTRA_CA_CERTS: absoluta },
    });
    process.exit(r.status ?? 1);
}

function cargarConfig(args = leerArgumentos()) {
    relanzarConCaSiHaceFalta(args);

    const entornos = JSON.parse(fs.readFileSync(path.join(RAIZ_PRUEBAS, "entornos.json"), "utf8"));
    const nombre = args.entorno || process.env.UPBC_ENTORNO || "local";
    const base = entornos[nombre];
    if (!base || nombre.startsWith("_")) {
        const validos = Object.keys(entornos).filter((k) => !k.startsWith("_")).join(", ");
        console.error(`Entorno desconocido "${nombre}". Válidos: ${validos}`);
        process.exit(2);
    }
    const cfg = structuredClone(base);
    cfg.nombre = nombre;

    for (const servicio of ["web", "storage", "compartidos", "medios", "hpc"]) {
        const env = process.env[`UPBC_${servicio.toUpperCase()}_API`];
        if (env) cfg[servicio].api = env;
    }
    if (args["modo-auth"]) cfg.auth.modo = args["modo-auth"];

    for (const u of Object.values(cfg.usuarios)) {
        const env = process.env[`UPBC_CLAVE_${u.uid}`];
        if (env) u.clave = env;
    }

    cfg.ca = args.ca ? path.resolve(args.ca) : process.env.NODE_EXTRA_CA_CERTS || null;
    cfg.hpcEsperaSeg = Number(args["hpc-espera"] || 180);
    cfg.hpcLenguaje = args["hpc-lenguaje"] || "py";
    cfg.video = args.video || null;
    cfg.ffmpeg = args.ffmpeg || process.env.UPBC_FFMPEG || "ffmpeg";
    cfg.incluirLimiteLogin = Boolean(args["incluir-limite-login"]);
    cfg.limpiar = !args["sin-limpiar"];
    cfg.detalle = Boolean(args.detalle);
    cfg.raizRepo = RAIZ_REPO;
    cfg.raizPruebas = RAIZ_PRUEBAS;
    return cfg;
}

module.exports = { cargarConfig, leerArgumentos, RAIZ_PRUEBAS, RAIZ_REPO };
