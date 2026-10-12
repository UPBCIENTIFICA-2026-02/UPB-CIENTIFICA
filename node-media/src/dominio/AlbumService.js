const { NoEncontrado, SolicitudInvalida } = require("./errores");
const { eliminarMedio } = require("./eliminarMedio");

/** Orden del álbum: el ordenPor del Contrato_Streaming que tiene sentido en fotos. */
const ORDENES_FOTOS = ["RECIENTES", "ALFABETICO"];

function validarOrden(ordenPor, permitidos) {
  if (ordenPor === undefined || ordenPor === null || ordenPor === "") return undefined;
  if (!permitidos.includes(ordenPor)) {
    throw new SolicitudInvalida(`ordenPor debe ser uno de: ${permitidos.join(", ")}`);
  }
  return ordenPor;
}

/**
 * Reglas de negocio del álbum de fotografías (RF-05).
 *
 * Qué se LISTA lo decide el modelo de permisos Unix replicado desde Storage
 * (ver datos/CatalogoRepository.js). Qué BYTES se entregan lo sigue decidiendo
 * Storage, al que se le reenvía el token del usuario en cada descarga.
 */
class AlbumService {
  constructor({ catalogo, fuente, indexador }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.indexador = indexador;
  }

  /**
   * `propietario` y `compartido` dicen de quién es y si llegó por una
   * compartición (Contrato_Streaming: el resumen incluye el propietario).
   */
  #aDto(medio, usuario) {
    return {
      id: medio.id,
      titulo: medio.titulo,
      tipo: medio.tipo,
      tamanoBytes: Number(medio.tamano_bytes),
      ancho: medio.ancho,
      alto: medio.alto,
      tieneMiniatura: Boolean(medio.miniatura_path),
      // Fecha de captura si FFmpeg la leyó; si no, cuándo se indexó.
      fecha: medio.tomada_en || medio.indexado_en,
      propietario: medio.propietario,
      compartido: medio.propietario !== usuario.id,
    };
  }

  /**
   * La primera página refresca antes el índice (Home + compartidos, como mucho
   * una vez por minuto): lo nuevo aparece sin pulsar "Buscar nuevas".
   */
  async listarFotos(usuario, pagina = 0, porPagina = 50, ordenPor, token) {
    if (pagina < 0) throw new SolicitudInvalida("La página no puede ser negativa");
    const orden = validarOrden(ordenPor, ORDENES_FOTOS);
    if (pagina === 0 && token) await this.indexador.refrescar(usuario, token);
    const filas = await this.catalogo.listarPorTipo(
      usuario, "foto", porPagina, pagina * porPagina, orden
    );
    return filas.map((f) => this.#aDto(f, usuario));
  }

  async buscarFotos(usuario, criterio, ordenPor) {
    if (!criterio || criterio.trim().length < 2) {
      throw new SolicitudInvalida("El criterio de búsqueda debe tener al menos 2 caracteres");
    }
    const orden = validarOrden(ordenPor, ORDENES_FOTOS);
    const filas = await this.catalogo.buscarPorTitulo(usuario, "foto", criterio.trim(), orden);
    return filas.map((f) => this.#aDto(f, usuario));
  }

  async obtenerFoto(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    return this.#aDto(medio, usuario);
  }

  /** Miniatura: se sirve desde la caché local, no desde Storage. */
  async rutaMiniatura(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    if (!medio.miniatura_path) throw new NoEncontrado(`miniatura de ${medioId}`);
    return medio.miniatura_path;
  }

  /** Contenido original: se pide a Storage con el token del usuario. */
  async abrirContenido(medioId, usuario, token) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    const lectura = await this.fuente.abrirLectura(medio.archivo_storage_id, token);
    return { ...lectura, titulo: medio.titulo };
  }

  /** Borra la foto en Storage y en el catálogo. Ver dominio/eliminarMedio.js. */
  async eliminarFoto(medioId, usuario, token) {
    await eliminarMedio(this, medioId, "foto", usuario, token);
  }

  async indexar(usuario, token) {
    return this.indexador.indexarHome(usuario, token);
  }

  // --- álbumes ---

  async listarAlbumes(usuario) {
    const filas = await this.catalogo.listarAlbumes(usuario.id);
    return filas.map((a) => ({
      id: a.id, nombre: a.nombre, descripcion: a.descripcion,
      totalFotos: a.total_fotos, creadoEn: a.creado_en,
    }));
  }

  async crearAlbum(nombre, descripcion, usuario) {
    if (!nombre || !nombre.trim()) throw new SolicitudInvalida("El nombre del álbum es obligatorio");
    const album = await this.catalogo.crearAlbum(usuario.id, nombre.trim(), descripcion);
    return { id: album.id, nombre: album.nombre, descripcion: album.descripcion };
  }

  async verAlbum(albumId, usuario) {
    const album = await this.catalogo.buscarAlbum(albumId, usuario.id);
    if (!album) throw new NoEncontrado(`álbum ${albumId}`);
    const medios = await this.catalogo.listarMediosDeAlbum(albumId, usuario);
    return {
      id: album.id,
      nombre: album.nombre,
      descripcion: album.descripcion,
      fotos: medios.map((m) => this.#aDto(m, usuario)),
    };
  }

  async agregarFoto(albumId, medioId, orden, usuario) {
    const album = await this.catalogo.buscarAlbum(albumId, usuario.id);
    if (!album) throw new NoEncontrado(`álbum ${albumId}`);
    const medio = await this.catalogo.buscarPorId(medioId, usuario);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    await this.catalogo.agregarAAlbum(albumId, medioId, orden ?? 0);
  }

  async quitarFoto(albumId, medioId, usuario) {
    const album = await this.catalogo.buscarAlbum(albumId, usuario.id);
    if (!album) throw new NoEncontrado(`álbum ${albumId}`);
    const quitado = await this.catalogo.quitarDeAlbum(albumId, medioId);
    if (!quitado) throw new NoEncontrado(`medio ${medioId} en el álbum`);
  }

  async eliminarAlbum(albumId, usuario) {
    const eliminado = await this.catalogo.eliminarAlbum(albumId, usuario.id);
    if (!eliminado) throw new NoEncontrado(`álbum ${albumId}`);
  }
}

AlbumService.validarOrden = validarOrden;

module.exports = AlbumService;
