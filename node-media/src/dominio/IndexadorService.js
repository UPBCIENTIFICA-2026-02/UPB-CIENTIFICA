const fsp = require("fs/promises");
const path = require("path");

const EXT_FOTO = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"]);
const EXT_VIDEO = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"]);

/**
 * Recorre el Home del usuario en Storage, detecta fotos y videos, genera sus
 * miniaturas y los registra en el catálogo.
 *
 * Es IDEMPOTENTE: reindexar no duplica (ON CONFLICT en el repositorio) y
 * elimina del catálogo los medios cuyo archivo ya no está en Storage.
 *
 * TODO: hoy la indexación se dispara bajo demanda (POST /album/indexar).
 * Cuando exista un mecanismo de eventos, conviene que Storage notifique las
 * altas y bajas para evitar recorrer todo el Home.
 */
class IndexadorService {
  constructor({ catalogo, fuente, ffmpeg }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.ffmpeg = ffmpeg;
  }

  #clasificar(nombre) {
    const ext = path.extname(nombre).toLowerCase();
    if (EXT_FOTO.has(ext)) return "foto";
    if (EXT_VIDEO.has(ext)) return "video";
    return null;
  }

  async indexarHome(usuario, token) {
    const encontrados = [];
    await this.#recorrer("root", usuario, token, encontrados);

    const registrados = [];
    for (const archivo of encontrados) {
      try {
        registrados.push(await this.#indexarArchivo(archivo, usuario, token));
      } catch (e) {
        // Un archivo corrupto o un formato que FFmpeg no entienda no debe
        // abortar la indexación completa del Home.
        console.warn(`[indexador] omitido ${archivo.nombre}: ${e.message}`);
      }
    }

    await this.catalogo.eliminarHuerfanos(usuario.id, encontrados.map((a) => a.id));

    return { indexados: registrados.length, revisados: encontrados.length };
  }

  async #recorrer(directorioId, usuario, token, acumulador, profundidad = 0) {
    if (profundidad > 10) return; // corta ciclos y árboles patológicos
    const entradas = await this.fuente.listarArchivos(directorioId, token);
    for (const entrada of entradas) {
      if (entrada.tipo === "directorio") {
        await this.#recorrer(entrada.id, usuario, token, acumulador, profundidad + 1);
      } else if (this.#clasificar(entrada.nombre)) {
        acumulador.push(entrada);
      }
    }
  }

  async #indexarArchivo(archivo, usuario, token) {
    const tipo = this.#clasificar(archivo.nombre);
    const existente = await this.catalogo.buscarPorArchivoStorage(archivo.id, usuario.id);

    // Si ya está indexado y no cambió de tamaño, no se reprocesa: generar
    // miniaturas es caro y el Home puede tener miles de archivos.
    if (existente && Number(existente.tamano_bytes) === Number(archivo.tamanoBytes)) {
      return existente;
    }

    const { ruta, temporal } = await this.fuente.rutaLocal(archivo.id, token);
    try {
      const medioId = existente?.id || require("uuid").v4();
      let tecnicos = { ancho: null, alto: null, duracionSegundos: null };
      let miniatura = null;

      try {
        tecnicos = await this.ffmpeg.inspeccionar(ruta);
        miniatura = await this.ffmpeg.generarMiniatura(ruta, medioId, tipo === "video");
      } catch (e) {
        console.warn(`[indexador] sin miniatura para ${archivo.nombre}: ${e.message}`);
      }

      return await this.catalogo.registrar({
        id: medioId,
        archivoStorageId: archivo.id,
        propietario: usuario.id,
        titulo: path.parse(archivo.nombre).name,
        tipo,
        mime: null,
        tamanoBytes: archivo.tamanoBytes,
        ancho: tecnicos.ancho,
        alto: tecnicos.alto,
        duracionSegundos: tecnicos.duracionSegundos,
        tomadaEn: null,
        miniaturaPath: miniatura,
      });
    } finally {
      if (temporal) await fsp.rm(ruta, { force: true }).catch(() => {});
    }
  }
}

module.exports = IndexadorService;