/**
 * 07 — node-web: portal, sesión por SOAP y pasarela /api/* (como el navegador).
 *
 * Contrato: node-web/docs/contratos.md y FrontWebUPBCientifica/docs/PASARELA.md.
 * La pasarela reenvía 1 a 1 SIN validar: el servicio de destino es quien
 * valida el token. Aquí se comprueba que pasan intactos el estado, el cuerpo,
 * las subidas multipart y las cabeceras Range.
 *
 * --incluir-limite-login prueba el 429 tras 5 fallos. Se deja fuera por
 * defecto porque cuenta para el límite POR IP (20 fallos en 15 min, cualquier
 * usuario): repetirlo varias veces bloquearía los inicios de sesión desde
 * este equipo durante 15 minutos.
 */
const { pedir, formularioArchivo } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const web = cfg.web.api;
    const principal = cfg.usuarios.principal;
    let token;

    const api = (ruta, opciones = {}) => pedir(`${web}/api${ruta}`, { token, ...opciones });

    informe.seccion("Portal y cabeceras de seguridad");
    await informe.prueba("GET / entrega la SPA (index.html)", async () => {
        const r = await pedir(`${web}/`);
        if (r.estado === 404) requiere(false, "node-web no tiene la interfaz copiada (npm run interfaz)");
        estado(r, 200);
        verificar(r.cabeceras.get("content-type")?.includes("text/html"), "no es HTML");
    });
    await informe.prueba("CSP, nosniff, X-Frame-Options DENY y sin X-Powered-By", async () => {
        const r = await pedir(`${web}/salud`);
        const csp = r.cabeceras.get("content-security-policy") || "";
        verificar(csp.includes("frame-ancestors 'none'"), `CSP sin frame-ancestors: ${csp}`);
        verificar(!/script-src[^;]*'unsafe-inline'/.test(csp), "la CSP permite scripts en línea");
        igual(r.cabeceras.get("x-content-type-options"), "nosniff", "X-Content-Type-Options");
        igual(r.cabeceras.get("x-frame-options"), "DENY", "X-Frame-Options");
        igual(r.cabeceras.get("x-powered-by"), null, "X-Powered-By");
    });
    for (const ruta of ["/.env", "/.git/config", "/%2e%2e/%2e%2e/package.json", "/src/config.js"]) {
        await informe.prueba(`no expone ${ruta}`, async () => {
            const r = await pedir(`${web}${ruta}`);
            verificar(r.estado !== 200 || !/=|"dependencies"|import /.test(r.texto), `estado ${r.estado}, devolvió contenido`, r.texto);
        });
    }

    informe.seccion("Sesión (POST/DELETE /api/sesion → SOAP login/logout)");
    await informe.prueba("sin usuario ni contraseña → 400", async () => {
        estado(await api("/sesion", { metodo: "POST", json: {} }), 400);
    });
    await informe.prueba("credenciales inválidas → 401 CREDENCIALES_INVALIDAS", async () => {
        requiere(ctx.modoSoap, "modo simulado");
        const r = await api("/sesion", { metodo: "POST", json: { usuario: `nadie-${ctx.id}`, contrasena: "x" } });
        estado(r, 401);
        igual(r.json?.error, "CREDENCIALES_INVALIDAS", "error");
    });
    await informe.prueba("login correcto → token, roles y serviciosAutorizados (arreglos)", async () => {
        requiere(ctx.modoSoap, "modo simulado: node-web siempre pregunta a Authentication");
        const r = await api("/sesion", { metodo: "POST", json: { usuario: principal.uid, contrasena: principal.clave } });
        estado(r, 200);
        token = r.json.token;
        verificar(token, "sin token");
        verificar(Array.isArray(r.json.roles), "roles no es arreglo");
        verificar(r.json.serviciosAutorizados?.includes("storage"), `serviciosAutorizados=${r.json.serviciosAutorizados}`);
    });
    if (!token) token = (await ctx.sesion("principal")).token;

    informe.seccion("Reenvío a cada servicio");
    for (const [ruta, servicio] of [
        ["/storage/cuota", "Storage"],
        ["/storage/directorios/root", "Storage"],
        ["/shared-file/compartidos-conmigo", "Shared File"],
        ["/album/albumes", "Photo Album"],
        ["/streaming/catalogo?pagina=0", "Streaming"],
        ["/jobs", "HPC"],
        ["/cluster/estado", "HPC"],
    ]) {
        await informe.prueba(`GET /api${ruta} → ${servicio} 200`, async () => {
            estado(await api(ruta), 200);
        });
    }
    await informe.prueba("los errores del servicio pasan tal cual (401 sin token)", async () => {
        const r = await pedir(`${web}/api/storage/cuota`);
        estado(r, 401);
        igual(r.json?.error, "NO_AUTENTICADO", "error de Storage");
    });
    await informe.prueba("?access_token= (lo usa el <video>) se convierte en cabecera", async () => {
        estado(await pedir(`${web}/api/storage/cuota?access_token=${encodeURIComponent(token)}`), 200);
    });
    await informe.prueba("ruta /api desconocida → 404 NO_ENCONTRADO de la pasarela", async () => {
        const r = await api("/no-existe");
        estado(r, 404);
        igual(r.json?.error, "NO_ENCONTRADO", "error");
    });

    await informe.prueba("subida multipart, descarga con Range y borrado a través de la pasarela", async () => {
        const nombre = ctx.nombre("pasarela.txt");
        const contenido = "0123456789abcdefghij";
        const s = await api("/storage/archivos?directorioDestino=root", {
            metodo: "POST", formulario: formularioArchivo(nombre, contenido, "text/plain"),
        });
        estado(s, 201, "subida");
        // La limpieza usa la sesión del contexto: la de esta suite se cierra antes.
        ctx.alFinal("archivo de la pasarela", async () => (await ctx.como("principal")).storage.eliminar(s.json.id));
        const d = await api(`/storage/archivos/${s.json.id}/descargar`, { cabeceras: { Range: "bytes=10-19" } });
        estado(d, 206, "Range");
        igual(d.bytes.toString(), "abcdefghij", "tramo");
        igual(d.cabeceras.get("content-range"), "bytes 10-19/20", "Content-Range");
        estado(await api(`/storage/archivos/${s.json.id}`, { metodo: "DELETE" }), 204, "borrado");
    });

    informe.seccion("Cierre de sesión");
    await informe.prueba("DELETE /api/sesion → 204 y el token deja de valer en los servicios", async () => {
        requiere(ctx.modoSoap, "modo simulado: los tokens no se revocan");
        const r = await api("/sesion", { metodo: "POST", json: { usuario: principal.uid, contrasena: principal.clave } });
        const t = r.json?.token;
        verificar(t, "no se pudo iniciar sesión");
        estado(await pedir(`${web}/api/sesion`, { metodo: "DELETE", token: t }), 204);
        await esperar(6000); // caché de validación de los servicios (5 s)
        estado(await pedir(`${web}/api/storage/cuota`, { token: t }), 401, "Storage tras logout");
        estado(await pedir(`${web}/api/jobs`, { token: t }), 401, "HPC tras logout");
    });
    // node-soap da el mismo token a cada inicio de sesión del usuario: el
    // logout de arriba cerró también la sesión guardada en el contexto.
    ctx.olvidarSesiones();

    informe.seccion("Freno a la fuerza bruta");
    await informe.prueba("5 fallos del mismo usuario → 429 con Retry-After", async () => {
        requiere(cfg.incluirLimiteLogin, "desactivada: usa --incluir-limite-login (cuenta para el límite por IP)");
        const usuario = `fuerza-bruta-${ctx.id}`;
        for (let i = 0; i < 5; i++) {
            await api("/sesion", { metodo: "POST", json: { usuario, contrasena: `mala-${i}` } });
        }
        const r = await api("/sesion", { metodo: "POST", json: { usuario, contrasena: "otra" } });
        estado(r, 429);
        verificar(Number(r.cabeceras.get("retry-after")) > 0, "sin Retry-After");
    });
}

module.exports = { nombre: "07 Portal web y pasarela (node-web)", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
