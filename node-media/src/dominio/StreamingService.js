const { v4: uuid } = require("uuid");
const { NoEncontrado, SolicitudInvalida } = require("./errores");
const { eliminarMedio } = require("./eliminarMedio");
const AlbumService = require("./AlbumService");

/** ordenPor del Contrato_Streaming (ListarCatalogo). Por defecto RECIENTES. */
const ORDENES_VIDEO = ["RECIENTES", "MAS_VISTOS", "ALFABETICO"];

/**
 * Reglas de negocio del servicio de streaming (RF-06).
 *
 * Las sesiones se mantienen en memoria a propósito: son efímeras y su pérdida
 * ante un reinicio solo obliga al cliente a volver a pedir la sesión.
 * TODO: si se necesita control de concurrencia por usuario o estadísticas de
 * reproducción, migrarlas a PostgreSQL.
 */
class StreamingService {
  constructor({ catalogo, fuente, indexador = null }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.indexador = indexador;
    this.sesiones = new Map();
  }

  /** Resumen de ContenidoMultimedia: id, título, duración, miniatura, propietario, fecha. */
  #aDto(medio, usuario) {
    return {
      id: medio.id,
      titulo: medio.titulo,
      duracionSegundos: medio.duracion_segundos ?? 0,
      fecha: medio.tomada_en || medio.indexado_en,
      tamanoBytes: Number(medio.tamano_bytes),
      tieneMiniatura: Boolean(medio.miniatura_path),
      visualizaciones: medio.visualizaciones ?? 0,
      propietario: medio.propietario,
      compartido: medio.propietario !== usuario.id,
    };
  }

  /**
   * ListarCatalogo: propio + compartido con el usuario. La primera página
   * refresca antes el índice (como mucho una vez por minuto).
   */
  async catalogoVideos(usuario, pagina = 0, porPagina = 50, ordenPor, token) {
    if (pagina < 0) throw new SolicitudInvalida("La página no puede ser negativa");
    const orden = AlbumService.validarOrden(ordenPor, ORDENES_VIDEO);
    if (pagina === 0 && token && this.indexador) await this.indexador.refrescar(usuario, token);
    const filas = await this.catalogo.listarPorTipo(
      usuario, "video", porPagina, pagina * porPagina, orden
    );
    return filas.map((v) => this.#aDto(v, usuario));
  }

  async buscar(usuario, criterio, ordenPor) {
    if (!criterio || criterio.trim().length < 2) {
      throw new SolicitudInvalida("El criterio de búsqueda debe tener al menos 2 caracteres");
    }
    const orden = AlbumService.validarOrden(ordenPor, ORDENES_VIDEO);
    const filas = await this.catalogo.buscarPorTitulo(usuario, "video", criterio.trim(), orden);
    return filas.map((v) => this.#aDto(v, usuario));
  }

  /** Miniatura (GenerarVistaPrevia): desde la caché local de miniaturas. */
  async rutaMiniatura(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio || medio.tipo !== "video") throw new NoEncontrado(`video ${medioId}`);
    if (!medio.miniatura_path) throw new NoEncontrado(`miniatura de ${medioId}`);
    return medio.miniatura_path;
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
    await this.catalogo.sumarVisualizacion(medioId);

    return { sesionId, manifestUrl: `/streaming/${medioId}/contenido` };
  }

  /** Borra el video en Storage y en el catálogo. Ver dominio/eliminarMedio.js. */
  async eliminarVideo(medioId, usuario, token) {
    await eliminarMedio(this, medioId, "video", usuario, token);
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