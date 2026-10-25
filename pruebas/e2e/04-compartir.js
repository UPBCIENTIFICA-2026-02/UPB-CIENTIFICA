/**
 * 04 — Shared File (REST 8085) + su efecto en Storage.
 *
 * Contrato: docs/contratos/Contrato SharedFile.pdf, node-shared-file/README.md.
 * Lo importante no es que Shared File guarde la relación, sino que Storage la
 * APLIQUE: cada compartición se comprueba descargando con el token del
 * destinatario.
 *
 * Roles: principal = dueño, otro = destinatario, restringido = tercero.
 */
const { pedir } = require("../lib/http");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const duenio = await ctx.como("principal");
    const dest = await ctx.como("otro");
    const tercero = await ctx.como("restringido");

    const contenido = `compartido ${ctx.id}\n`;
    let archivo, comp;

    const subir = async (sufijo, destino) => {
        const r = await duenio.storage.subir(ctx.nombre(sufijo), contenido, { destino });
        estado(r, 201, `subida de ${sufijo}`);
        ctx.alFinal(`archivo ${sufijo}`, () => duenio.storage.eliminar(r.json.id));
        return r.json;
    };

    informe.seccion("Preparación");
    await informe.prueba("el dueño sube un archivo privado", async () => {
        archivo = await subir("compartir.txt");
        estado(await dest.storage.descargar(archivo.id), 404, "el destinatario aún no lo ve");
    });

    informe.seccion("Validaciones de CompartirArchivo");
    const base = () => ({ archivoId: archivo.id, destinatarioTipo: "USUARIO", destinatarioId: dest.uid, nivelPermiso: "LECTURA" });

    await informe.prueba("sin token → 401", async () => {
        estado(await pedir(`${cfg.compartidos.api}/shared-file/compartir`, { metodo: "POST", json: {} }), 401);
    });
    await informe.prueba("nivelPermiso inválido → 400", async () => {
        requiere(archivo, "no hubo archivo");
        estado(await duenio.compartidos.compartir({ ...base(), nivelPermiso: "TODO" }), 400);
    });
    await informe.prueba("destinatarioTipo inválido → 400", async () => {
        requiere(archivo, "no hubo archivo");
        estado(await duenio.compartidos.compartir({ ...base(), destinatarioTipo: "EQUIPO" }), 400);
    });
    await informe.prueba("expiración en el pasado → 400", async () => {
        requiere(archivo, "no hubo archivo");
        estado(await duenio.compartidos.compartir({ ...base(), expiracion: "2020-01-01T00:00:00Z" }), 400);
    });
    await informe.prueba("compartir consigo mismo → 400", async () => {
        requiere(archivo, "no hubo archivo");
        estado(await duenio.compartidos.compartir({ ...base(), destinatarioId: duenio.uid }), 400);
    });
    await informe.prueba("destinatario inexistente → 404 SHR-003", async () => {
        requiere(archivo, "no hubo archivo");
        const r = await duenio.compartidos.compartir({ ...base(), destinatarioId: `nadie-${ctx.id}` });
        estado(r, 404);
        igual(r.json?.error, "SHR-003", "código");
    });
    await informe.prueba("archivo inexistente → 404 SHR-001", async () => {
        const r = await duenio.compartidos.compartir({ ...base(), archivoId: "00000000-0000-0000-0000-000000000000" });
        estado(r, 404);
        igual(r.json?.error, "SHR-001", "código");
    });
    await informe.prueba("quien no es dueño no puede compartir lo ajeno → 404/403", async () => {
        requiere(archivo, "no hubo archivo");
        const r = await dest.compartidos.compartir({ ...base(), destinatarioId: tercero.uid });
        estado(r, [403, 404]);
    });

    informe.seccion("Compartir con un usuario (LECTURA)");
    await informe.prueba("POST /compartir → 201 ACTIVO", async () => {
        requiere(archivo, "no hubo archivo");
        const r = await duenio.compartidos.compartir(base());
        estado(r, 201);
        comp = r.json;
        verificar(comp.compartidoId, "falta compartidoId");
        igual(comp.estadoInvitacion, "ACTIVO", "estadoInvitacion");
        ctx.alFinal("compartición", () => duenio.compartidos.revocar(comp.compartidoId));
    });
    await informe.prueba("repetir la misma compartición → 409 SHR-004", async () => {
        requiere(comp, "no hubo compartición");
        const r = await duenio.compartidos.compartir(base());
        estado(r, 409);
        igual(r.json?.error, "SHR-004", "código");
    });
    await informe.prueba("Storage lo aplica: el destinatario descarga el contenido", async () => {
        requiere(comp, "no hubo compartición");
        const r = await dest.storage.descargar(archivo.id);
        estado(r, 200);
        igual(r.bytes.toString(), contenido, "contenido");
    });
    await informe.prueba("nivelEfectivo del destinatario = LECTURA", async () => {
        requiere(comp, "no hubo compartición");
        igual((await dest.storage.nodo(archivo.id)).json?.nivelEfectivo, "LECTURA", "nivelEfectivo");
    });
    await informe.prueba("con LECTURA no puede borrar → 403 (ya sabe que existe)", async () => {
        requiere(comp, "no hubo compartición");
        estado(await dest.storage.eliminar(archivo.id), 403);
    });
    await informe.prueba("con LECTURA no puede re-compartir → 403 SHR-002", async () => {
        requiere(comp, "no hubo compartición");
        const r = await dest.compartidos.compartir({ ...base(), destinatarioId: tercero.uid });
        estado(r, 403);
        igual(r.json?.error, "SHR-002", "código");
    });
    await informe.prueba("el tercero sigue sin verlo → 404", async () => {
        requiere(comp, "no hubo compartición");
        estado(await tercero.storage.descargar(archivo.id), 404);
    });
    await informe.prueba("aparece en compartidos-conmigo del destinatario con sus metadatos", async () => {
        requiere(comp, "no hubo compartición");
        const r = await dest.compartidos.conmigo();
        estado(r, 200);
        const fila = r.json.find((f) => f.compartidoId === comp.compartidoId);
        verificar(fila, "no aparece");
        igual(fila.nombre, archivo.nombre, "nombre");
        igual(fila.propietario, duenio.uid, "propietario");
        igual(fila.nivelPermiso, "LECTURA", "nivelPermiso");
    });
    await informe.prueba("aparece en que-yo-comparto del dueño", async () => {
        requiere(comp, "no hubo compartición");
        const r = await duenio.compartidos.queComparto();
        estado(r, 200);
        verificar(r.json.some((f) => f.compartidoId === comp.compartidoId), "no aparece");
    });
    await informe.prueba("permisos-efectivos del destinatario explica la fuente", async () => {
        requiere(comp, "no hubo compartición");
        const r = await dest.compartidos.permisos(archivo.id);
        estado(r, 200);
        igual(r.json.nivelResultante, "LECTURA", "nivelResultante");
        igual(r.json.esPropietario, false, "esPropietario");
        verificar(r.json.fuentes.some((f) => f.compartidoId === comp.compartidoId), "la compartición no figura como fuente");
    });

    informe.seccion("ActualizarPermisos y sub-comparticiones (SHR-201)");
    await informe.prueba("PATCH a LECTURA_ESCRITURA_COMPARTIR → el destinatario re-comparte con el tercero", async () => {
        requiere(comp, "no hubo compartición");
        const p = await duenio.compartidos.actualizar(comp.compartidoId, "LECTURA_ESCRITURA_COMPARTIR");
        estado(p, 200);
        igual(p.json.nivelPermiso, "LECTURA_ESCRITURA_COMPARTIR", "nivelPermiso");
        const r = await dest.compartidos.compartir({ ...base(), destinatarioId: tercero.uid });
        estado(r, 201, "sub-compartición");
        estado(await tercero.storage.descargar(archivo.id), 200, "descarga del tercero");
    });
    await informe.prueba("degradar a LECTURA avisa con SHR-201", async () => {
        requiere(comp, "no hubo compartición");
        const r = await duenio.compartidos.actualizar(comp.compartidoId, "LECTURA");
        estado(r, 200);
        igual(r.json.advertencia?.codigo, "SHR-201", "advertencia");
    });
    await informe.prueba("el dueño revoca la sub-compartición por elemento + destinatario → 204", async () => {
        requiere(comp, "no hubo compartición");
        estado(await duenio.compartidos.revocarElemento(archivo.id, "USUARIO", tercero.uid), 204);
        estado(await tercero.storage.descargar(archivo.id), 404, "descarga del tercero tras revocar");
    });

    informe.seccion("DejarDeCompartir");
    await informe.prueba("DELETE /compartir/{id} → 204 y la revocación es inmediata", async () => {
        requiere(comp, "no hubo compartición");
        estado(await duenio.compartidos.revocar(comp.compartidoId), 204);
        estado(await dest.storage.descargar(archivo.id), 404, "descarga tras revocar");
        const r = await dest.compartidos.conmigo();
        verificar(!r.json.some((f) => f.compartidoId === comp.compartidoId), "sigue en compartidos-conmigo");
    });
    await informe.prueba("revocar otra vez → 404", async () => {
        requiere(comp, "no hubo compartición");
        estado(await duenio.compartidos.revocar(comp.compartidoId), 404);
    });

    informe.seccion("Compartir un directorio (herencia presente y futura)");
    let carpeta, previo;
    await informe.prueba("compartir una carpeta con /compartir (de archivos) → 400", async () => {
        const r = await duenio.storage.crearDirectorio(ctx.nombre("carpeta-compartida"));
        estado(r, 201);
        carpeta = r.json;
        previo = await subir("previo.txt", carpeta.id);
        estado(await duenio.compartidos.compartir({ ...base(), archivoId: carpeta.id }), 400);
    });
    await informe.prueba("CompartirDirectorio → el destinatario lee lo que ya había", async () => {
        requiere(carpeta, "no hubo carpeta");
        const r = await duenio.compartidos.compartirDirectorio({
            directorioId: carpeta.id, destinatarioTipo: "USUARIO", destinatarioId: dest.uid, nivelPermiso: "LECTURA",
        });
        estado(r, 201);
        ctx.alFinal("compartición de carpeta", () => duenio.compartidos.revocar(r.json.compartidoId));
        estado(await dest.storage.descargar(previo.id), 200, "archivo previo");
        const l = await dest.storage.listar(carpeta.id);
        estado(l, 200, "listar la carpeta");
        verificar(l.json.some((n) => n.id === previo.id), "no ve el contenido de la carpeta");
    });
    await informe.prueba("…y también lo que se suba después", async () => {
        requiere(carpeta, "no hubo carpeta");
        const nuevo = await subir("posterior.txt", carpeta.id);
        estado(await dest.storage.descargar(nuevo.id), 200);
    });

    informe.seccion("Compartir con un grupo");
    await informe.prueba("compartir con GRUPO 'estudiantes': entra el estudiante, no el investigador", async () => {
        requiere(ctx.modoSoap, "en modo simulado todos los usuarios tienen el grupo 'usuarios'");
        const grupo = (await ctx.sesion("restringido")).grupos.find((g) => g !== "usuarios") || "estudiantes";
        const a = await subir("grupo.txt");
        const r = await duenio.compartidos.compartir({
            archivoId: a.id, destinatarioTipo: "GRUPO", destinatarioId: grupo, nivelPermiso: "LECTURA",
        });
        estado(r, 201);
        ctx.alFinal("compartición de grupo", () => duenio.compartidos.revocar(r.json.compartidoId));
        estado(await tercero.storage.descargar(a.id), 200, `miembro de ${grupo}`);
        estado(await dest.storage.descargar(a.id), 404, `no miembro de ${grupo}`);
    });

    informe.seccion("Caducidad");
    await informe.prueba("una compartición con expiración deja de valer al vencer", async () => {
        const a = await subir("caduca.txt");
        const r = await duenio.compartidos.compartir({
            archivoId: a.id, destinatarioTipo: "USUARIO", destinatarioId: dest.uid, nivelPermiso: "LECTURA",
            // Margen de 10 s: el reloj del PC y el de la VPS pueden no coincidir.
            expiracion: new Date(Date.now() + 10000).toISOString(),
        });
        estado(r, 201);
        ctx.alFinal("compartición con caducidad", () => duenio.compartidos.revocar(r.json.compartidoId));
        estado(await dest.storage.descargar(a.id), 200, "antes de vencer");
        await esperar(12000);
        estado(await dest.storage.descargar(a.id), 404, "después de vencer");
    });

    informe.seccion("Home y cuota (fachadas sobre Storage)");
    await informe.prueba("GET /shared-file/home → homePath del usuario y contenido", async () => {
        const r = await duenio.compartidos.home();
        estado(r, 200);
        verificar(r.json.homePath?.endsWith(`/${duenio.uid}`), `homePath ${r.json.homePath}`);
        verificar(Array.isArray(r.json.contenido), "contenido no es un arreglo");
    });
    await informe.prueba("GET /shared-file/cuota coincide con Storage", async () => {
        const [a, b] = await Promise.all([duenio.compartidos.cuota(), duenio.storage.cuota()]);
        estado(a, 200);
        igual(a.json.cuota, b.json.cuota, "cuota");
    });
}

module.exports = { nombre: "04 Shared File", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
