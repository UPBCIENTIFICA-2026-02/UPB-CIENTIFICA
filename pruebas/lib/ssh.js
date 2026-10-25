/**
 * Acceso SSH de SOLO LECTURA a las VPS para las pruebas de telemetría y de
 * seguridad del despliegue: túneles hacia lo que solo escucha en 127.0.0.1
 * (Prometheus) y comandos de consulta (meminfo, nproc, ufw status, ss).
 *
 * Usa la llave de despliegue (entornos.json → ssh.llave) en modo BatchMode:
 * nunca pide contraseña ni guarda claves.
 */
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const os = require("os");
const path = require("path");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function llave(cfg) {
    const l = cfg.ssh?.llave;
    if (!l) return null;
    return l.startsWith("~") ? path.join(os.homedir(), l.slice(1)) : l;
}

const OPCIONES = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];

/** Ejecuta un comando de consulta en una VPS y devuelve su salida (lanza si falla). */
function ejecutar(cfg, destino, comando) {
    const r = spawnSync("ssh", ["-i", llave(cfg), ...OPCIONES, destino, comando], { encoding: "utf8", timeout: 30000 });
    if (r.error) throw new Error(`ssh ${destino}: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`ssh ${destino} (${r.status}): ${(r.stderr || "").trim().slice(0, 200)}`);
    return r.stdout;
}

/** Abre un túnel local → remoto y espera a que el puerto local acepte conexiones. */
async function tunel(cfg, destino, remoto) {
    const puerto = 19000 + Math.floor(Math.random() * 900);
    const p = spawn("ssh", ["-i", llave(cfg), ...OPCIONES, "-o", "ExitOnForwardFailure=yes", "-N",
        "-L", `${puerto}:${remoto}`, destino], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
        if (p.exitCode !== null) throw new Error(`el túnel SSH a ${destino} se cerró (código ${p.exitCode})`);
        const listo = await new Promise((r) => {
            const s = net.connect(puerto, "127.0.0.1", () => { s.end(); r(true); });
            s.on("error", () => r(false));
        });
        if (listo) return { url: `http://127.0.0.1:${puerto}`, cerrar: () => p.kill() };
        await dormir(250);
    }
    p.kill();
    throw new Error(`el túnel SSH a ${destino} no abrió en 15 s`);
}

module.exports = { ejecutar, tunel, llave };
