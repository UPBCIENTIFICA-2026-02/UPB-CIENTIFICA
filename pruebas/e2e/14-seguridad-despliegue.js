/**
 * 14 — Esquemas de seguridad del DESPLIEGUE (complementa a 09, que prueba la
 * seguridad de las APIs: 401, tokens falsos, uid del cuerpo, inyección…).
 *
 *   Cifrado       cada canal con credenciales (HTTPS 443, SOAP 8081, gRPC 9090,
 *                 LDAPS 636) presenta un certificado válido para su IP firmado
 *                 por la CA interna, con TLS ≥ 1.2; TLS 1.0/1.1 se rechazan.
 *   Portal        HTTP 80 redirige a HTTPS y se envía HSTS.
 *   Exposición    lo que debe ser interno NO se alcanza desde fuera:
 *                 PostgreSQL, Prometheus, Grafana, blackbox, node_exporter,
 *                 métricas del gestor, LDAP sin cifrar.
 *   Cortafuegos   ufw activo en las tres VPS (por SSH, solo lectura).
 *   Autorización  el perfil "estudiantes" no tiene HPC (403) pero sí Storage.
 *   Respaldos     hay copias cifradas con GPG fuera del nodo de datos.
 *
 * Requiere el entorno "vps" y la CA interna (--ca).
 */
const fs = require("fs");
const net = require("net");
const tls = require("tls");
const { pedir } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");
const ssh = require("../lib/ssh");

function conectarTls(host, port, opciones = {}) {
    return new Promise((resolver) => {
        const s = tls.connect({ host, port, timeout: 8000, ...opciones }, () => {
            const c = s.getPeerCertificate();
            resolver({ ok: s.authorized, error: s.authorizationError, protocolo: s.getProtocol(), cn: c.subject?.CN, emisor: c.issuer?.CN, san: c.subjectaltname, vence: c.valid_to });
            s.end();
        });
        s.on("error", (e) => resolver({ ok: false, error: e.code || e.message }));
        s.on("timeout", () => { s.destroy(); resolver({ ok: false, error: "tiempo agotado" }); });
    });
}

function puertoAbierto(host, port, ms = 4000) {
    return new Promise((resolver) => {
        const s = net.connect({ host, port });
        const fin = (abierto, motivo) => { s.destroy(); resolver({ abierto, motivo }); };
        s.setTimeout(ms, () => fin(false, "filtrado (sin respuesta)"));
        s.on("connect", () => fin(true, "acepta conexiones"));
        s.on("error", (e) => fin(false, e.code === "ECONNREFUSED" ? "rechazado" : e.code));
    });
}

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    if (!cfg.ssh) {
        await informe.omitir("seguridad del despliegue", `el entorno ${cfg.nombre} no es el de las VPS (usa --entorno vps)`);
        return;
    }
    const ca = cfg.ca ? fs.readFileSync(cfg.ca) : null;
    const h1 = new URL(cfg.web.api).hostname;
    const h2 = new URL(cfg.storage.api).hostname;
    const h3 = new URL(cfg.medios.api).hostname;

    informe.seccion("Cifrado en tránsito (TLS con la CA interna)");
    for (const [nombre, host, port, alpn] of [
        ["Portal (Nginx)", h1, 443, ["http/1.1"]],
        ["Authentication SOAP", h1, 8081, ["http/1.1"]],
        ["File Sync gRPC", h2, 9090, ["h2"]],
    ]) {
        await informe.prueba(`${nombre} ${host}:${port}: certificado válido para la IP, firmado por la CA, TLS ≥ 1.2`, async () => {
            requiere(ca, "pasa --ca con la CA interna");
            const r = await conectarTls(host, port, { ca, ALPNProtocols: alpn });
            verificar(r.ok, `rechazado: ${r.error}`);
            verificar(["TLSv1.2", "TLSv1.3"].includes(r.protocolo), `protocolo ${r.protocolo}`);
            console.log(`            ${r.protocolo} · CN=${r.cn} · emisor "${r.emisor}" · vence ${r.vence}`);
        });
    }
    for (const [nombre, host, port] of [["Portal", h1, 443], ["Authentication", h1, 8081]]) {
        await informe.prueba(`${nombre}: rechaza TLS 1.0 y 1.1`, async () => {
            for (const v of ["TLSv1", "TLSv1.1"]) {
                const r = await conectarTls(host, port, {
                    minVersion: v, maxVersion: v, rejectUnauthorized: false, ciphers: "DEFAULT@SECLEVEL=0",
                });
                verificar(!r.protocolo, `aceptó ${r.protocolo}`);
            }
        });
    }
    await informe.prueba("OpenLDAP LDAPS (solo local en pasd_nodo1): certificado verificado con la CA", async () => {
        // LDAPS no se publica: solo lo usa node-soap en la misma máquina. Se verifica desde dentro.
        const salida = ssh.ejecutar(cfg, cfg.ssh.maquinas.pasd_nodo1,
            "echo | timeout 8 openssl s_client -connect 127.0.0.1:636 -verify_return_error 2>&1 | grep -E 'issuer=|Verify return code|Protocol *:' ");
        verificar(/Verify return code: 0 \(ok\)/.test(salida), salida.trim() || "sin respuesta en 127.0.0.1:636");
        console.log(`            ${salida.trim().split("\n").map((l) => l.trim()).join(" · ")}`);
    });
    await informe.prueba("un certificado ajeno a la CA interna no se acepta (prueba de control)", async () => {
        const r = await conectarTls(h1, 443, { ca: [] });   // sin la CA: debe fallar la verificación
        verificar(!r.ok, "se aceptó sin la CA interna: la verificación no está funcionando");
    });

    informe.seccion("Portal web");
    await informe.prueba("http://… redirige a https://… (301)", async () => {
        const r = await pedir(`http://${h1}/`);
        estado(r, [301, 308]);
        verificar((r.cabeceras.get("location") || "").startsWith("https://"), `Location: ${r.cabeceras.get("location")}`);
    });
    await informe.prueba("HSTS, nosniff y X-Frame-Options en las respuestas", async () => {
        const r = await pedir(`${cfg.web.api}/`);
        const hsts = r.cabeceras.get("strict-transport-security");
        verificar(hsts, "falta Strict-Transport-Security");
        // Los navegadores toman el primer valor: "nosniff, nosniff" (Nginx y node-web la ponen ambos) es válido.
        const nosniff = r.cabeceras.get("x-content-type-options") || "";
        verificar(nosniff.split(",")[0].trim().toLowerCase() === "nosniff", `X-Content-Type-Options: ${nosniff}`);
        verificar(/deny/i.test(r.cabeceras.get("x-frame-options") || ""), "falta X-Frame-Options DENY");
        console.log(`            HSTS "${hsts}"` + (nosniff.includes(",") ? " · aviso: nosniff duplicada (Nginx y node-web)" : ""));
    });

    informe.seccion("Exposición: lo interno no se alcanza desde fuera");
    for (const [nombre, host, port] of [
        ["PostgreSQL de Storage/Shared File", h2, 5432], ["PostgreSQL de Media", h3, 5432],
        ["Prometheus", h1, 9095], ["Grafana (directo, sin portal)", h1, 3000], ["blackbox_exporter", h1, 9115],
        ["node_exporter pasd_nodo2", h2, 9100], ["métricas del gestor HPC", h3, 9102], ["LDAP sin cifrar", h1, 389], ["LDAPS (solo local)", h1, 636],
    ]) {
        await informe.prueba(`${nombre} (${host}:${port}) cerrado`, async () => {
            const r = await puertoAbierto(host, port);
            verificar(!r.abierto, "el puerto acepta conexiones desde este equipo");
            console.log(`            ${r.motivo}`);
        });
    }

    informe.seccion("Cortafuegos de las VPS");
    for (const [nodo, destino] of Object.entries(cfg.ssh.maquinas)) {
        await informe.prueba(`${nodo}: ufw activo`, async () => {
            const salida = ssh.ejecutar(cfg, destino, "sudo -n ufw status 2>/dev/null | head -1 || echo 'sin permiso'");
            verificar(/Status: active|Estado: activo/i.test(salida), salida.trim());
        });
    }

    informe.seccion("Autorización por perfil (mapa de servicios del directorio)");
    await informe.prueba("estudiante: Storage permitido, HPC prohibido (403)", async () => {
        const est = await ctx.como("restringido");
        estado(await est.storage.cuota(), 200, "Storage");
        estado(await est.hpc.listar(), 403, "HPC");
    });

    informe.seccion("Respaldos cifrados (GPG)");
    await informe.prueba("hay respaldos .gpg en el destino fuera del nodo de datos (pasd_nodo3)", async () => {
        const salida = ssh.ejecutar(cfg, cfg.ssh.maquinas.pasd_nodo3,
            "sudo -n find /srv /var/backups /home /opt -xdev -name '*.gpg' -size +0 2>/dev/null | head -3; true");
        verificar(salida.trim(), "no se encontró ningún respaldo .gpg (falta generar la llave del custodio: generar-llaves-respaldo.sh)");
        console.log(`            ${salida.trim().split("\n")[0]}`);
    });
}

module.exports = { nombre: "14 Seguridad del despliegue (TLS, exposición, cortafuegos, respaldos)", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
