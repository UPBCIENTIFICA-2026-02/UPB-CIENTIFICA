/**
 * 09 — Seguridad transversal.
 *
 * Complementa docs/seguridad/analisis-vulnerabilidades.md con pruebas
 * repetibles: autenticación en todos los servicios, tokens falsificados, el uid
 * siempre del token (nunca del cuerpo), no confirmar a un extraño que algo
 * existe (adenda B), errores sin trazas internas e inyección en búsquedas.
 */
const { pedir } = require("../lib/http");
const { iniciarSesion, cerrarSesion } = require("../lib/auth");
const clientes = require("../lib/clientes");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PARECE_TRAZA = /at [\w.<>]+ \(|\.js:\d+:\d+|java\.\w+\.|Exception:|node_modules/;

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    let yo = await ctx.como("principal");
    let otro = await ctx.como("otro");

    const protegidos = [
        ["Storage", `${cfg.storage.api}/storage/cuota`],
        ["Shared File", `${cfg.compartidos.api}/shared-file/cuota`],
        ["Photo Album", `${cfg.medios.api}/album/albumes`],
        ["Streaming", `${cfg.medios.api}/streaming/catalogo`],
        ["HPC", `${cfg.hpc.api}/jobs`],
    ];

    informe.seccion("Autenticación en todos los servicios");
    for (const [servicio, url] of protegidos) {
        await informe.prueba(`${servicio}: sin token, con "Basic" o con basura → 401`, async () => {
            estado(await pedir(url), 401, "sin token");
            estado(await pedir(url, { cabeceras: { Authorization: "Basic dXNlcjE6MTIzNA==" } }), 401, "Basic");
            estado(await pedir(url, { token: "x".repeat(300) }), 401, "basura");
        });
    }
    for (const [servicio, url] of protegidos) {
        await informe.prueba(`${servicio}: token con formato válido pero no emitido → 401`, async () => {
            requiere(ctx.modoSoap, "modo simulado: acepta cualquier mock-token-<uid>-… POR DISEÑO (solo desarrollo)");
            estado(await pedir(url, { token: `mock-token-${yo.uid}-falsificado${ctx.id}` }), 401);
        });
    }
    await informe.prueba("un token cerrado deja de valer en todos los servicios (tras la caché de 5 s)", async () => {
        requiere(ctx.modoSoap, "modo simulado: los tokens no se revocan");
        const s = await iniciarSesion(cfg, cfg.usuarios.principal);
        await cerrarSesion(cfg, s.token);
        await esperar(6000);
        for (const [servicio, url] of protegidos) {
            estado(await pedir(url, { token: s.token }), 401, servicio);
        }
    });
    // node-soap da el mismo token a cada inicio de sesión del usuario: lo de
    // arriba cerró también la sesión de `yo`. Se vuelve a entrar.
    ctx.olvidarSesiones();
    yo = await ctx.como("principal");
    otro = await ctx.como("otro");

    informe.seccion("El uid sale del token, nunca del cuerpo");
    await informe.prueba("crear carpeta con propietario/uid ajenos en el cuerpo → la carpeta es del token", async () => {
        const r = await yo.storage.crearDirectorio(ctx.nombre("suplantar"), "root", { propietario: otro.uid, uid: otro.uid, usuario: otro.uid });
        estado(r, 201);
        igual(r.json.propietario, yo.uid, "propietario");
        estado(await otro.storage.listar(r.json.id), 404, `${otro.uid} no debe verla`);
    });
    await informe.prueba("compartir con propietarioId ajeno en el cuerpo → compartidoPor es el del token", async () => {
        const a = await yo.storage.subir(ctx.nombre("suplantar.txt"), "x");
        estado(a, 201);
        ctx.alFinal("suplantar.txt", () => yo.storage.eliminar(a.json.id));
        const c = await yo.compartidos.compartir({
            archivoId: a.json.id, destinatarioTipo: "USUARIO", destinatarioId: otro.uid, nivelPermiso: "LECTURA",
            propietarioId: otro.uid, uid: otro.uid,
        });
        estado(c, 201);
        ctx.alFinal("compartición", () => yo.compartidos.revocar(c.json.compartidoId));
        const fila = (await otro.compartidos.conmigo()).json.find((f) => f.compartidoId === c.json.compartidoId);
        igual(fila?.compartidoPor, yo.uid, "compartidoPor");
    });
    await informe.prueba("POST /jobs con uid/propietario ajenos → el trabajo es del token", async () => {
        const a = await yo.storage.subir(ctx.nombre("seg.py"), "print('x')\n");
        estado(a, 201);
        ctx.alFinal("seg.py", () => yo.storage.eliminar(a.json.id));
        const r = await yo.hpc.enviar({
            nombreTrabajo: ctx.nombre("seg"), rutaCodigo: a.json.id, numeroProcesos: 1, tiempoMaximoEjecucion: 30,
            uid: otro.uid, propietario: otro.uid,
        });
        estado(r, 201);
        await yo.hpc.cancelar(r.json.trabajoId);
        estado(await otro.hpc.consultar(r.json.trabajoId), [403, 404], `${otro.uid} no debe verlo`);
        estado(await yo.hpc.consultar(r.json.trabajoId), 200, "el dueño del token sí");
    });

    informe.seccion("No confirmar a un extraño que algo existe (adenda B: siempre 404)");
    let archivo, carpeta;
    await informe.prueba("preparación: un archivo y una carpeta privados", async () => {
        const a = await yo.storage.subir(ctx.nombre("privado.txt"), "secreto");
        estado(a, 201);
        archivo = a.json;
        ctx.alFinal("privado.txt", () => yo.storage.eliminar(archivo.id));
        const c = await yo.storage.crearDirectorio(ctx.nombre("privada"));
        estado(c, 201);
        carpeta = c.json;
    });
    const inexistente = "00000000-0000-0000-0000-000000000000";
    for (const [nombre, fn] of [
        ["listar un ARCHIVO ajeno como carpeta", () => otro.storage.listar(archivo.id)],
        ["descargar una CARPETA ajena", () => otro.storage.descargar(carpeta.id)],
        ["borrar una CARPETA ajena", () => otro.storage.eliminar(carpeta.id)],
        ["subir dentro de un ARCHIVO ajeno", () => otro.storage.subir("x.txt", "x", { destino: archivo.id })],
    ]) {
        await informe.prueba(`${nombre} → 404, igual que un id inexistente`, async () => {
            requiere(archivo && carpeta, "no hubo preparación");
            const r = await fn();
            verificar(r.estado === 404,
                `llegó ${r.estado} (${r.json?.mensaje || ""}): un extraño distingue "existe pero no es de ese tipo" de "no existe". ` +
                "En ArchivoService se comprueba el tipo ANTES que el permiso.");
        });
    }
    await informe.prueba("referencia: un id inexistente → 404", async () => {
        estado(await otro.storage.descargar(inexistente), 404);
    });

    informe.seccion("Entradas hostiles");
    await informe.prueba("inyección SQL en la búsqueda de fotos → 200 y solo resultados visibles", async () => {
        for (const criterio of ["' OR '1'='1", "%' --", "x'); DROP TABLE medios; --", "%_%"]) {
            const r = await yo.medios.buscarFotos(criterio);
            estado(r, [200, 400], `criterio ${criterio}`);
            if (r.estado === 200) {
                verificar(r.json.every((f) => f.propietario === yo.uid || f.compartido === true),
                    `la búsqueda "${criterio}" devuelve fotos ajenas no compartidas`);
            }
        }
        estado(await yo.medios.fotos({ pagina: 0 }), 200, "el catálogo sigue vivo");
    });
    await informe.prueba("JSON mal formado → 4xx sin traza interna (Storage, Shared File, Media, HPC)", async () => {
        const malos = [
            [`${cfg.storage.api}/storage/directorios`, yo.token],
            [`${cfg.compartidos.api}/shared-file/compartir`, yo.token],
            [`${cfg.medios.api}/album/albumes`, yo.token],
            [`${cfg.hpc.api}/jobs`, yo.token],
        ];
        const fallos = [];
        for (const [url, token] of malos) {
            const r = await pedir(url, { metodo: "POST", token, cuerpo: "{\"nombre\": ", cabeceras: { "Content-Type": "application/json" } });
            if (r.estado >= 500 || PARECE_TRAZA.test(r.texto)) fallos.push(`${new URL(url).pathname} → ${r.estado}`);
        }
        verificar(fallos.length === 0, `responden 5xx o con traza: ${fallos.join(", ")}`);
    });
    await informe.prueba("URL con codificación inválida en node-web → 4xx sin traza", async () => {
        const r = await pedir(`${cfg.web.api}/%E0%A4%A`);
        verificar(r.estado < 500, `estado ${r.estado}`, r.texto);
        verificar(!PARECE_TRAZA.test(r.texto), "la respuesta incluye una traza interna", r.texto.slice(0, 300));
    });
    await informe.prueba("nombre de archivo con ../ → se guarda en el Home o se rechaza", async () => {
        const nombre = `../../${ctx.nombre("escape.txt")}`;
        const r = await yo.storage.subir(nombre, "x");
        estado(r, [201, 400]);
        if (r.estado === 201) {
            ctx.alFinal("escape.txt", () => yo.storage.eliminar(r.json.id));
            verificar((await yo.storage.listar("root")).json.some((n) => n.id === r.json.id), "no quedó en el Home");
        }
    });
    await informe.prueba("los servicios Express no anuncian X-Powered-By", async () => {
        for (const [servicio, url] of protegidos.slice(0, 3)) {
            const r = await pedir(url);
            igual(r.cabeceras.get("x-powered-by"), null, servicio);
        }
    });

    informe.seccion("Mapa de servicios");
    await informe.prueba(`${cfg.usuarios.restringido.uid} no puede usar HPC ni a través de la pasarela`, async () => {
        requiere(ctx.modoSoap, "modo simulado: no hay mapa de servicios");
        const { token } = await ctx.sesion("restringido");
        estado(await pedir(`${cfg.web.api}/api/jobs`, { token }), 403);
        estado(await clientes.hpc(cfg, token).cluster(), 403);
    });
}

module.exports = { nombre: "09 Seguridad", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
