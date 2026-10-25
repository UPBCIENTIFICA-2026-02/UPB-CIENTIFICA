/**
 * Pruebas unitarias de las reglas de Contrato_SharedFile con dobles en memoria
 * de las dependencias (relaciones, Storage, directorio, eventos). No hace falta
 * PostgreSQL ni Storage.
 *
 *   npm test
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ComparticionService = require("../src/dominio/ComparticionService");

const ana = { id: "ana", grupos: ["investigadores"] };
const beto = { id: "beto", grupos: ["estudiantes"] };

/** Doble de Storage: nodos con el nivel efectivo de cada usuario. */
function storageFalso() {
    const nodos = new Map();
    return {
        nodos,
        otorgados: [],
        revocados: [],
        fallarAlOtorgar: false,
        agregar(id, { tipo = "archivo", propietario = "ana", niveles = {} } = {}) {
            nodos.set(id, { id, nombre: `${id}.txt`, tipo, propietario, tamanoBytes: 10, niveles });
        },
        async obtenerNodo(id, token) {
            const n = nodos.get(id);
            if (!n) return null;
            const nivel = n.propietario === token ? "LECTURA_ESCRITURA_COMPARTIR" : n.niveles[token] || "NINGUNO";
            return nivel === "NINGUNO" ? null : { ...n, nivelEfectivo: nivel };
        },
        async otorgarAcceso(id, acceso) {
            if (this.fallarAlOtorgar) throw new Error("Storage caído");
            this.otorgados.push({ id, ...acceso });
        },
        async revocarAcceso(id, tipo, destinatario) { this.revocados.push({ id, tipo, destinatario }); },
        async listarHome() { return []; },
        async cuota() { return { cuota: 100, usados: 0, disponibles: 100 }; },
    };
}

/** Doble del repositorio: registrar() imita la transacción (si aplicar falla, no queda nada). */
function relacionesFalsas() {
    const filas = [];
    let n = 0;
    return {
        filas,
        async buscarVigente(elementoId, tipo, destinatario) {
            return filas.find((f) => f.elemento_id === elementoId && f.destinatario_tipo === tipo
                && f.destinatario_id === destinatario && f.estado_invitacion === "ACTIVO") || null;
        },
        async registrar(r, aplicar) {
            const fila = {
                id: `c${++n}`, elemento_id: r.elementoId, elemento_tipo: r.elementoTipo, propietario_id: r.propietarioId,
                duenio_elemento: r.duenioElemento, destinatario_tipo: r.destinatarioTipo, destinatario_id: r.destinatarioId,
                nivel_permiso: r.nivelPermiso, estado_invitacion: r.estadoInvitacion, fecha_expiracion: r.fechaExpiracion,
                fecha_creacion: new Date(),
            };
            await aplicar();          // si lanza, la fila no se guarda (ROLLBACK)
            filas.push(fila);
            return fila;
        },
        async buscarPorId(id) { return filas.find((f) => f.id === id) || null; },
        async marcarRevocada(id) { (await this.buscarPorId(id)).estado_invitacion = "REVOCADO"; },
        async actualizarNivel(id, nivel) { const f = await this.buscarPorId(id); f.nivel_permiso = nivel; return f; },
        async contarSubcomparticiones(elementoId, quien) {
            return filas.filter((f) => f.elemento_id === elementoId && f.propietario_id === quien && f.estado_invitacion === "ACTIVO").length;
        },
        async compartidasCon(uid) { return filas.filter((f) => f.destinatario_id === uid && f.estado_invitacion === "ACTIVO"); },
        async compartidasPor(uid) { return filas.filter((f) => f.propietario_id === uid && f.estado_invitacion === "ACTIVO"); },
        async queAplicanA() { return []; },
    };
}

let storage, relaciones, eventos, servicio;
beforeEach(() => {
    storage = storageFalso();
    relaciones = relacionesFalsas();
    eventos = [];
    servicio = new ComparticionService({
        relaciones, storage,
        directorio: { existeUsuario: async (uid) => ["ana", "beto", "carla"].includes(uid), homeDe: async (uid) => `/srv/home/${uid}` },
        eventos: { emitir: (tipo, datos) => eventos.push({ tipo, datos }) },
    });
    storage.agregar("f1");
    storage.agregar("d1", { tipo: "directorio" });
});

// En los dobles, el token ES el uid: así obtenerNodo sabe quién pregunta.
const compartir = (datos, usuario = ana) => servicio.compartirArchivo(
    { archivoId: "f1", destinatarioTipo: "USUARIO", destinatarioId: "beto", nivelPermiso: "LECTURA", ...datos },
    usuario, usuario.id);

const rechaza = (promesa, codigo) => assert.rejects(promesa, (e) => {
    assert.equal(e.codigo, codigo);
    return true;
});

test("compartir registra la relación, la aplica en Storage y emite el evento", async () => {
    const r = await compartir();
    assert.equal(r.estadoInvitacion, "ACTIVO");
    assert.deepEqual(storage.otorgados, [{ id: "f1", destinatarioTipo: "USUARIO", destinatarioId: "beto", nivel: "LECTURA", expiraEn: null }]);
    assert.equal(eventos[0].tipo, "ArchivoCompartido");
    assert.equal(relaciones.filas[0].propietario_id, "ana", "propietario_id sale del usuario del token");
});

test("validaciones de la solicitud → SOLICITUD_INVALIDA", async () => {
    await rechaza(compartir({ archivoId: "" }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ destinatarioTipo: "EQUIPO" }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ destinatarioId: "  " }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ nivelPermiso: "TODO" }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ expiracion: "no-es-fecha" }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ expiracion: "2000-01-01T00:00:00Z" }), "SOLICITUD_INVALIDA");
    await rechaza(compartir({ destinatarioId: "ana" }), "SOLICITUD_INVALIDA");
});

test("elemento inexistente o inaccesible → SHR-001 (archivo) / SHR-101 (directorio)", async () => {
    await rechaza(compartir({ archivoId: "nada" }), "SHR-001");
    await rechaza(servicio.compartirDirectorio(
        { directorioId: "nada", destinatarioTipo: "USUARIO", destinatarioId: "beto", nivelPermiso: "LECTURA" }, ana, "ana"), "SHR-101");
});

test("un directorio no se comparte por CompartirArchivo, ni al revés", async () => {
    await rechaza(compartir({ archivoId: "d1" }), "SOLICITUD_INVALIDA");
    await rechaza(servicio.compartirDirectorio(
        { directorioId: "f1", destinatarioTipo: "USUARIO", destinatarioId: "beto", nivelPermiso: "LECTURA" }, ana, "ana"), "SOLICITUD_INVALIDA");
});

test("sin nivel 'compartir' → SHR-002", async () => {
    storage.agregar("f2", { niveles: { beto: "LECTURA_ESCRITURA" } });
    await rechaza(compartir({ archivoId: "f2", destinatarioId: "carla" }, beto), "SHR-002");
});

test("destinatario inexistente → SHR-003 (los grupos no se validan)", async () => {
    await rechaza(compartir({ destinatarioId: "nadie" }), "SHR-003");
    const r = await compartir({ destinatarioTipo: "GRUPO", destinatarioId: "grupo-sin-miembros" });
    assert.equal(r.estadoInvitacion, "ACTIVO");
});

test("compartir dos veces con el mismo destinatario → SHR-004", async () => {
    await compartir();
    await rechaza(compartir(), "SHR-004");
});

test("si Storage falla al aplicar, no queda relación registrada", async () => {
    storage.fallarAlOtorgar = true;
    await assert.rejects(compartir());
    assert.equal(relaciones.filas.length, 0);
});

test("degradar a quien ya re-compartió advierte SHR-201 y no revoca lo suyo", async () => {
    const c = await compartir({ nivelPermiso: "LECTURA_ESCRITURA_COMPARTIR" });
    storage.nodos.get("f1").niveles.beto = "LECTURA_ESCRITURA_COMPARTIR";
    await compartir({ destinatarioId: "carla" }, beto);
    const r = await servicio.actualizarPermisos(c.compartidoId, "LECTURA", ana, "ana");
    assert.equal(r.advertencia?.codigo, "SHR-201");
    assert.equal(relaciones.filas.filter((f) => f.estado_invitacion === "ACTIVO").length, 2);
});

test("solo el dueño o quien tiene 'compartir' gestiona una relación", async () => {
    const c = await compartir();
    await rechaza(servicio.dejarDeCompartir(c.compartidoId, beto, "beto"), "SHR-002");
    await rechaza(servicio.actualizarPermisos(c.compartidoId, "LECTURA_ESCRITURA", beto, "beto"), "SHR-002");
});

test("dejar de compartir revoca primero en Storage y luego marca la relación", async () => {
    const c = await compartir();
    await servicio.dejarDeCompartir(c.compartidoId, ana, "ana");
    assert.deepEqual(storage.revocados, [{ id: "f1", tipo: "USUARIO", destinatario: "beto" }]);
    assert.equal(relaciones.filas[0].estado_invitacion, "REVOCADO");
    await rechaza(servicio.dejarDeCompartir(c.compartidoId, ana, "ana"), "SHR-001");
});

test("los listados omiten relaciones huérfanas (Storage ya no entrega el elemento)", async () => {
    await compartir();
    storage.nodos.get("f1").niveles.beto = "LECTURA";
    assert.equal((await servicio.compartidosConmigo(beto, "beto")).length, 1);
    storage.nodos.delete("f1");
    assert.equal((await servicio.compartidosConmigo(beto, "beto")).length, 0);
});

test("página negativa → SOLICITUD_INVALIDA", async () => {
    await rechaza(servicio.compartidosConmigo(beto, "beto", -1), "SOLICITUD_INVALIDA");
});

test("ObtenerPermisosEfectivos solo para uno mismo", async () => {
    await rechaza(servicio.permisosEfectivos("f1", "beto", ana, "ana"), "SOLICITUD_INVALIDA");
    const p = await servicio.permisosEfectivos("f1", undefined, ana, "ana");
    assert.equal(p.esPropietario, true);
    assert.equal(p.nivelResultante, "LECTURA_ESCRITURA_COMPARTIR");
});
