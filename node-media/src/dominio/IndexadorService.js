const fsp = require("fs/promises");
const { v4: uuid } = require("uuid");
const path = require("path");
const { PERMISOS_ARCHIVO_NUEVO } = require("./permisos");

const EXT_FOTO = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"]);
const EXT_VIDEO = new Set([".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"]);

/**
 * Recorre el Home del usuario en Storage, detecta fotos y videos, genera sus
 * miniaturas y los registra en el catálogo.
 *
 * Es IDEMPOTENTE: reindexar no duplica (ON CONFLICT en el repositorio) y
 * elimina del catálogo los medios cuyo archivo ya no está en Storage.
 *
 * "root" en Storage es el Home DEL USUARIO que pregunta (ver la nota en
 * node-repository/src/dominio/ArchivoService.js). Antes devolvía los nodos raíz
 * de todos los usuarios, así que este indexador registraba archivos ajenos.
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

    /*
     * La limpieza se hace por propietario. Si dentro del Home hubiera un archivo
     * de otro usuario (porque compartió un directorio), su fila queda registrada
     * a nombre del dueño real y la limpiará él al reindexar, no este usuario.
     */
    await this.catalogo.eliminarHuerfanos(
      usuario.id,
      encontrados
        .filter((a) => (a.propietario || usuario.id) === usuario.id)
        .map((a) => a.id)
    );

    return { indexados: registrados.length, revisados: encontrados.length };
  }

  async #recorrer(directorioId, usuario, token, acumulador, profundidad = 0) {
    if (profundidad > 10) return; // corta ciclos y árboles patológicos

    const entradas = await this.fuente.listarArchivos(directorioId, token);

    // Storage devuelve un arreglo. Si llega otra cosa, es un contrato roto y
    // conviene decirlo en vez de fallar con "no es iterable".
    if (!Array.isArray(entradas)) {
      throw new Error(
        `Storage devolvió ${typeof entradas} al listar ${directorioId}; se esperaba un arreglo`
      );
    }

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

    /*
     * El propietario es el que dice Storage, no quien lanzó la indexación: si se
     * asumiera el segundo, un archivo compartido quedaría registrado a nombre de
     * quien lo miró. El `?? usuario.id` cubre a NfsSource, que no expone dueño.
     */
    const propietario = archivo.propietario || usuario.id;

    const existente = await this.catalogo.buscarPorArchivoStorage(archivo.id, propietario);

    /*
     * Si ya está indexado, no cambió de tamaño y mantiene los mismos permisos,
     * no se reprocesa: generar miniaturas es caro y el Home puede tener miles de
     * archivos. Los permisos entran en la comparación porque si Storage los
     * cambió hay que refrescar la copia local aunque el archivo sea el mismo.
     */
    if (
      existente &&
      Number(existente.tamano_bytes) === Number(archivo.tamanoBytes) &&
      existente.grupo === (archivo.grupo || "usuarios") &&
      existente.permisos === (archivo.permisos || PERMISOS_ARCHIVO_NUEVO)
    ) {
      return existente;
    }

    const { ruta, temporal } = await this.fuente.rutaLocal(archivo.id, token);
    try {
      const medioId = existente?.id || uuid();
      let tecnicos = { ancho: null, alto: null, duracionSegundos: null };
      let miniatura = existente?.miniatura_path || null;

      try {
        tecnicos = await this.ffmpeg.inspeccionar(ruta);
        miniatura = await this.ffmpeg.generarMiniatura(ruta, medioId, tipo === "video");
      } catch (e) {
        console.warn(`[indexador] sin miniatura para ${archivo.nombre}: ${e.message}`);
      }

      return await this.catalogo.registrar({
        id: medioId,
        archivoStorageId: archivo.id,
        propietario,
        grupo: archivo.grupo || "usuarios",
        permisos: archivo.permisos || PERMISOS_ARCHIVO_NUEVO,
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
