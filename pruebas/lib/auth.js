/**
 * Llamadas SOAP a Authentication (node-soap o herramientas/auth-local.js).
 *
 * Mismo sobre que construyen node-web y los ValidadorToken de los servicios:
 * XML a mano, namespace de users.wsdl y SOAPAction "<namespace>/<operacion>".
 */

function escapar(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extraer(xml, etiqueta) {
    const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`));
    return m ? m[1] : null;
}

function extraerLista(xml, etiqueta) {
    const patron = new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`, "g");
    return [...xml.matchAll(patron)].map((m) => m[1]).filter((v) => v !== "");
}

async function llamarSoap(cfgAuth, operacion, campos) {
    const cuerpo = Object.entries(campos)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `<${k}>${escapar(v)}</${k}>`)
        .join("");
    const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${operacion} xmlns="${cfgAuth.namespace}">${cuerpo}</${operacion}></soap:Body>
</soap:Envelope>`;

    let res;
    try {
        res = await fetch(cfgAuth.url, {
            method: "POST",
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                SOAPAction: `${cfgAuth.namespace}/${operacion}`,
            },
            body: sobre,
            signal: AbortSignal.timeout(10000),
        });
    } catch (e) {
        const causa = e.cause?.code || e.cause?.message || e.message;
        throw new Error(`Authentication (${cfgAuth.url}) no contesta: ${causa}. ` +
            "Si es HTTPS con la CA interna, pasa --ca ruta/ca.crt");
    }
    const xml = await res.text();
    return { estado: res.status, xml, extraer: (e) => extraer(xml, e), lista: (e) => extraerLista(xml, e) };
}

/**
 * Inicia sesión y devuelve { uid, token, grupos }.
 *
 * Con modo "simulado" no se llama a nadie: los servicios aceptan cualquier
 * "mock-token-<uid>-..." (TRASPASO §3.5), así que se fabrica uno.
 */
async function iniciarSesion(cfg, usuario) {
    if (cfg.auth.modo === "simulado") {
        return {
            uid: usuario.uid,
            token: `mock-token-${usuario.uid}-e2e${Math.random().toString(16).slice(2, 10)}`,
            grupos: ["usuarios"],
        };
    }
    if (!usuario.clave) {
        throw new Error(`Falta la clave de ${usuario.uid}: define UPBC_CLAVE_${usuario.uid}`);
    }
    const r = await llamarSoap(cfg.auth, "iniciarSesion", {
        usuario: usuario.uid, password: usuario.clave, origenCliente: "pruebas-e2e",
    });
    const token = r.extraer("token");
    if (!token) {
        throw new Error(`iniciarSesion de ${usuario.uid} no devolvió token: ` +
            `${r.extraer("message") || r.extraer("faultstring") || r.xml.slice(0, 200)}`);
    }
    return { uid: r.extraer("uid") || usuario.uid, token, grupos: r.lista("grupos") };
}

async function cerrarSesion(cfg, token) {
    if (cfg.auth.modo === "simulado") return;
    await llamarSoap(cfg.auth, "cerrarSesion", { token }).catch(() => {});
}

module.exports = { llamarSoap, iniciarSesion, cerrarSesion, extraer, extraerLista };
