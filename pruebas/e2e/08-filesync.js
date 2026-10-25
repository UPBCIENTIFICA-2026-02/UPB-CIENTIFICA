/**
 * 08 — File Sync (gRPC 9090, syncd) + su persistencia en Storage (decisión 2.6).
 *
 * Contrato: node-sync/proto/filesync/filesync.proto y Contrato FileSync.pdf.
 * Reproduce lo que hacen la app de escritorio y la móvil: comparar el estado
 * local con el Home (IniciarSync), subir, bajar, borrar y resolver conflictos
 * (MANTENER_AMBOS). Cada paso se contrasta con la API REST de Storage, porque
 * lo sincronizado tiene que aparecer en "Mis archivos".
 *
 * Necesita las dependencias de pruebas/: cd pruebas && npm install
 * En las VPS syncd va con TLS: pasa --ca con la CA interna.
 */
const fs = require("fs");
const path = require("path");
const { sha256 } = require("../lib/datos");
const { verificar, igual, requiere } = require("../lib/informe");

function cargarGrpc(cfg) {
    let grpc, protoLoader;
    try {
        grpc = require("@grpc/grpc-js");
        protoLoader = require("@grpc/proto-loader");
    } catch {
        return null;
    }
    const proto = path.join(cfg.raizRepo, "node-sync", "proto", "filesync", "filesync.proto");
    const def = protoLoader.loadSync(proto, { enums: String, longs: Number, defaults: true });
    const { FileSync } = grpc.loadPackageDefinition(def).filesync;
    const credenciales = cfg.sync.tls
        ? grpc.credentials.createSsl(cfg.ca ? fs.readFileSync(cfg.ca) : null)
        : grpc.credentials.createInsecure();
    // Node no admite una IP como nombre TLS (SNI): se valida contra un nombre
    // del certificado de syncd (SAN: node-sync, node-repository).
    const opciones = cfg.sync.tls && cfg.sync.nombreTls
        ? { "grpc.ssl_target_name_override": cfg.sync.nombreTls, "grpc.default_authority": cfg.sync.nombreTls }
        : {};
    return { grpc, cliente: new FileSync(cfg.sync.direccion, credenciales, opciones) };
}

/** Envuelve las llamadas del cliente gRPC en promesas, con el token en la metadata. */
function api(grpc, cliente, token) {
    const meta = () => {
        const m = new grpc.Metadata();
        if (token) m.set("authorization", `Bearer ${token}`);
        return m;
    };
    const opciones = () => ({ deadline: Date.now() + 30000 });
    const unaria = (metodo) => (req) => new Promise((resolver, rechazar) =>
        cliente[metodo](req, meta(), opciones(), (e, r) => (e ? rechazar(e) : resolver(r))));

    return {
        iniciar: unaria("IniciarSync"),
        estadoSync: unaria("EstadoSync"),
        eliminar: unaria("EliminarArchivo"),
        subir: (ruta, contenido, uid) => new Promise((resolver, rechazar) => {
            const s = cliente.SubirArchivo(meta(), opciones(), (e, r) => (e ? rechazar(e) : resolver(r)));
            const buf = Buffer.from(contenido);
            const TROZO = 16 * 1024;
            s.write({ ruta, uid: uid || "", contenido: buf.subarray(0, TROZO) });
            for (let i = TROZO; i < buf.length; i += TROZO) s.write({ contenido: buf.subarray(i, i + TROZO) });
            s.end();
        }),
        bajar: (ruta) => new Promise((resolver, rechazar) => {
            const partes = [];
            const s = cliente.DescargarArchivo({ ruta }, meta(), opciones());
            s.on("data", (c) => partes.push(c.contenido));
            s.on("end", () => resolver(Buffer.concat(partes)));
            s.on("error", rechazar);
        }),
    };
}

const meta = (ruta, contenido, hashBase = "") => ({
    ruta, hash: sha256(contenido), size: Buffer.byteLength(contenido),
    mtime: Math.floor(Date.now() / 1000), hashBase,
});

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const g = cargarGrpc(cfg);
    if (!g) {
        await informe.omitir("File Sync", "faltan @grpc/grpc-js y @grpc/proto-loader: ejecuta 'npm install' en pruebas/");
        return;
    }
    const { grpc, cliente } = g;
    const yo = await ctx.como("principal");
    const otro = await ctx.como("otro");
    const sync = api(grpc, cliente, yo.token);
    const syncOtro = api(grpc, cliente, otro.token);

    const carpeta = ctx.nombre("sync");
    const rutaA = `${carpeta}/a.txt`;
    const rutaB = `${carpeta}/sub/b.txt`;
    const v1 = `version 1 ${ctx.id}\n`;
    const v2 = `version 2 del servidor ${ctx.id}\n`;
    const local = `cambio local ${ctx.id}\n`;
    const peticion = (archivos) => ({ dispositivo: "pruebas-e2e", carpeta, archivos, modoDisparo: "MANUAL" });
    const accionDe = (resp, ruta) => resp.acciones.find((a) => a.ruta === ruta);
    let carpetaStorage;

    // La limpieza va en orden inverso: el canal se cierra lo último.
    ctx.alFinal("canal gRPC", () => cliente.close());
    ctx.alFinal("archivos sincronizados", async () => {
        for (const r of [rutaA, rutaB]) await sync.eliminar({ ruta: r }).catch(() => {});
    });

    informe.seccion("Autenticación");
    await informe.prueba("EstadoSync sin token → UNAUTHENTICATED", async () => {
        const e = await api(grpc, cliente, null).estadoSync({ dispositivo: "x" }).then(() => null, (err) => err);
        verificar(e, "respondió sin token");
        igual(e.code, grpc.status.UNAUTHENTICATED, `código gRPC (${e.details})`);
    });
    await informe.prueba("EstadoSync con token → versión y número de archivos", async () => {
        const r = await sync.estadoSync({ dispositivo: "pruebas-e2e" });
        verificar(typeof r.version === "number" && typeof r.archivos === "number", JSON.stringify(r));
    });

    informe.seccion("Subir: del dispositivo al Home (vía Storage)");
    await informe.prueba("archivo local nuevo → acción SUBIR", async () => {
        const r = await sync.iniciar(peticion([meta(rutaA, v1)]));
        igual(accionDe(r, rutaA)?.accion, "SUBIR", "acción");
    });
    await informe.prueba("SubirArchivo (streaming) → ok", async () => {
        const r = await sync.subir(rutaA, v1);
        igual(r.ok, true, `ok (${r.mensaje})`);
        igual(r.ruta, rutaA, "ruta");
    });
    await informe.prueba("ahora coincide → IGUAL", async () => {
        const r = await sync.iniciar(peticion([meta(rutaA, v1, sha256(v1))]));
        igual(accionDe(r, rutaA)?.accion, "IGUAL", "acción");
    });
    await informe.prueba("aparece en Storage, en la carpeta sincronizada del Home", async () => {
        carpetaStorage = await yo.storage.buscar("root", carpeta);
        verificar(carpetaStorage, `no existe la carpeta ${carpeta} en el Home`);
        const a = await yo.storage.buscar(carpetaStorage.id, "a.txt");
        verificar(a, "no está a.txt");
        igual((await yo.storage.descargar(a.id)).bytes.toString(), v1, "contenido en Storage");
    });
    await informe.prueba("DescargarArchivo devuelve el mismo contenido", async () => {
        igual((await sync.bajar(rutaA)).toString(), v1, "contenido");
    });

    informe.seccion("Bajar: cambios hechos en el servidor");
    await informe.prueba("un archivo nuevo en el servidor (subido por REST) → BAJAR", async () => {
        requiere(carpetaStorage, "no hay carpeta en Storage");
        const sub = await yo.storage.crearDirectorio("sub", carpetaStorage.id);
        verificar(sub.estado === 201, `crear sub → ${sub.estado}`);
        const s = await yo.storage.subir("b.txt", v1, { destino: sub.json.id });
        verificar(s.estado === 201, `subir b.txt → ${s.estado}`);
        const r = await sync.iniciar(peticion([meta(rutaA, v1, sha256(v1))]));
        igual(accionDe(r, rutaB)?.accion, "BAJAR", "acción para sub/b.txt");
    });
    await informe.prueba("el servidor cambió y el cliente no → BAJAR con hash del servidor", async () => {
        requiere(carpetaStorage, "no hay carpeta en Storage");
        const s = await yo.storage.subir("a.txt", v2, { destino: carpetaStorage.id, sobrescribir: true });
        verificar(s.estado === 201, `sobrescribir → ${s.estado}`);
        const r = await sync.iniciar(peticion([meta(rutaA, v1, sha256(v1))]));
        const a = accionDe(r, rutaA);
        igual(a?.accion, "BAJAR", "acción");
        igual(a.hashServidor, sha256(v2), "hashServidor");
    });

    informe.seccion("Conflictos (MANTENER_AMBOS) y borrados");
    await informe.prueba("ambos cambiaron → CONFLICTO con ruta_conflicto distinta", async () => {
        const r = await sync.iniciar(peticion([meta(rutaA, local, sha256(v1))]));
        const a = accionDe(r, rutaA);
        igual(a?.accion, "CONFLICTO", "acción");
        verificar(a.rutaConflicto && a.rutaConflicto !== rutaA && a.rutaConflicto.startsWith(`${carpeta}/`),
            `rutaConflicto=${a.rutaConflicto}`);
    });
    await informe.prueba("borrado en el cliente sin cambios en el servidor → BORRAR_SERVIDOR", async () => {
        const r = await sync.iniciar(peticion([{ ruta: rutaA, eliminado: true, hashBase: sha256(v2) }]));
        igual(accionDe(r, rutaA)?.accion, "BORRAR_SERVIDOR", "acción");
    });
    await informe.prueba("EliminarArchivo → ok y desaparece de Storage", async () => {
        const r = await sync.eliminar({ ruta: rutaA });
        igual(r.ok, true, `ok (${r.mensaje})`);
        verificar(!(await yo.storage.buscar(carpetaStorage.id, "a.txt")), "a.txt sigue en Storage");
    });
    await informe.prueba("borrado en el servidor y sin cambios locales → BORRAR (en el cliente)", async () => {
        const r = await sync.iniciar(peticion([meta(rutaA, v2, sha256(v2))]));
        igual(accionDe(r, rutaA)?.accion, "BORRAR", "acción");
    });

    informe.seccion("Seguridad de rutas e identidad");
    await informe.prueba("una ruta que sale del Home (../) se rechaza", async () => {
        const e = await sync.subir(`../${ctx.nombre("escape.txt")}`, "x").then(() => null, (err) => err);
        verificar(e, "aceptó una ruta con ../");
        igual(e.code, grpc.status.INVALID_ARGUMENT, `código gRPC (${e.details})`);
    });
    await informe.prueba("un archivo fuera de la carpeta sincronizada → PERMISSION_DENIED (SYNC-002)", async () => {
        const e = await sync.iniciar(peticion([meta(`otra-carpeta/${ctx.id}.txt`, "x")])).then(() => null, (err) => err);
        verificar(e, "lo aceptó");
        igual(e.code, grpc.status.PERMISSION_DENIED, `código gRPC (${e.details})`);
    });
    await informe.prueba("hash mal formado → INVALID_ARGUMENT", async () => {
        const e = await sync.iniciar(peticion([{ ruta: rutaA, hash: "no-es-sha256" }])).then(() => null, (err) => err);
        verificar(e, "lo aceptó");
        igual(e.code, grpc.status.INVALID_ARGUMENT, `código gRPC (${e.details})`);
    });
    await informe.prueba("el campo uid del mensaje se ignora: manda el token", async () => {
        const ruta = `${carpeta}/suplantado.txt`;
        const r = await sync.subir(ruta, "hola", otro.uid);
        igual(r.ok, true, "ok");
        ctx.alFinal("suplantado.txt", () => sync.eliminar({ ruta }));
        verificar(await yo.storage.buscar(carpetaStorage.id, "suplantado.txt"), "no quedó en el Home del dueño del token");
        // Si la carpeta no existe en su Home, syncd responde NOT_FOUND: tampoco la ve.
        const ajeno = await syncOtro.iniciar({ dispositivo: "e2e", carpeta, archivos: [] }).catch(() => ({ acciones: [] }));
        verificar(!accionDe(ajeno, ruta), `${otro.uid} ve el archivo en su sincronización`);
    });
}

module.exports = { nombre: "08 File Sync (gRPC)", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
