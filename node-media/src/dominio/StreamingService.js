const { v4: uuid } = require("uuid");
const { NoEncontrado, SolicitudInvalida } = require("./errores");

/**
 * Reglas de negocio del servicio de streaming (RF-06).
 *
 * Las sesiones se mantienen en memoria a propósito: son efímeras y su pérdida
 * ante un reinicio solo obliga al cliente a volver a pedir la sesión.
 * TODO: si se necesita control de concurrencia por usuario o estadísticas de
 * reproducción, migrarlas a PostgreSQL.
 */
class StreamingService {
  constructor({ catalogo, fuente }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.sesiones = new Map();
  }

  #aDto(medio) {
    return {
      id: medio.id,
      titulo: medio.titulo,
      duracionSegundos: medio.duracion_segundos ?? 0,
      fecha: medio.tomada_en || medio.indexado_en,
    };
  }

  async catalogoVideos(usuario, pagina = 0, porPagina = 50) {
    if (pagina < 0) throw new SolicitudInvalida("La página no puede ser negativa");
    const filas = await this.catalogo.listarPorTipo(
      usuario, "video", porPagina, pagina * porPagina
    );
    return filas.map((v) => this.#aDto(v));
  }

  async buscar(usuario, criterio) {
    if (!criterio || criterio.trim().length < 2) {
      throw new SolicitudInvalida("El criterio de búsqueda debe tener al menos 2 caracteres");
    }
    const filas = await this.catalogo.buscarPorTitulo(usuario, "video", criterio.trim());
    return filas.map((v) => this.#aDto(v));
  }

  /** Abre una sesión de reproducción y devuelve la URL del contenido. */
  async iniciarSesion(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`video ${medioId}`);
    if (medio.tipo !== "video") throw new SolicitudInvalida("El recurso no es un video");

    const sesionId = uuid();
    this.sesiones.set(sesionId, {
      medioId, usuario: usuario.id, abiertaEn: Date.now(),
    });

    return { sesionId, manifestUrl: `/streaming/${medioId}/contenido` };
  }

  /**
   * Devuelve el flujo del video. Propaga la cabecera Range a Storage para
   * que el reproductor pueda saltar a cualquier punto sin descargar todo.
   */
  async abrirContenido(medioId, usuario, token, rango) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`video ${medioId}`);
    const lectura = await this.fuente.abrirLectura(medio.archivo_storage_id, token, rango);
    return { ...lectura, titulo: medio.titulo };
  }
}

module.exports = StreamingService;