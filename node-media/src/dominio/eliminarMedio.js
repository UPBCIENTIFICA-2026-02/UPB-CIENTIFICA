const { NoEncontrado, PermisoDenegado, SolicitudInvalida } = require("./errores");
const { puedeEscribir } = require("./permisos");

/**
 * Borra una foto o un video: el ARCHIVO en Storage y su entrada en el catálogo.
 *
 * Solo borrar del catálogo no serviría: el archivo seguiría en Mis archivos y
 * reaparecería en la siguiente indexación. Storage es la fuente de verdad, así
 * que se le pide a él primero, con el token del usuario, y es él quien vuelve
 * a comprobar los permisos sobre los bytes. Esta comprobación de aquí evita
 * molestar a Storage con peticiones que de antemano no tienen sentido.
 *
 * Regla: puede borrar quien tiene permiso de escritura (por defecto, solo el
 * propietario; ver PERMISOS_ARCHIVO_NUEVO).
 */
async function eliminarMedio({ catalogo, fuente }, medioId, tipoEsperado, usuario, token) {
  const medio = await catalogo.buscarPorId(medioId, usuario);
  if (!medio) throw new NoEncontrado(`${tipoEsperado} ${medioId}`);
  if (medio.tipo !== tipoEsperado) {
    throw new SolicitudInvalida(`El recurso no es un${tipoEsperado === "foto" ? "a foto" : " video"}`);
  }
  if (!puedeEscribir(medio, usuario)) throw new PermisoDenegado(`eliminar este ${tipoEsperado}`);

  await fuente.eliminarArchivo(medio.archivo_storage_id, token);
  await catalogo.eliminar(medio.id);
}

module.exports = { eliminarMedio };
