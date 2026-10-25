/**
 * Navegador real para las pruebas del cliente web: Microsoft Edge (o Chrome)
 * sin ventana, controlado por el protocolo DevTools (CDP) con el WebSocket
 * nativo de Node 22+. Sin dependencias.
 *
 * Registra TODAS las peticiones de red de la página (URL, método, estado) para
 * comprobar a quién habla de verdad la SPA.
 *
 * El perfil es temporal y aparte: no toca el navegador personal. La CA interna
 * no está instalada en ese perfil, así que se aceptan los certificados; la
 * validez real del certificado con la CA se comprueba aparte (suite 14).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CANDIDATOS = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium",
];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function ejecutableNavegador() {
    return process.env.UPBC_NAVEGADOR || CANDIDATOS.find((c) => fs.existsSync(c)) || null;
}

async function abrirNavegador() {
    const exe = ejecutableNavegador();
    if (!exe) throw new Error("no se encontró Edge ni Chrome (define UPBC_NAVEGADOR)");
    if (typeof WebSocket === "undefined") throw new Error("hace falta Node 22+ (WebSocket nativo)");
    const puerto = 9500 + Math.floor(Math.random() * 400);
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "upbc-e2e-nav-"));
    const proceso = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--ignore-certificate-errors", "--disable-extensions", "--disable-component-extensions-with-background-pages",
        `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`,
        "--window-size=1400,900", "about:blank"], { stdio: "ignore" });

    let ws;
    for (let i = 0; i < 80 && !ws; i++) {
        try {
            const p = (await (await fetch(`http://127.0.0.1:${puerto}/json`)).json()).find((x) => x.type === "page");
            ws = new WebSocket(p.webSocketDebuggerUrl);
        } catch { await dormir(250); }
    }
    if (!ws) { proceso.kill(); throw new Error("el navegador no abrió el puerto de depuración"); }
    await new Promise((r) => ws.addEventListener("open", r));

    let n = 0;
    const pendientes = new Map();
    const peticiones = new Map();   // requestId -> { url, metodo, estado }
    const errores = [];
    ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id) { pendientes.get(m.id)?.(m); pendientes.delete(m.id); return; }
        if (m.method === "Network.requestWillBeSent") {
            peticiones.set(m.params.requestId, { url: m.params.request.url, metodo: m.params.request.method, estado: null });
        } else if (m.method === "Network.responseReceived") {
            const p = peticiones.get(m.params.requestId);
            if (p) p.estado = m.params.response.status;
        } else if (m.method === "Runtime.exceptionThrown") {
            // Solo cuentan los errores de la página; los de extensiones del navegador no son de la SPA.
            const d = m.params.exceptionDetails || {};
            const texto = d.exception?.description || d.text || "";
            const origen = d.url || d.stackTrace?.callFrames?.[0]?.url || "";
            if (!/^(chrome|edge)-extension:|^(chrome|edge):/.test(origen) && !/(chrome|edge)-extension:\/\//.test(texto)) errores.push(texto);
        }
    });
    const cdp = (method, params = {}) => new Promise((r) => {
        const id = ++n; pendientes.set(id, r); ws.send(JSON.stringify({ id, method, params }));
    });
    await cdp("Network.enable");
    await cdp("Runtime.enable");
    await cdp("Page.enable");

    const js = async (expr) =>
        (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

    return {
        peticiones: () => [...peticiones.values()],
        errores,
        js,
        async ir(url) { await cdp("Page.navigate", { url }); },
        async esperar(expr, ms = 20000) {
            const fin = Date.now() + ms;
            while (Date.now() < fin) { if (await js(expr)) return true; await dormir(200); }
            return false;
        },
        clic: (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`),
        escribir: (sel, texto) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false;
            e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
        async captura(destino) {
            const r = await cdp("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(destino, Buffer.from(r.result.data, "base64"));
        },
        cerrar() {
            try { ws.close(); } catch { /* ya cerrado */ }
            proceso.kill();
            setTimeout(() => fs.rmSync(perfil, { recursive: true, force: true }), 1500).unref();
        },
    };
}

module.exports = { abrirNavegador, ejecutableNavegador, dormir };
