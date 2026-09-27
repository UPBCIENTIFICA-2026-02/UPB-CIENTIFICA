/**
 * Modelo de permisos estilo Unix (RF-03).
 * Cadena de 9 caracteres: propietario(rwx) grupo(rwx) otros(rwx). Ej: "rw-r-----"
 *
 * COPIA EXACTA de node-repository/src/dominio/permisos.js, a propósito: el
 * roadmap advierte que "validar permisos de forma distinta en cada servicio" es
 * uno de los errores de arquitectura a evitar, y node-media antes no evaluaba
 * permisos en absoluto: filtraba solo por `propietario`, así que una foto
 * compartida con el grupo era invisible en el álbum aunque Storage sí la
 * mostrara.
 *
 * SI CAMBIA AQUÍ, HAY QUE CAMBIARLO EN node-repository. Y al revés.
 *
 * Nota: node-media es un índice, no la autoridad. Los BYTES los sigue pidiendo
 * a Storage con el token del usuario, y es Storage quien decide si los entrega.
 * Esta copia sirve para decidir qué se LISTA, no qué se puede leer.
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
