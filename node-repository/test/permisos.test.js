/**
 * Pruebas unitarias del modelo de permisos Unix (RF-03) y del permiso efectivo
 * (Contrato_SharedFile §3.6). Funciones puras: sin BD ni HTTP.
 *
 *   npm test
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    puedeLeer, puedeEscribir, PERMISOS_ARCHIVO_NUEVO, PERMISOS_DIRECTORIO_NUEVO,
} = require("../src/dominio/permisos");
const { nivelEfectivo, alcanza, esNivelValido, aplicaA } = require("../src/dominio/accesos");

const ana = { id: "ana", grupos: ["investigadores", "usuarios"] };
const beto = { id: "beto", grupos: ["estudiantes", "usuarios"] };
const nodo = (permisos, extra = {}) => ({ id: "n1", propietario: "ana", grupo: "investigadores", permisos, ...extra });

// ------------------------------------------------------------- permisos.js

test("el segmento del propietario manda para el propietario", () => {
    assert.equal(puedeLeer(nodo("r--------"), ana), true);
    assert.equal(puedeEscribir(nodo("r--------"), ana), false);
    assert.equal(puedeEscribir(nodo("rw-------"), ana), true);
});

test("el segmento de grupo aplica a los miembros del grupo del nodo", () => {
    const n = nodo("rw-r-----", { propietario: "otro" });
    assert.equal(puedeLeer(n, ana), true, "ana está en investigadores");
    assert.equal(puedeEscribir(n, ana), false);
    assert.equal(puedeLeer(n, beto), false, "beto no está en investigadores");
});

test("el segmento de otros aplica a quien no es dueño ni del grupo", () => {
    const n = nodo("------r--", { propietario: "otro" });
    assert.equal(puedeLeer(n, beto), true);
    assert.equal(puedeLeer(n, ana), false, "el grupo (---) gana a otros: así es Unix");
});

test("sin cadena de permisos no se concede nada", () => {
    assert.equal(puedeLeer({ propietario: "otro", grupo: "x" }, ana), false);
});

test("todo nace privado: solo el propietario", () => {
    assert.equal(PERMISOS_ARCHIVO_NUEVO, "rw-------");
    assert.equal(PERMISOS_DIRECTORIO_NUEVO, "rwx------");
    const n = nodo(PERMISOS_ARCHIVO_NUEVO, { grupo: "usuarios" });
    assert.equal(puedeLeer(n, beto), false, "compartir un grupo común no basta para leer");
});

// ------------------------------------------------------------- accesos.js

const acceso = (nivel, extra = {}) => ({ destinatario_tipo: "USUARIO", destinatario_id: "beto", nivel, expira_en: null, ...extra });

test("el propietario siempre tiene el nivel máximo", () => {
    assert.equal(nivelEfectivo(nodo("---------"), ana), "LECTURA_ESCRITURA_COMPARTIR");
});

test("sin bits ni accesos: NINGUNO", () => {
    assert.equal(nivelEfectivo(nodo("rw-------"), beto), "NINGUNO");
});

test("los bits Unix se traducen a niveles", () => {
    const n = nodo("rw-rw-r--", { propietario: "otro", grupo: "estudiantes" });
    assert.equal(nivelEfectivo(n, beto), "LECTURA_ESCRITURA");
    assert.equal(nivelEfectivo(n, ana), "LECTURA", "ana cae en 'otros'");
});

test("una compartición directa da su nivel", () => {
    assert.equal(nivelEfectivo(nodo("rw-------"), beto, [acceso("LECTURA")]), "LECTURA");
});

test("prevalece la fuente más permisiva", () => {
    const n = nodo("rw-rw----", { propietario: "otro", grupo: "estudiantes" });
    assert.equal(nivelEfectivo(n, beto, [acceso("LECTURA")]), "LECTURA_ESCRITURA", "los bits ganan a un acceso menor");
    assert.equal(nivelEfectivo(n, beto, [acceso("LECTURA"), acceso("LECTURA_ESCRITURA_COMPARTIR")]),
        "LECTURA_ESCRITURA_COMPARTIR");
});

test("una compartición a un grupo vale para sus miembros y no para el resto", () => {
    const g = acceso("LECTURA", { destinatario_tipo: "GRUPO", destinatario_id: "estudiantes" });
    assert.equal(nivelEfectivo(nodo("rw-------"), beto, [g]), "LECTURA");
    const carla = { id: "carla", grupos: ["investigadores"] };
    assert.equal(nivelEfectivo(nodo("rw-------", { propietario: "ana" }), carla, [g]), "NINGUNO");
});

test("un acceso caducado no cuenta; uno vigente sí", () => {
    const ahora = new Date("2026-10-21T12:00:00Z");
    assert.equal(aplicaA(acceso("LECTURA", { expira_en: "2026-10-21T11:59:59Z" }), beto, ahora), false);
    assert.equal(aplicaA(acceso("LECTURA", { expira_en: "2026-10-21T12:00:00Z" }), beto, ahora), false, "vence justo ahora");
    assert.equal(aplicaA(acceso("LECTURA", { expira_en: "2026-10-21T12:00:01Z" }), beto, ahora), true);
});

test("un acceso para otro usuario o de tipo desconocido no aplica", () => {
    assert.equal(aplicaA(acceso("LECTURA", { destinatario_id: "carla" }), beto), false);
    assert.equal(aplicaA(acceso("LECTURA", { destinatario_tipo: "EQUIPO" }), beto), false);
});

test("alcanza compara niveles por orden", () => {
    assert.equal(alcanza("LECTURA_ESCRITURA", "LECTURA"), true);
    assert.equal(alcanza("LECTURA", "LECTURA_ESCRITURA"), false);
    assert.equal(alcanza("NINGUNO", "LECTURA"), false);
    assert.equal(alcanza("LECTURA_ESCRITURA_COMPARTIR", "LECTURA_ESCRITURA_COMPARTIR"), true);
});

test("NINGUNO no es un nivel que se pueda otorgar", () => {
    assert.equal(esNivelValido("NINGUNO"), false);
    assert.equal(esNivelValido("LECTURA"), true);
    assert.equal(esNivelValido("TODO"), false);
});
