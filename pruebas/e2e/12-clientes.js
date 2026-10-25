/**
 * 12 — Integración funcional de los TRES clientes con los servicios reales.
 *
 *  Web        La SPA real, en un navegador real (Edge sin ventana): se inicia
 *             sesión por la pantalla de login y se recorren las 5 pestañas. Se
 *             registran todas las peticiones de red para comprobar que el
 *             navegador SOLO habla con node-web (/api) y que todas responden bien.
 *  Escritorio El código de la app (FrontDesktopUPBCientifica/app) ejecutado sin
 *             interfaz: login, archivos, fotos, compartidos, HPC y File Sync
 *             por gRPC/TLS (clientes/escritorio.py).
 *  Móvil      Sin teléfono conectado no se puede pulsar la interfaz, así que se
 *             comprueba lo que decide si la app funciona contra las VPS:
 *             su configuración (Configuracion.kt), la confianza en la CA
 *             interna (network_security_config.xml y el APK compilado), que
 *             los certificados de los servidores son válidos para Android
 *             (IP en el SAN, firmados por esa CA), y que CADA ruta declarada en
 *             las interfaces Retrofit (*Api.kt) existe y responde con la sesión
 *             del usuario, en las direcciones exactas que usa la app.
 *
 * Requiere el entorno "vps" (las direcciones de la app son las de las VPS).
 */
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pedir } = require("../lib/http");
const { llamarSoap, extraer } = require("../lib/auth");
const { verificar, igual, estado, requiere } = require("../lib/informe");
const { abrirNavegador, ejecutableNavegador, dormir } = require("../lib/navegador");

const HERMANOS = path.resolve(__dirname, "..", "..", "..");
const APP_ESCRITORIO = path.join(HERMANOS, "FrontDesktopUPBCientifica");
const APP_MOVIL = path.join(HERMANOS, "FrontUPBCientifica", "app");
const KT = path.join(APP_MOVIL, "src", "main", "java", "com", "upbcientifica", "mobile");

// ------------------------------------------------------------------------ web
async function web(ctx) {
    const { cfg, informe } = ctx;
    const portal = new URL(cfg.web.api);
    const usuario = cfg.usuarios.principal;
    let nav, sesionOk = false;

    informe.seccion("Cliente WEB · la SPA real en un navegador");
    await informe.prueba("el portal entrega la SPA por HTTPS", async () => {
        const r = await pedir(`${portal.origin}/`);
        estado(r, 200);
        verificar(/<script[^>]+type="module"/i.test(r.texto), "la página no carga la SPA");
    });
    await informe.prueba("iniciar sesión por la pantalla de login (usuario y clave reales)", async () => {
        requiere(ejecutableNavegador(), "no hay Edge ni Chrome en este equipo");
        requiere(usuario.clave, `falta UPBC_CLAVE_${usuario.uid}`);
        nav = await abrirNavegador();
        await nav.ir(`${portal.origin}/`);
        verificar(await nav.esperar(`!!document.querySelector('input[name=usuario]')`), "no aparece el formulario de login");
        await nav.escribir("input[name=usuario]", usuario.uid);
        await nav.escribir("input[name=contrasena]", usuario.clave);
        await nav.clic("[data-enviar]");
        verificar(await nav.esperar(`!!document.querySelector('[data-pestana=hpc]')`, 25000),
            "tras el login no aparece la aplicación (¿clave incorrecta?)");
        const login = nav.peticiones().find((p) => p.url.endsWith("/api/sesion") && p.metodo === "POST");
        verificar(login?.estado === 200, `POST /api/sesion → ${login?.estado}`);
        sesionOk = true;
    });

    const pestanas = [
        ["archivos", "Mis archivos", "/api/storage/"],
        ["compartidos", "Compartidos", "/api/shared-file/"],
        ["fotos", "Fotos", "/api/album/"],
        ["streaming", "Streaming", "/api/streaming/"],
        ["hpc", "Cómputo HPC", "/api/jobs"],
    ];
    for (const [id, titulo, prefijo] of pestanas) {
        await informe.prueba(`pestaña "${titulo}" carga datos reales (${prefijo}…)`, async () => {
            requiere(sesionOk, "no se inició sesión en el navegador");
            const antes = nav.peticiones().length;
            await nav.clic(`[data-pestana=${id}]`);
            await dormir(3500);
            const nuevas = nav.peticiones().slice(antes).filter((p) => p.url.includes(prefijo));
            verificar(nuevas.length > 0, `la pestaña no pidió nada a ${prefijo}`);
            const malas = nuevas.filter((p) => p.estado === null || p.estado >= 400);
            verificar(!malas.length, `respuestas con error: ${malas.map((p) => `${p.estado} ${p.url}`).join(", ")}`);
        });
    }
    await informe.prueba("el navegador SOLO habló con node-web (ninguna petición directa a un servicio)", async () => {
        requiere(sesionOk, "no se inició sesión en el navegador");
        const todas = nav.peticiones().filter((p) => /^https?:/.test(p.url));
        const ajenas = todas.filter((p) => new URL(p.url).host !== portal.host);
        console.log(`            ${todas.length} peticiones, ${todas.filter((p) => p.url.includes("/api/")).length} a /api/*, ${ajenas.length} a otros destinos`);
        verificar(!ajenas.length, `peticiones fuera del portal: ${[...new Set(ajenas.map((p) => new URL(p.url).host))].join(", ")}`);
    });
    await informe.prueba("sin errores de JavaScript durante el recorrido", async () => {
        requiere(sesionOk, "no se inició sesión en el navegador");
        verificar(!nav.errores.length, nav.errores.slice(0, 3).join(" | "));
    });
    if (nav) {
        try { await nav.captura(path.join(cfg.raizPruebas, "resultados", `cliente-web-${ctx.id}.png`)); } catch { /* opcional */ }
        nav.cerrar();
    }
}

// ----------------------------------------------------------------- escritorio
async function escritorio(ctx) {
    const { cfg, informe } = ctx;
    const usuario = cfg.usuarios.otro;    // otro usuario: su logout no cierra la sesión del resto de pruebas
    informe.seccion("Cliente de ESCRITORIO · código de la app sin interfaz");
    if (!fs.existsSync(path.join(APP_ESCRITORIO, "app", "api_client.py"))) {
        await informe.omitir("app de escritorio", `no está el repositorio ${APP_ESCRITORIO}`);
        return;
    }
    const python = process.env.UPBC_PYTHON || (process.platform === "win32" ? "py" : "python3");
    const lineas = await new Promise((resolver) => {
        const salida = [];
        const p = spawn(python, [path.join(cfg.raizPruebas, "clientes", "escritorio.py"),
            "--app", APP_ESCRITORIO, "--usuario", usuario.uid, "--prefijo", ctx.nombre("cli")], {
            env: { ...process.env, [`UPBC_CLAVE_${usuario.uid}`]: usuario.clave || "", PYTHONIOENCODING: "utf-8" },
        });
        let resto = "";
        p.stdout.on("data", (d) => {
            resto += d.toString("utf8");
            const partes = resto.split("\n");
            resto = partes.pop();
            salida.push(...partes.filter(Boolean));
        });
        let err = "";
        p.stderr.on("data", (d) => { err += d; });
        p.on("close", (codigo) => resolver({ salida, err, codigo }));
        p.on("error", (e) => resolver({ salida, err: e.message, codigo: -1 }));
    });
    if (!lineas.salida.length) {
        await informe.prueba("ejecutar el código de la app de escritorio", async () => {
            verificar(false, `Python no produjo resultados: ${lineas.err.slice(-400)}`);
        });
        return;
    }
    let seccion = "";
    for (const l of lineas.salida) {
        let r;
        try { r = JSON.parse(l); } catch { continue; }
        if (r.seccion !== seccion) { seccion = r.seccion; informe.seccion(seccion); }
        await informe.prueba(r.nombre, async () => {
            if (r.resultado === "OMITIDA") requiere(false, r.motivo);
            verificar(r.resultado === "OK", r.motivo || "falla");
            return { duracionMs: r.ms };
        });
    }
    ctx.olvidarSesiones();
}

// ---------------------------------------------------------------------- móvil
const leer = (f) => fs.readFileSync(f, "utf8");

/** Extrae un archivo de un ZIP (el APK lo es) leyendo su cabecera local. */
function leerDeZip(zip, nombre) {
    const firma = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    for (let i = zip.indexOf(firma); i >= 0; i = zip.indexOf(firma, i + 4)) {
        const largoNombre = zip.readUInt16LE(i + 26);
        if (zip.toString("utf8", i + 30, i + 30 + largoNombre) !== nombre) continue;
        const metodo = zip.readUInt16LE(i + 8);
        const comprimido = zip.readUInt32LE(i + 18);
        const inicio = i + 30 + largoNombre + zip.readUInt16LE(i + 28);
        const datos = zip.subarray(inicio, inicio + comprimido);
        return metodo === 8 ? require("zlib").inflateRawSync(datos) : datos;
    }
    return null;
}

function constantesKotlin(texto) {
    const c = {};
    for (const m of texto.matchAll(/(?:const\s+)?val\s+(\w+)(?::\s*\w+)?\s*=\s*"([^"]*)"/g)) c[m[1]] = m[2];
    return c;
}

/** Conecta por TLS validando como lo haría Android: CA interna + nombre (IP) del servidor. */
function certificadoValido(host, puerto, ca, alpn) {
    return new Promise((resolver) => {
        const s = tls.connect({ host, port: puerto, ca, servername: undefined, ALPNProtocols: alpn, timeout: 8000 }, () => {
            const c = s.getPeerCertificate();
            resolver({ ok: s.authorized, error: s.authorizationError, sujeto: c.subject?.CN, san: c.subjectaltname, protocolo: s.getProtocol() });
            s.end();
        });
        s.on("error", (e) => resolver({ ok: false, error: e.code || e.message }));
        s.on("timeout", () => { s.destroy(); resolver({ ok: false, error: "tiempo agotado" }); });
    });
}

async function movil(ctx) {
    const { cfg, informe } = ctx;
    informe.seccion("Cliente MÓVIL · configuración, confianza TLS y APK");
    const archivoConf = path.join(KT, "network", "Configuracion.kt");
    if (!fs.existsSync(archivoConf)) {
        await informe.omitir("app Android", `no está el repositorio ${APP_MOVIL}`);
        return;
    }
    const conf = leer(archivoConf);
    const k = constantesKotlin(conf);
    const hosts = {
        soap: k.HOST_SOAP_LAB, storage: k.HOST_STORAGE_LAB, media: k.HOST_MEDIA_LAB, sync: k.HOST_SYNC_LAB, hpc: k.HOST_HPC_LAB,
    };
    const caMovil = path.join(APP_MOVIL, "src", "main", "res", "raw", "upbc_ca.crt");
    const urls = {
        auth: `https://${hosts.soap}:8081/soap/user.php`,
        "/storage": `http://${hosts.storage}:8084`,
        "/shared-file": `http://${hosts.storage}:8085`,
        "/album": `http://${hosts.media}:8083`,
        "/streaming": `http://${hosts.media}:8083`,
        hpc: `http://${hosts.hpc}:8082`,
    };

    await informe.prueba("la app compilada usa el entorno LABORATORIO (las VPS)", async () => {
        verificar(/val\s+entorno:\s*Entorno\s*=\s*Entorno\.LABORATORIO/.test(conf), "entorno ≠ LABORATORIO");
        verificar(/USAR_MOCK_AUTH\s*=\s*false/.test(conf), "usa el mock de autenticación");
        igual(hosts.soap, new URL(cfg.web.api).hostname, "HOST_SOAP_LAB");
        igual(hosts.storage, new URL(cfg.storage.api).hostname, "HOST_STORAGE_LAB");
        igual(hosts.media, new URL(cfg.medios.api).hostname, "HOST_MEDIA_LAB");
        igual(hosts.hpc, new URL(cfg.hpc.api).hostname, "HOST_HPC_LAB");
        igual(`${hosts.sync}:9090`, cfg.sync.direccion, "dirección de File Sync");
    });
    await informe.prueba("network_security_config confía en la CA interna y no permite HTTP hacia node-soap", async () => {
        const nsc = leer(path.join(APP_MOVIL, "src", "main", "res", "xml", "network_security_config.xml"));
        verificar(/<certificates\s+src="@raw\/upbc_ca"\s*\/>/.test(nsc), "no confía en @raw/upbc_ca");
        verificar(fs.existsSync(caMovil), "falta res/raw/upbc_ca.crt");
        const enClaro = [...nsc.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1].trim());
        verificar(!enClaro.includes(hosts.soap), `${hosts.soap} (node-soap) admite tráfico en claro`);
    });
    await informe.prueba("el APK compilado incluye la misma CA y la configuración de red", async () => {
        const apk = path.join(APP_MOVIL, "build", "outputs", "apk", "debug", "app-debug.apk");
        requiere(fs.existsSync(apk), "no hay APK compilado (app/build/outputs/apk/debug)");
        const zip = fs.readFileSync(apk);
        const caApk = leerDeZip(zip, "res/raw/upbc_ca.crt");
        verificar(caApk, "el APK no trae res/raw/upbc_ca.crt");
        verificar(leerDeZip(zip, "res/xml/network_security_config.xml"), "el APK no trae network_security_config");
        const huella = (b) => new crypto.X509Certificate(b).fingerprint256;
        igual(huella(caApk), huella(fs.readFileSync(caMovil)), "huella de la CA en el APK vs res/raw (¿APK viejo?)");
        console.log(`            CA del APK: ${new crypto.X509Certificate(caApk).subject.replace(/\n/g, ", ")}`);
    });
    const ca = fs.existsSync(caMovil) ? fs.readFileSync(caMovil) : null;
    for (const [nombre, host, puerto, alpn] of [
        ["node-soap (login)", hosts.soap, 8081, ["http/1.1"]],
        ["node-sync (gRPC)", hosts.sync, 9090, ["h2"]],
    ]) {
        await informe.prueba(`Android aceptaría el certificado de ${nombre} en ${host}:${puerto}`, async () => {
            requiere(ca, "falta la CA");
            const r = await certificadoValido(host, puerto, ca, alpn);
            verificar(r.ok, `certificado rechazado: ${r.error} (SAN: ${r.san || "?"})`);
            console.log(`            ${r.protocolo} · CN=${r.sujeto} · ${r.san}`);
        });
    }

    informe.seccion("Cliente MÓVIL · cada ruta Retrofit de la app contra el servidor real");
    let token;
    await informe.prueba("login con la operación SOAP que usa la app (login/contrasena)", async () => {
        const u = cfg.usuarios.principal;
        requiere(u.clave, `falta UPBC_CLAVE_${u.uid}`);
        const r = await llamarSoap({ ...cfg.auth, url: urls.auth }, "login",
            { usuario: u.uid, contrasena: u.clave, origenCliente: "android" });
        token = r.extraer("token");
        verificar(token, `sin token: ${extraer(r.xml, "message") || r.xml.slice(0, 160)}`);
    });

    // Rutas GET sin cuerpo declaradas en las interfaces Retrofit; {id} de prueba = "root".
    const rutas = [];
    for (const f of ["storage/StorageApi.kt", "sharedfile/SharedFileApi.kt", "streaming/StreamingApi.kt", "hpc/HpcApi.kt"]) {
        const texto = leer(path.join(KT, "data", ...f.split("/")));
        for (const m of texto.matchAll(/@GET\("([^"]+)"\)/g)) rutas.push({ archivo: f, ruta: m[1] });
    }
    const consultas = { "/streaming/catalogo": "?pagina=0", "/album/fotos": "?pagina=0", "/streaming/buscar": "?criterioTexto=e2e" };
    for (const { archivo, ruta } of rutas) {
        if (/\{id\}/.test(ruta) && ruta !== "/storage/directorios/{id}") continue;   // necesitan un id real
        const limpia = ruta.startsWith("/") ? ruta : `/${ruta}`;
        const base = limpia.startsWith("/jobs") || limpia.startsWith("/cluster") ? urls.hpc
            : urls[Object.keys(urls).find((p) => p.startsWith("/") && limpia.startsWith(p))];
        const url = base + limpia.replace("{id}", "root") + (consultas[limpia] || "");
        await informe.prueba(`GET ${limpia}  (${path.basename(archivo)})`, async () => {
            requiere(token, "no hay sesión");
            const r = await pedir(url, { token });
            estado(r, 200, url);
        });
    }
}

async function ejecutar(ctx) {
    await web(ctx);
    await escritorio(ctx);
    await movil(ctx);
}

module.exports = { nombre: "12 Integración de los clientes Web, Escritorio y Móvil", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
