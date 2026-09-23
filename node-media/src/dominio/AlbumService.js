const { NoEncontrado, SolicitudInvalida } = require("./errores");

/** Reglas de negocio del álbum de fotografías (RF-05). */
class AlbumService {
  constructor({ catalogo, fuente, indexador }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.indexador = indexador;
  }

  #aDto(medio) {
    return {
      id: medio.id,
      titulo: medio.titulo,
      tipo: medio.tipo,
      tamanoBytes: Number(medio.tamano_bytes),
      ancho: medio.ancho,
      alto: medio.alto,
      tieneMiniatura: Boolean(medio.miniatura_path),
    };
  }

  async listarFotos(usuario, pagina = 0, porPagina = 50) {
    if (pagina < 0) throw new SolicitudInvalida("La página no puede ser negativa");
    const filas = await this.catalogo.listarPorTipo(
      usuario.id, "foto", porPagina, pagina * porPagina
    );
    return filas.map((f) => this.#aDto(f));
  }

  async buscarFotos(usuario, criterio) {
    if (!criterio || criterio.trim().length < 2) {
      throw new SolicitudInvalida("El criterio de búsqueda debe tener al menos 2 caracteres");
    }
    const filas = await this.catalogo.buscarPorTitulo(usuario.id, "foto", criterio.trim());
    return filas.map((f) => this.#aDto(f));
  }

  async obtenerFoto(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario.id);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    return this.#aDto(medio);
  }

  /** Miniatura: se sirve desde la caché local, no desde Storage. */
  async rutaMiniatura(medioId, usuario) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario.id);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    if (!medio.miniatura_path) throw new NoEncontrado(`miniatura de ${medioId}`);
    return medio.miniatura_path;
  }

  /** Contenido original: se pide a Storage con el token del usuario. */
  async abrirContenido(medioId, usuario, token) {
    const medio = await this.catalogo.buscarPorId(medioId, usuario.id);
    if (!medio) throw new NoEncontrado(`medio ${medioId}`);
    const lectura = await this.fuente.abrirLectura(medio.archivo_storage_id, token);
    return { ...lectura, titulo: medio.titulo };
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
    const medios = await this.catalogo.listarMediosDeAlbum(albumId);
    return {
      id: album.id,
      nombre: album.nombre,
      descripcion: album.descripcion,
      fotos: medios.map((m) => this.#aDto(m)),
    };
  }

  async agregarFoto(albumId, medioId, orden, usuario) {
    const album = await this.catalogo.buscarAlbum(albumId, usuario.id);
    if (!album) throw new NoEncontrado(`álbum ${albumId}`);
    const medio = await this.catalogo.buscarPorId(medioId, usuario.id);
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

module.exports = AlbumService;