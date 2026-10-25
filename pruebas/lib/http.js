/**
 * Cliente HTTP mínimo sobre fetch (Node 18+), sin dependencias.
 *
 * Siempre devuelve { estado, cabeceras, bytes, texto, json } y nunca lanza por
 * un estado 4xx/5xx: las pruebas comprueban los errores tanto como los aciertos.
 * Sí lanza si el servicio no contesta (conexión rechazada, tiempo agotado).
 */

async function pedir(url, opciones = {}) {
    const {
        metodo = "GET", token, json, cuerpo, formulario, cabeceras = {}, tiempoMs = 20000,
    } = opciones;

    const h = { ...cabeceras };
    if (token) h.Authorization = `Bearer ${token}`;

    let body = cuerpo;
    if (json !== undefined) {
        body = typeof json === "string" ? json : JSON.stringify(json);
        h["Content-Type"] = h["Content-Type"] || "application/json";
    }
    if (formulario) body = formulario;

    const inicio = performance.now();
    let res;
    try {
        res = await fetch(url, {
            method: metodo, headers: h, body, redirect: "manual",
            signal: AbortSignal.timeout(tiempoMs),
        });
    } catch (e) {
        const causa = e.cause?.code || e.cause?.message || e.message;
        const err = new Error(`${metodo} ${url} no contesta (${causa})`);
        err.sinRespuesta = true;
        throw err;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - inicio;
    const tipo = res.headers.get("content-type") || "";
    const texto = /json|text|xml|html/.test(tipo) || !tipo ? bytes.toString("utf8") : "";

    let datos;
    if (tipo.includes("json")) {
        try { datos = JSON.parse(texto); } catch { datos = undefined; }
    }
    return { estado: res.status, cabeceras: res.headers, bytes, texto, json: datos, ms };
}

/** FormData con un único archivo en el campo "archivo" (el que espera Storage). */
function formularioArchivo(nombre, contenido, tipo = "application/octet-stream") {
    const form = new FormData();
    form.append("archivo", new Blob([contenido], { type: tipo }), nombre);
    return form;
}

module.exports = { pedir, formularioArchivo };
