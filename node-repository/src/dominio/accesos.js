/**
 * Permiso EFECTIVO de un usuario sobre un nodo (Contrato_SharedFile §3.6).
 *
 * Fuentes, de las que PREVALECE LA MÁS PERMISIVA:
 *   1. Ser el propietario                        -> nivel máximo.
 *   2. Los bits Unix del nodo (dominio/permisos)  -> "r" = LECTURA, "w" = LECTURA_ESCRITURA.
 *   3. Las comparticiones (tabla `accesos`), sobre el propio nodo o sobre
 *      cualquier directorio que lo contenga (CompartirDirectorio se hereda),
 *      dirigidas al usuario o a uno de sus grupos, y sin caducar.
 *
 * Shared File Service decide QUIÉN comparte con quién y lo registra; Storage
 * aplica esas comparticiones aquí, en sus propias validaciones (paso 6 del
 * flujo de CompartirArchivo). Por eso esta regla vive en Storage: si
 * Shared File calculara otra cosa, "lo que dice que puedo hacer" y "lo que
 * Storage me deja hacer" no coincidirían, que es justo lo que el contrato
 * prohíbe.
 *
 * Funciones puras: no saben de SQL ni de HTTP. La lista de accesos ya les
 * llega filtrada por nodo y antepasados (capa de datos).
 */
const { puedeLeer, puedeEscribir } = require("./permisos");

/** Niveles en orden creciente: el índice sirve para comparar. */
const NIVELES = ["NINGUNO", "LECTURA", "LECTURA_ESCRITURA", "LECTURA_ESCRITURA_COMPARTIR"];

const rango = (nivel) => Math.max(0, NIVELES.indexOf(nivel));
const masPermisivo = (a, b) => (rango(a) >= rango(b) ? a : b);
const alcanza = (nivel, minimo) => rango(nivel) >= rango(minimo);

function esNivelValido(nivel) {
    return NIVELES.includes(nivel) && nivel !== "NINGUNO";
}

/**
 * ¿Este acceso le aplica a este usuario ahora?
 * @param acceso { destinatario_tipo, destinatario_id, expira_en }
 */
function aplicaA(acceso, usuario, ahora = new Date()) {
    if (acceso.expira_en && new Date(acceso.expira_en) <= ahora) return false;
    if (acceso.destinatario_tipo === "USUARIO") return acceso.destinatario_id === usuario.id;
    if (acceso.destinatario_tipo === "GRUPO") return (usuario.grupos || []).includes(acceso.destinatario_id);
    return false;
}

/**
 * @param nodo     fila de `nodos`
 * @param usuario  { id, grupos }
 * @param accesos  filas de `accesos` del nodo y de sus directorios antepasados
 * @returns uno de NIVELES
 */
function nivelEfectivo(nodo, usuario, accesos = []) {
    if (nodo.propietario === usuario.id) return "LECTURA_ESCRITURA_COMPARTIR";

    let nivel = "NINGUNO";
    if (puedeLeer(nodo, usuario)) nivel = "LECTURA";
    if (puedeLeer(nodo, usuario) && puedeEscribir(nodo, usuario)) nivel = "LECTURA_ESCRITURA";

    for (const acceso of accesos) {
        if (aplicaA(acceso, usuario)) nivel = masPermisivo(nivel, acceso.nivel);
    }
    return nivel;
}

module.exports = { NIVELES, nivelEfectivo, alcanza, esNivelValido, aplicaA };
