/**
 * 05 — Photo Album + Streaming (node-media, REST 8083).
 *
 * Contratos: docs/contratos/Contrato PhotoAlbum.md, Contrato Streaming.pdf,
 * adenda C. node-media es un ÍNDICE: los bytes vienen de Storage con el token
 * del usuario, así que cada prueba de contenido cruza los dos servicios.
 *
 * El video se genera con ffmpeg (o se pasa con --video); si no hay ninguno,
 * las pruebas de Streaming se omiten.
 */
const { pedir } = require("../lib/http");
const { generarPng, obtenerVideo } = require("../lib/datos");
const { verificar, igual, estado, requiere } = require("../lib/informe");

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const yo = await ctx.como("principal");
    const otro = await ctx.como("otro");
    const tercero = await ctx.como("restringido");
    const m = yo.medios;

    const png = generarPng(64, 48, Number(ctx.id.slice(-2)));
    const nombreFoto = ctx.nombre("foto.png");
    let archivoFoto, foto, album;

    informe.seccion("Validaciones");
    await informe.prueba("sin token → 401 en /album y /streaming", async () => {
        estado(await pedir(`${cfg.medios.api}/album/fotos`), 401, "/album/fotos");
        estado(await pedir(`${cfg.medios.api}/streaming/catalogo`), 401, "/streaming/catalogo");
    });
    await informe.prueba("ordenPor desconocido → 400", async () => {
        estado(await m.fotos({ pagina: 0, ordenPor: "POR_COLOR" }), 400, "fotos");
        estado(await m.catalogo({ pagina: 0, ordenPor: "POR_COLOR" }), 400, "catálogo");
    });
    await informe.prueba("MAS_VISTOS vale en videos pero no en fotos → 400", async () => {
        estado(await m.fotos({ pagina: 0, ordenPor: "MAS_VISTOS" }), 400);
    });
    await informe.prueba("búsqueda de menos de 2 caracteres → 400", async () => {
        estado(await m.buscarFotos("a"), 400, "fotos");
        estado(await m.buscarVideos("a"), 400, "videos");
    });
    await informe.prueba("página negativa → 400", async () => {
        estado(await m.fotos({ pagina: -1 }), 400);
    });

    informe.seccion("Fotos: de Storage al álbum");
    await informe.prueba("subir un PNG a Storage e indexar → la foto entra al catálogo", async () => {
        const r = await yo.storage.subir(nombreFoto, png, { tipo: "image/png" });
        estado(r, 201, "subida");
        archivoFoto = r.json;
        ctx.alFinal("foto en Storage", () => yo.storage.eliminar(archivoFoto.id));
        const i = await m.indexar();
        estado(i, 200, "indexar");
        verificar(typeof i.json.revisados === "number", `respuesta de indexar: ${i.texto}`);
    });
    await informe.prueba("GET /album/fotos la lista, propia y no compartida", async () => {
        requiere(archivoFoto, "no se subió la foto");
        const r = await m.fotos({ pagina: 0 });
        estado(r, 200);
        foto = r.json.find((f) => f.titulo?.includes(ctx.id));
        verificar(foto, `la foto no aparece entre ${r.json.length}`);
        igual(foto.tipo, "foto", "tipo");
        igual(foto.propietario, yo.uid, "propietario");
        igual(foto.compartido, false, "compartido");
    });
    await informe.prueba("GET /album/fotos/{id} → la misma foto", async () => {
        requiere(foto, "no hay foto indexada");
        const r = await m.foto(foto.id);
        estado(r, 200);
        igual(r.json.id, foto.id, "id");
    });
    await informe.prueba("contenido de la foto = bytes subidos (pasa por Storage)", async () => {
        requiere(foto, "no hay foto indexada");
        const r = await m.contenidoFoto(foto.id);
        estado(r, 200);
        verificar(r.bytes.equals(png), `llegaron ${r.bytes.length} bytes de ${png.length}`);
    });
    await informe.prueba("miniatura JPEG (FFmpeg en node-media)", async () => {
        requiere(foto, "no hay foto indexada");
        requiere(foto.tieneMiniatura, "la foto no tiene miniatura (¿FFmpeg no disponible en node-media?)");
        const r = await m.miniaturaFoto(foto.id);
        estado(r, 200);
        igual(r.cabeceras.get("content-type"), "image/jpeg", "Content-Type");
        verificar(r.bytes[0] === 0xff && r.bytes[1] === 0xd8, "no empieza como JPEG");
    });
    await informe.prueba("buscar por el título la encuentra", async () => {
        requiere(foto, "no hay foto indexada");
        const r = await m.buscarFotos(ctx.id);
        estado(r, 200);
        verificar(r.json.some((f) => f.id === foto.id), "no aparece en la búsqueda");
    });
    await informe.prueba("ordenPor=ALFABETICO responde", async () => {
        estado(await m.fotos({ pagina: 0, ordenPor: "ALFABETICO" }), 200);
    });
    await informe.prueba("un id inexistente → 404", async () => {
        estado(await m.foto("00000000-0000-0000-0000-000000000000"), 404);
    });

    informe.seccion("Álbumes");
    await informe.prueba("crear álbum sin nombre → 400", async () => {
        estado(await m.crearAlbum("   "), 400);
    });
    await informe.prueba("crear álbum → 201 y aparece en la lista", async () => {
        const r = await m.crearAlbum(ctx.nombre("album"), "álbum de prueba");
        estado(r, 201);
        album = r.json;
        ctx.alFinal("álbum", () => m.eliminarAlbum(album.id));
        const l = await m.albumes();
        verificar(l.json.some((a) => a.id === album.id), "no aparece en GET /album/albumes");
    });
    await informe.prueba("agregar la foto → 204 y verAlbum la incluye", async () => {
        requiere(album && foto, "falta álbum o foto");
        estado(await m.agregarFoto(album.id, foto.id), 204);
        const r = await m.verAlbum(album.id);
        estado(r, 200);
        verificar(r.json.fotos.some((f) => f.id === foto.id), "la foto no está en el álbum");
    });
    await informe.prueba("otro usuario no ve el álbum → 404", async () => {
        requiere(album, "no hay álbum");
        estado(await otro.medios.verAlbum(album.id), 404);
    });
    await informe.prueba("quitar la foto → 204; quitarla otra vez → 404", async () => {
        requiere(album && foto, "falta álbum o foto");
        estado(await m.quitarFoto(album.id, foto.id), 204);
        estado(await m.quitarFoto(album.id, foto.id), 404);
    });
    await informe.prueba("eliminar el álbum → 204 y luego 404", async () => {
        requiere(album, "no hay álbum");
        estado(await m.eliminarAlbum(album.id), 204);
        estado(await m.verAlbum(album.id), 404);
    });

    informe.seccion("Lo compartido aparece en el álbum del destinatario");
    let comp;
    await informe.prueba("antes de compartir, el otro usuario no la ve", async () => {
        requiere(foto, "no hay foto indexada");
        await otro.medios.indexar();
        const r = await otro.medios.fotos({ pagina: 0 });
        estado(r, 200);
        verificar(!r.json.some((f) => f.id === foto.id), "ve una foto ajena sin compartir");
        estado(await otro.medios.contenidoFoto(foto.id), [403, 404], "contenido");
    });
    await informe.prueba("tras compartirla, aparece con compartido=true y se puede ver", async () => {
        requiere(foto, "no hay foto indexada");
        const c = await yo.compartidos.compartir({
            archivoId: archivoFoto.id, destinatarioTipo: "USUARIO", destinatarioId: otro.uid, nivelPermiso: "LECTURA",
        });
        estado(c, 201, "compartir");
        comp = c.json;
        ctx.alFinal("compartición de la foto", () => yo.compartidos.revocar(comp.compartidoId));
        await otro.medios.indexar();
        const r = await otro.medios.fotos({ pagina: 0 });
        const vista = r.json.find((f) => f.titulo?.includes(ctx.id));
        verificar(vista, "la foto compartida no aparece en el álbum del destinatario");
        igual(vista.compartido, true, "compartido");
        igual(vista.propietario, yo.uid, "propietario");
        const contenido = await otro.medios.contenidoFoto(vista.id);
        estado(contenido, 200, "contenido");
        verificar(contenido.bytes.equals(png), "bytes distintos");
        // Quien la recibe no la puede borrar (adenda C).
        estado(await otro.medios.eliminarFoto(vista.id), 403, "borrar lo recibido");
    });
    await informe.prueba("el tercero (sin compartir) sigue sin verla", async () => {
        requiere(comp, "no se compartió");
        await tercero.medios.indexar();
        const r = await tercero.medios.fotos({ pagina: 0 });
        verificar(!r.json.some((f) => f.titulo?.includes(ctx.id)), "el tercero ve la foto");
    });
    await informe.prueba("tras revocar y reindexar, desaparece del álbum del destinatario", async () => {
        requiere(comp, "no se compartió");
        estado(await yo.compartidos.revocar(comp.compartidoId), 204);
        await otro.medios.indexar();
        const r = await otro.medios.fotos({ pagina: 0 });
        verificar(!r.json.some((f) => f.titulo?.includes(ctx.id)), "sigue apareciendo tras revocar");
    });

    informe.seccion("Streaming");
    const video = obtenerVideo(cfg);
    let archivoVideo, vid;
    await informe.prueba("subir un mp4 e indexar → entra al catálogo", async () => {
        requiere(video, "no hay video: instala ffmpeg en el PATH o usa --video ruta.mp4");
        const r = await yo.storage.subir(ctx.nombre("video.mp4"), video, { tipo: "video/mp4" });
        estado(r, 201, "subida");
        archivoVideo = r.json;
        ctx.alFinal("video en Storage", () => yo.storage.eliminar(archivoVideo.id));
        await m.indexar();
        const c = await m.catalogo({ pagina: 0 });
        estado(c, 200);
        vid = c.json.find((v) => v.titulo?.includes(ctx.id));
        verificar(vid, "el video no aparece en el catálogo");
        for (const campo of ["id", "titulo", "duracionSegundos", "fecha", "tamanoBytes", "tieneMiniatura", "visualizaciones", "propietario", "compartido"]) {
            verificar(campo in vid, `falta ${campo} en el resumen (adenda C)`);
        }
    });
    await informe.prueba("FFmpeg leyó la duración (≈3 s)", async () => {
        requiere(vid, "no hay video indexado");
        verificar(vid.duracionSegundos >= 2 && vid.duracionSegundos <= 4, `duracionSegundos=${vid.duracionSegundos}`);
    });
    await informe.prueba("sesión de reproducción → sesionId y manifestUrl; suma una visualización", async () => {
        requiere(vid, "no hay video indexado");
        const r = await m.sesion(vid.id);
        estado(r, 200);
        verificar(r.json.sesionId, "falta sesionId");
        igual(r.json.manifestUrl, `/streaming/${vid.id}/contenido`, "manifestUrl");
        const c = await m.catalogo({ pagina: 0, ordenPor: "MAS_VISTOS" });
        const despues = c.json.find((v) => v.id === vid.id);
        verificar(despues && despues.visualizaciones > vid.visualizaciones,
            `visualizaciones ${vid.visualizaciones} → ${despues?.visualizaciones}`);
    });
    await informe.prueba("contenido completo = bytes del mp4", async () => {
        requiere(vid, "no hay video indexado");
        const r = await m.contenidoVideo(vid.id);
        estado(r, 200);
        verificar(r.bytes.equals(video), `llegaron ${r.bytes.length} de ${video.length} bytes`);
    });
    await informe.prueba("Range bytes=0-99 → 206 con 100 bytes (saltar en la línea de tiempo)", async () => {
        requiere(vid, "no hay video indexado");
        const r = await m.contenidoVideo(vid.id, "bytes=0-99");
        estado(r, 206);
        igual(r.bytes.length, 100, "bytes");
        verificar(r.cabeceras.get("content-range")?.startsWith("bytes 0-99/"), `Content-Range ${r.cabeceras.get("content-range")}`);
    });
    await informe.prueba("miniatura del video (fotograma del segundo 1)", async () => {
        requiere(vid, "no hay video indexado");
        requiere(vid.tieneMiniatura, "sin miniatura (¿FFmpeg en node-media?)");
        const r = await m.miniaturaVideo(vid.id);
        estado(r, 200);
        verificar(r.bytes[0] === 0xff && r.bytes[1] === 0xd8, "no es JPEG");
    });
    await informe.prueba("buscar el video por título", async () => {
        requiere(vid, "no hay video indexado");
        const r = await m.buscarVideos(ctx.id);
        estado(r, 200);
        verificar(r.json.some((v) => v.id === vid.id), "no aparece");
    });
    await informe.prueba("pedir sesión de una foto → 400 (no es un video)", async () => {
        requiere(foto, "no hay foto indexada");
        estado(await m.sesion(foto.id), [400, 404]);
    });
    await informe.prueba("otro usuario no puede reproducirlo → 404", async () => {
        requiere(vid, "no hay video indexado");
        estado(await otro.medios.sesion(vid.id), 404);
    });
    await informe.prueba("DELETE /streaming/{id} → 204 y el archivo desaparece de Storage", async () => {
        requiere(vid, "no hay video indexado");
        estado(await m.eliminarVideo(vid.id), 204);
        estado(await yo.storage.descargar(archivoVideo.id), 404, "en Storage");
        estado(await m.sesion(vid.id), 404, "en el catálogo");
    });

    informe.seccion("Borrar la foto");
    await informe.prueba("DELETE /album/fotos/{id} → 204 y el archivo desaparece de Storage", async () => {
        requiere(foto, "no hay foto indexada");
        estado(await m.eliminarFoto(foto.id), 204);
        estado(await yo.storage.descargar(archivoFoto.id), 404, "en Storage");
        estado(await m.foto(foto.id), 404, "en el catálogo");
    });
}

module.exports = { nombre: "05 Photo Album y Streaming", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
