/**
 * 02 — Authentication (SOAP, users.wsdl) y mapa de servicios (D2, adenda A).
 *
 * Contrato: docs/contratos/Contrato Auth.pdf, node-soap/back/users.wsdl.
 * Las dos firmas conviven: iniciarSesion/cerrarSesion (password) para node-web
 * y los servicios, login/logout (contrasena) para la app móvil.
 */
const { llamarSoap, iniciarSesion } = require("../lib/auth");
const clientes = require("../lib/clientes");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    if (!ctx.modoSoap) {
        await informe.omitir("Authentication", "modo simulado: no hay a quién preguntar. Ejecuta con -ModoAuth soap");
        return;
    }
    const principal = cfg.usuarios.principal;
    const soap = (op, campos) => llamarSoap(cfg.auth, op, campos);

    informe.seccion("iniciarSesion / validarToken / cerrarSesion");

    let token;
    await informe.prueba(`iniciarSesion(${principal.uid}) devuelve token, uid y grupos`, async () => {
        const r = await soap("iniciarSesion", { usuario: principal.uid, password: principal.clave, origenCliente: "pruebas-e2e" });
        token = r.extraer("token");
        verificar(token, "no llegó token", r.xml.slice(0, 300));
        igual(r.extraer("uid"), principal.uid, "uid");
        verificar(r.lista("grupos").length > 0, "no llegaron grupos");
    });

    await informe.prueba("iniciarSesion con contraseña equivocada no da token", async () => {
        const r = await soap("iniciarSesion", { usuario: principal.uid, password: "clave-equivocada-e2e" });
        verificar(!r.extraer("token"), "entregó token con una contraseña falsa");
        igual(r.extraer("success"), "false", "success");
    });

    await informe.prueba("iniciarSesion de un usuario inexistente no da token", async () => {
        const r = await soap("iniciarSesion", { usuario: `nadie-${ctx.id}`, password: "x" });
        verificar(!r.extraer("token"), "entregó token a un usuario que no existe");
    });

    await informe.prueba("validarToken acepta el token emitido", async () => {
        requiere(token, "no hubo sesión");
        const r = await soap("validarToken", { token });
        igual(r.extraer("valido"), "true", "valido");
        igual(r.extraer("uid"), principal.uid, "uid");
    });

    await informe.prueba("validarToken rechaza un token inventado", async () => {
        const r = await soap("validarToken", { token: `mock-token-${principal.uid}-inventado${ctx.id}` });
        verificar(r.extraer("valido") !== "true", "aceptó un token que Authentication nunca emitió");
    });

    await informe.prueba("obtenerUsuario devuelve el homeDirectory", async () => {
        const r = await soap("obtenerUsuario", { usuario: principal.uid });
        verificar(r.extraer("homeDirectory")?.endsWith(`/${principal.uid}`),
            `homeDirectory inesperado: ${r.extraer("homeDirectory")}`);
    });

    informe.seccion("Contrato de la app móvil (login / logout)");

    await informe.prueba("login con 'contrasena' devuelve token y mapaServiciosAutorizados", async () => {
        const r = await soap("login", { usuario: principal.uid, contrasena: principal.clave, origenCliente: "movil" });
        const t = r.extraer("token");
        verificar(t, "no llegó token", r.xml.slice(0, 300));
        const mapa = (r.extraer("mapaServiciosAutorizados") || "").split(",");
        verificar(mapa.includes("storage"), `el mapa no incluye storage: ${mapa}`);
        await soap("logout", { token: t });
    });

    informe.seccion("Mapa de servicios (validarAccesoServicio)");
    const restringido = cfg.usuarios.restringido.uid;
    for (const [uid, servicio, permitido] of [
        [principal.uid, "hpc", true],
        [principal.uid, "storage", true],
        [restringido, "storage", true],
        [restringido, "hpc", false],
    ]) {
        await informe.prueba(`validarAccesoServicio(${uid}, ${servicio}) → ${permitido ? "permitido" : "denegado"}`, async () => {
            const r = await soap("validarAccesoServicio", { usuario: uid, servicio });
            igual(r.extraer("success"), String(permitido), "success");
        });
    }

    await informe.prueba(`job-api niega HPC a ${restringido} (403, sin 'hpc' en su perfil)`, async () => {
        const s = await ctx.sesion("restringido");
        const r = await clientes.hpc(cfg, s.token).listar();
        estado(r, 403);
    });

    await informe.prueba(`Storage sí atiende a ${restringido} (tiene 'storage')`, async () => {
        const s = await ctx.sesion("restringido");
        estado(await clientes.storage(cfg, s.token).cuota(), 200);
    });

    informe.seccion("Cierre de sesión");

    await informe.prueba("cerrarSesion invalida el token en Authentication y en los servicios", async () => {
        const s = await iniciarSesion(cfg, principal);
        estado(await clientes.storage(cfg, s.token).cuota(), 200, "antes de cerrar");
        const r = await soap("cerrarSesion", { token: s.token });
        igual(r.extraer("success"), "true", "cerrarSesion");
        igual((await soap("validarToken", { token: s.token })).extraer("valido"), "false", "validarToken tras cerrar");
        // Los servicios cachean la validación 5 s (ValidadorSoap.ttlCacheMs).
        await esperar(6000);
        estado(await clientes.storage(cfg, s.token).cuota(), 401, "Storage tras cerrar sesión");
    });

    if (token) await soap("cerrarSesion", { token });
    ctx.olvidarSesiones(); // el token de user1 es único por usuario: ya está cerrado
}

module.exports = { nombre: "02 Autenticación y mapa de servicios", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
