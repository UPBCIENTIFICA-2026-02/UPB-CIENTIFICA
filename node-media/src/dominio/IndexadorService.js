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
 * Además del Home indexa lo COMPARTIDO con el usuario (Contrato_Streaming,
 * ListarCatalogo: "propio + compartido con él"), preguntándole a Shared File
 * Service qué le compartieron.
 *
 * Cuándo se indexa: bajo demanda (POST /album/indexar) y, ANTES solo así, lo
 * nuevo no aparecía hasta pulsar "Buscar nuevas". AHORA también al pedir la
 * primera página del álbum o del catálogo, como mucho una vez por minuto y
 * usuario (refrescar). Así una revocación o un borrado desaparecen en la
 * siguiente consulta, como pide el contrato.
 *
 * TODO: cuando exista un mecanismo de eventos, conviene que Storage notifique
 * las altas y bajas para evitar recorrer todo el Home.
 */
const EDAD_MAXIMA_INDICE_MS = 60_000;

class IndexadorService {
  #ultimoRefresco = new Map();   // uid -> instante del último índice completo
  #enCurso = new Map();          // uid -> promesa (dos peticiones a la vez esperan la misma)

  constructor({ catalogo, fuente, ffmpeg, compartidos = null }) {
    this.catalogo = catalogo;
    this.fuente = fuente;
    this.ffmpeg = ffmpeg;
    this.compartidos = compartidos;
  }

  /**
   * Reindexa si el índice de este usuario tiene más de un minuto. Nunca falla:
   * si Storage o Shared File no responden, se lista lo que ya estaba indexado.
   */
  async refrescar(usuario, token) {
    const hace = Date.now() - (this.#ultimoRefresco.get(usuario.id) || 0);
    if (hace < EDAD_MAXIMA_INDICE_MS) return;
    await this.indexarHome(usuario, token).catch((e) =>
      console.warn(`[indexador] refresco de ${usuario.id} fallido: ${e.message}`));
  }

  #clasificar(nombre) {
    const ext = path.extname(nombre).toLowerCase();
    if (EXT_FOTO.has(ext)) return "foto";
    if (EXT_VIDEO.has(ext)) return "video";
    return null;
  }

  async indexarHome(usuario, token) {
    if (this.#enCurso.has(usuario.id)) return this.#enCurso.get(usuario.id);
    const promesa = this.#indexarTodo(usuario, token).finally(() => {
      this.#enCurso.delete(usuario.id);
    });
    this.#enCurso.set(usuario.id, promesa);
    return promesa;
  }

  async #indexarTodo(usuario, token) {
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

    const compartidos = await this.#indexarCompartidos(usuario, token);
    this.#ultimoRefresco.set(usuario.id, Date.now());

    return {
      indexados: registrados.length,
      revisados: encontrados.length,
      compartidos: compartidos ?? 0,
    };
  }

  /**
   * Indexa lo que Shared File dice que está compartido con el usuario (archivos
   * sueltos y el contenido de carpetas) y rehace su lista de visibles. Cada
   * medio queda registrado a nombre de su DUEÑO real; la miniatura se genera
   * con el token de quien recibe, que Storage autoriza por la compartición.
   *
   * Si Shared File no responde se conserva la lista anterior (null): mejor un
   * catálogo un poco viejo que uno que pierde de golpe todo lo compartido.
   */
  async #indexarCompartidos(usuario, token) {
    if (!this.compartidos) return null;
    let relaciones;
    try {
      relaciones = await this.compartidos.compartidosConmigo(token);
    } catch (e) {
      console.warn(`[indexador] sin compartidos para ${usuario.id}: ${e.message}`);
      return null;
    }

    const encontrados = new Map();
    for (const r of relaciones) {
      if (r.elementoTipo === "DIRECTORIO") {
        const dentro = [];
        try {
          await this.#recorrer(r.elementoId, usuario, token, dentro);
        } catch (e) {
          console.warn(`[indexador] carpeta compartida ${r.nombre} omitida: ${e.message}`);
        }
        dentro.forEach((a) => encontrados.set(a.id, a));
      } else if (this.#clasificar(r.nombre || "")) {
        encontrados.set(r.elementoId, {
          id: r.elementoId, nombre: r.nombre, tamanoBytes: r.tamanoBytes, propietario: r.propietario,
        });
      }
    }

    const visibles = [];
    for (const archivo of encontrados.values()) {
      if ((archivo.propietario || usuario.id) === usuario.id) continue;   // es suyo: ya está
      try {
        visibles.push((await this.#indexarArchivo(archivo, usuario, token)).id);
      } catch (e) {
        console.warn(`[indexador] compartido omitido ${archivo.nombre}: ${e.message}`);
      }
    }
    await this.catalogo.fijarCompartidosCon(usuario.id, visibles);
    return visibles.length;
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
    // Un archivo compartido suelto llega de Shared File sin grupo ni permisos:
    // se conservan los que ya había registrado su dueño en vez de pisarlos.
    const grupo = archivo.grupo || existente?.grupo || "usuarios";
    const permisos = archivo.permisos || existente?.permisos || PERMISOS_ARCHIVO_NUEVO;

    if (
      existente &&
      Number(existente.tamano_bytes) === Number(archivo.tamanoBytes) &&
      existente.grupo === grupo &&
      existente.permisos === permisos &&
      (existente.miniatura_path || !this.ffmpeg.disponible)
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
        grupo,
        permisos,
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
