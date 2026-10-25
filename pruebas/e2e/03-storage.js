/**
 * 03 — Distributed Storage (REST 8084).
 *
 * Contrato: docs/contratos/Contrato Storage.pdf + adenda B.
 * Cubre: subida multipart, listado del Home, descarga con Range, versionado
 * (sobrescribir), directorios, cuota, nivel efectivo y privacidad (un extraño
 * recibe 404, no 403).
 */
const { pedir } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const yo = await ctx.como("principal");
    const otro = await ctx.como("otro");
    const st = yo.storage;

    const nombre = ctx.nombre("storage.txt");
    const contenido = `contenido de prueba e2e ${ctx.id}\n`.repeat(4);
    const contenido2 = `segunda version ${ctx.id}\n`;
    let archivo, directorio, cuotaInicial;

    informe.seccion("Autenticación");
    await informe.prueba("sin token → 401 NO_AUTENTICADO", async () => {
        const r = await pedir(`${cfg.storage.api}/storage/cuota`);
        estado(r, 401);
        igual(r.json?.error, "NO_AUTENTICADO", "código de error");
    });
    await informe.prueba("token basura → 401", async () => {
        estado(await pedir(`${cfg.storage.api}/storage/cuota`, { token: "esto-no-es-un-token" }), 401);
    });

    informe.seccion("Cuota");
    await informe.prueba("GET /storage/cuota → cuota, usados, disponibles coherentes", async () => {
        const r = await st.cuota();
        estado(r, 200);
        const { cuota, usados, disponibles } = r.json;
        verificar(typeof cuota === "number" && typeof usados === "number", `forma inesperada: ${r.texto}`);
        igual(disponibles, Math.max(0, cuota - usados), "disponibles");
        cuotaInicial = r.json;
    });

    informe.seccion("Archivos");
    await informe.prueba("POST /storage/archivos (multipart) → 201 con ArchivoDto", async () => {
        const r = await st.subir(nombre, contenido, { tipo: "text/plain" });
        estado(r, 201);
        archivo = r.json;
        for (const campo of ["id", "nombre", "tipo", "tamanoBytes", "version"]) {
            verificar(campo in archivo, `falta el campo ${campo}: ${r.texto}`);
        }
        igual(archivo.nombre, nombre, "nombre");
        igual(archivo.tamanoBytes, Buffer.byteLength(contenido), "tamanoBytes");
        ctx.alFinal(`archivo ${nombre}`, () => st.eliminar(archivo.id));
    });

    await informe.prueba("la cuota usada sube al menos el tamaño del archivo", async () => {
        requiere(archivo && cuotaInicial, "no hubo subida");
        const r = await st.cuota();
        verificar(r.json.usados >= cuotaInicial.usados + archivo.tamanoBytes,
            `usados ${cuotaInicial.usados} → ${r.json.usados}`);
    });

    await informe.prueba("GET /storage/directorios/root lista el archivo", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.listar("root");
        estado(r, 200);
        verificar(Array.isArray(r.json), "no es un arreglo");
        verificar(r.json.some((n) => n.id === archivo.id), "el archivo no aparece en el Home");
    });

    await informe.prueba("descarga: mismo contenido, Content-Type por extensión y Accept-Ranges", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.descargar(archivo.id);
        estado(r, 200);
        igual(r.bytes.toString(), contenido, "contenido");
        verificar(r.cabeceras.get("content-type")?.startsWith("text/plain"), `Content-Type ${r.cabeceras.get("content-type")}`);
        igual(r.cabeceras.get("accept-ranges"), "bytes", "Accept-Ranges");
        verificar(r.cabeceras.get("content-disposition")?.includes(nombre), "Content-Disposition sin el nombre");
    });

    await informe.prueba("Range bytes=0-9 → 206 con 10 bytes y Content-Range", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.descargar(archivo.id, "bytes=0-9");
        estado(r, 206);
        igual(r.bytes.toString(), contenido.slice(0, 10), "tramo");
        igual(r.cabeceras.get("content-range"), `bytes 0-9/${archivo.tamanoBytes}`, "Content-Range");
    });

    await informe.prueba("Range bytes=-5 → los últimos 5 bytes", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.descargar(archivo.id, "bytes=-5");
        estado(r, 206);
        igual(r.bytes.toString(), contenido.slice(-5), "tramo final");
    });

    await informe.prueba("Range fuera del archivo → 416", async () => {
        requiere(archivo, "no hubo subida");
        estado(await st.descargar(archivo.id, "bytes=999999-1000000"), 416);
    });

    informe.seccion("Versionado");
    await informe.prueba("subir con el mismo nombre sin sobrescribir → 400", async () => {
        requiere(archivo, "no hubo subida");
        estado(await st.subir(nombre, "otro contenido"), 400);
    });

    await informe.prueba("sobrescribir=true → misma entrada, versión 2, contenido nuevo", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.subir(nombre, contenido2, { sobrescribir: true, tipo: "text/plain" });
        estado(r, 201);
        igual(r.json.id, archivo.id, "id (debe versionar, no duplicar)");
        verificar(r.json.version > archivo.version, `versión ${archivo.version} → ${r.json.version}`);
        igual((await st.descargar(archivo.id)).bytes.toString(), contenido2, "contenido descargado");
    });

    informe.seccion("Directorios");
    await informe.prueba("POST /storage/directorios → 201 tipo directorio", async () => {
        const r = await st.crearDirectorio(ctx.nombre("carpeta"));
        estado(r, 201);
        directorio = r.json;
        igual(directorio.tipo, "directorio", "tipo");
    });

    await informe.prueba("subir dentro de la carpeta y listarla", async () => {
        requiere(directorio, "no se creó la carpeta");
        const r = await st.subir("dentro.txt", "hola", { destino: directorio.id });
        estado(r, 201);
        ctx.alFinal("archivo dentro.txt", () => st.eliminar(r.json.id));
        const l = await st.listar(directorio.id);
        estado(l, 200);
        verificar(l.json.some((n) => n.id === r.json.id), "no aparece dentro de la carpeta");
    });

    await informe.prueba("listar un archivo como si fuera directorio → 400", async () => {
        requiere(archivo, "no hubo subida");
        estado(await st.listar(archivo.id), 400);
    });

    await informe.prueba("crear directorio sin nombre → 400", async () => {
        estado(await st.crearDirectorio(""), 400);
    });

    await informe.prueba("subir sin archivo → 400", async () => {
        estado(await pedir(`${cfg.storage.api}/storage/archivos`, { metodo: "POST", token: yo.token, formulario: new FormData() }), 400);
    });

    informe.seccion("Nivel efectivo y privacidad (todo nace rw-------)");
    await informe.prueba("GET /storage/nodos/{id} → el dueño tiene LECTURA_ESCRITURA_COMPARTIR", async () => {
        requiere(archivo, "no hubo subida");
        const r = await st.nodo(archivo.id);
        estado(r, 200);
        igual(r.json.nivelEfectivo, "LECTURA_ESCRITURA_COMPARTIR", "nivelEfectivo");
    });

    await informe.prueba(`${otro.uid} no puede descargar el archivo ajeno → 404 (no 403)`, async () => {
        requiere(archivo, "no hubo subida");
        estado(await otro.storage.descargar(archivo.id), 404);
    });
    await informe.prueba(`${otro.uid} no ve sus metadatos → 404`, async () => {
        requiere(archivo, "no hubo subida");
        estado(await otro.storage.nodo(archivo.id), 404);
    });
    await informe.prueba(`${otro.uid} no puede listar la carpeta ajena → 404`, async () => {
        requiere(directorio, "no se creó la carpeta");
        estado(await otro.storage.listar(directorio.id), 404);
    });
    await informe.prueba(`${otro.uid} no puede borrar el archivo ajeno → 404`, async () => {
        requiere(archivo, "no hubo subida");
        estado(await otro.storage.eliminar(archivo.id), 404);
    });
    await informe.prueba(`"root" es el Home de cada uno: ${otro.uid} no ve el archivo en su root`, async () => {
        requiere(archivo, "no hubo subida");
        const r = await otro.storage.listar("root");
        estado(r, 200);
        verificar(!r.json.some((n) => n.id === archivo.id), "el archivo ajeno aparece en el Home de otro usuario");
    });

    informe.seccion("Borrado");
    await informe.prueba("DELETE /storage/archivos/{id} → 204 y luego 404", async () => {
        requiere(archivo, "no hubo subida");
        estado(await st.eliminar(archivo.id), 204);
        estado(await st.descargar(archivo.id), 404, "descarga tras borrar");
        estado(await st.eliminar(archivo.id), 404, "segundo borrado");
    });
    await informe.prueba("DELETE sobre un directorio → 400 (la API no borra carpetas)", async () => {
        requiere(directorio, "no se creó la carpeta");
        estado(await st.eliminar(directorio.id), 400);
    });
}

module.exports = { nombre: "03 Distributed Storage", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
