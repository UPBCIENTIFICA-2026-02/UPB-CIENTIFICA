/*
 * Photo Album y Streaming (node-media, puerto 8083).
 *
 * El enunciado pide que el álbum "funcione sobre la web": esta es la interfaz
 * que lo cumple. Las rutas son las que ya expone node-media (rutas/album.js y
 * rutas/streaming.js), bajo el prefijo de la pasarela.
 *
 * Foto:  { id, titulo, tipo, tamanoBytes, ancho, alto, tieneMiniatura, fecha, propietario, compartido }
 * Video: { id, titulo, duracionSegundos, fecha, tamanoBytes, tieneMiniatura, visualizaciones,
 *          propietario, compartido }
 *
 * Lo compartido contigo también llega aquí (compartido = true). El orden lo
 * aplica node-media (ordenPor del Contrato_Streaming): RECIENTES, ALFABETICO
 * y, solo en videos, MAS_VISTOS.
 */

import { pedir, urlConToken } from "../red/clienteApi.js";
import { esDemo } from "../sesion/sesion.js";
import { albumDemo, streamingDemo } from "./demo.js";

// Las miniaturas se piden con el token y se guardan como blob: una sola
// descarga por foto mientras dure la sesión.
const cacheMiniaturas = new Map();

const conOrden = (ordenPor) => (ordenPor ? `&ordenPor=${encodeURIComponent(ordenPor)}` : "");

/** Miniatura con token, como blob; una descarga por elemento mientras dure la sesión. */
function miniatura(ruta, id) {
  if (!cacheMiniaturas.has(ruta)) {
    cacheMiniaturas.set(ruta, pedir(ruta, { como: "blob" }).then((b) => URL.createObjectURL(b)));
  }
  return cacheMiniaturas.get(ruta);
}

const albumReal = {
  fotos: (pagina = 0, ordenPor) => pedir(`/album/fotos?pagina=${pagina}${conOrden(ordenPor)}`),
  async urlMiniatura(foto) {
    if (!foto.tieneMiniatura) return null;
    return miniatura(`/album/fotos/${encodeURIComponent(foto.id)}/miniatura`);
  },
  async urlContenido(foto) {
    const blob = await pedir(`/album/fotos/${encodeURIComponent(foto.id)}/contenido`, { como: "blob", tiempo: 120_000 });
    return URL.createObjectURL(blob);
  },
  indexar: () => pedir("/album/indexar", { metodo: "POST", tiempo: 120_000 }),
  albumes: () => pedir("/album/albumes"),
  verAlbum: (id) => pedir(`/album/albumes/${encodeURIComponent(id)}`),
  crearAlbum: (nombre, descripcion) => pedir("/album/albumes", { metodo: "POST", cuerpo: { nombre, descripcion } }),
  agregarFoto: (albumId, medioId) =>
    pedir(`/album/albumes/${encodeURIComponent(albumId)}/fotos`, { metodo: "POST", cuerpo: { medioId }, como: "nada" }),
  quitarFoto: (albumId, medioId) =>
    pedir(`/album/albumes/${encodeURIComponent(albumId)}/fotos/${encodeURIComponent(medioId)}`, { metodo: "DELETE", como: "nada" }),
};

const streamingReal = {
  catalogo: (pagina = 0, ordenPor) => pedir(`/streaming/catalogo?pagina=${pagina}${conOrden(ordenPor)}`),
  sesion: (id) => pedir(`/streaming/${encodeURIComponent(id)}/sesion`),
  async urlMiniatura(video) {
    if (!video.tieneMiniatura) return null;
    return miniatura(`/streaming/${encodeURIComponent(video.id)}/miniatura`);
  },
};

const fuenteAlbum = () => (esDemo() ? albumDemo : albumReal);

export const album = {
  fotos: (pagina, ordenPor) => fuenteAlbum().fotos(pagina, ordenPor),
  urlMiniatura: (foto) => fuenteAlbum().urlMiniatura(foto),
  urlContenido: (foto) => fuenteAlbum().urlContenido(foto),
  indexar: () => fuenteAlbum().indexar(),
  albumes: () => fuenteAlbum().albumes(),
  verAlbum: (id) => fuenteAlbum().verAlbum(id),
  crearAlbum: (nombre, descripcion) => fuenteAlbum().crearAlbum(nombre, descripcion),
  agregarFoto: (albumId, medioId) => fuenteAlbum().agregarFoto(albumId, medioId),
  quitarFoto: (albumId, medioId) => fuenteAlbum().quitarFoto(albumId, medioId),
};
export const streaming = {
  catalogo: (pagina, ordenPor) => (esDemo() ? streamingDemo : streamingReal).catalogo(pagina, ordenPor),
  urlMiniatura: (video) => (esDemo() ? Promise.resolve(null) : streamingReal.urlMiniatura(video)),
  sesion: (id) => (esDemo() ? streamingDemo : streamingReal).sesion(id),

  /**
   * URL que se le da al <video>. node-media responde manifestUrl como
   * "/streaming/{id}/contenido"; el reproductor la pide con Range para poder
   * saltar en la línea de tiempo. En modo demo no hay video real.
   */
  urlReproduccion: (sesion) => (sesion?.manifestUrl ? urlConToken(sesion.manifestUrl) : null),
};
