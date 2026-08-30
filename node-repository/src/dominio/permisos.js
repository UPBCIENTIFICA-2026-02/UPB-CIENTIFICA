/**
 * Modelo de permisos estilo Unix exigido por el enunciado (RF-03).
 * Cadena de 9 caracteres: propietario(rwx) grupo(rwx) otros(rwx). Ej: "rw-r-----"
 *
 * NOTA PARA EL EQUIPO: este modelo debe ser IDÉNTICO en todos los servicios.
 * El roadmap advierte que "validar permisos de forma distinta en cada servicio"
 * es uno de los errores de arquitectura a evitar. Si cambia aquí, avisar a todos.
 */
const LECTURA = 0, ESCRITURA = 1, EJECUCION = 2;

function segmentoAplicable(nodo, usuario) {
    if (nodo.propietario === usuario.id) return 0;         // propietario
    if (usuario.grupos?.includes(nodo.grupo)) return 3;    // grupo
    return 6;                                              // otros
}

function tienePermiso(nodo, usuario, tipo) {
    const base = segmentoAplicable(nodo, usuario);
    const permisos = nodo.permisos || "---------";
    return permisos[base + tipo] !== "-";
}

const puedeLeer     = (nodo, usuario) => tienePermiso(nodo, usuario, LECTURA);
const puedeEscribir = (nodo, usuario) => tienePermiso(nodo, usuario, ESCRITURA);

module.exports = { puedeLeer, puedeEscribir, LECTURA, ESCRITURA, EJECUCION };