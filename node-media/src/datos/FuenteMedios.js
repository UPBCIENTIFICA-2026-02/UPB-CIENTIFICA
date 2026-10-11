const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { FuenteNoDisponible, NoEncontrado, PermisoDenegado } = require("../dominio/errores");

/**
 * De dónde salen los bytes de fotos y videos.
 *
 * DECISIÓN ARQUITECTÓNICA PENDIENTE DE CONFIRMAR CON EL EQUIPO
 * ------------------------------------------------------------
 * StorageApiSource (por defecto): consume la API REST de node-repository.
 *   + Respeta cuotas, permisos Unix y el índice de metadatos.
 *   + Un archivo subido por CUALQUIER vía (web, móvil, sync) aparece aquí.
 *   - Un salto de red extra por descarga.
 *
 * NfsSource: lee directo del montaje /srv/home, como dibuja el diagrama de
 *   despliegue.
 *   + Menor latencia, mejor para streaming de video bajo carga.
 *   - Salta las reglas de Storage y rompe el principio SOA de "comunicación
 *     solo por contrato" que fija la propuesta de arquitectura.
 *
 * El token del usuario se propaga siempre a Storage para que sea ÉL quien
 * aplique los permisos: node-media nunca decide si un usuario puede ver un
 * archivo, solo pregunta.
 */
class FuenteMedios {
  async listarArchivos(_directorioId, _token) { throw new Error("No implementado"); }
  async abrirLectura(_archivoId, _token) { throw new Error("No implementado"); }
  async rutaLocal(_archivoId, _token) { throw new Error("No implementado"); }
  async eliminarArchivo(_archivoId, _token) { throw new Error("No implementado"); }
}

class StorageApiSource extends FuenteMedios {
  constructor(urlBase) {
    super();
    this.urlBase = urlBase.replace(/\/$/, "");
  }

  #cabeceras(token) {
    return { Authorization: `Bearer ${token}` };
  }

  async listarArchivos(directorioId, token) {
    let res;
    try {
      res = await fetch(`${this.urlBase}/storage/directorios/${directorioId}`, {
        headers: this.#cabeceras(token),
      });
    } catch (e) {
      throw new FuenteNoDisponible(`no se pudo contactar a Storage: ${e.message}`);
    }
    if (res.status === 404) throw new NoEncontrado(`directorio ${directorioId}`);
    if (!res.ok) throw new FuenteNoDisponible(`Storage respondió ${res.status}`);
    return res.json();
  }

  /** Devuelve { flujo, tamanoBytes } — flujo es un ReadableStream web. */
  async abrirLectura(archivoId, token, rango = null) {
    const cabeceras = this.#cabeceras(token);
    if (rango) cabeceras.Range = rango;

    let res;
    try {
      res = await fetch(`${this.urlBase}/storage/archivos/${archivoId}/descargar`, {
        headers: cabeceras,
      });
    } catch (e) {
      throw new FuenteNoDisponible(`no se pudo contactar a Storage: ${e.message}`);
    }
    if (res.status === 404) throw new NoEncontrado(`archivo ${archivoId}`);
    if (!res.ok && res.status !== 206) {
      throw new FuenteNoDisponible(`Storage respondió ${res.status}`);
    }
    return {
      flujo: res.body,
      tamanoBytes: Number(res.headers.get("content-length") || 0),
      estado: res.status,
      contentRange: res.headers.get("content-range"),
    };
  }

  /**
   * Borra el archivo en Storage con el token del usuario: Storage vuelve a
   * comprobar que puede escribirlo. Si ya no existía (404) no es un error: lo
   * que se quería era que no estuviera.
   */
  async eliminarArchivo(archivoId, token) {
    let res;
    try {
      res = await fetch(`${this.urlBase}/storage/archivos/${archivoId}`, {
        method: "DELETE",
        headers: this.#cabeceras(token),
      });
    } catch (e) {
      throw new FuenteNoDisponible(`no se pudo contactar a Storage: ${e.message}`);
    }
    if (res.ok || res.status === 404) return;
    if (res.status === 403) throw new PermisoDenegado("eliminar el archivo en Storage");
    throw new FuenteNoDisponible(`Storage respondió ${res.status} al eliminar`);
  }

  /**
   * FFmpeg necesita un archivo en disco. Se descarga a un temporal.
   * Solo se usa al INDEXAR (generar miniatura / leer duración), nunca al servir.
   */
  async rutaLocal(archivoId, token) {
    const { flujo } = await this.abrirLectura(archivoId, token);
    const destino = path.join(require("os").tmpdir(), `media-${archivoId}`);
    await fsp.writeFile(destino, flujo);
    return { ruta: destino, temporal: true };
  }
}

class NfsSource extends FuenteMedios {
  constructor(raiz) {
    super();
    this.raiz = raiz;
  }

  #rutaSegura(...segmentos) {
    const destino = path.resolve(this.raiz, ...segmentos);
    if (!destino.startsWith(path.resolve(this.raiz) + path.sep)) {
      throw new Error("Ruta fuera del área permitida");
    }
    return destino;
  }

  async listarArchivos(directorioRelativo, _token) {
    // ADVERTENCIA: sin token no hay validación de permisos. Ver nota de arriba.
    const dir = this.#rutaSegura(directorioRelativo === "root" ? "" : directorioRelativo);
    const entradas = await fsp.readdir(dir, { withFileTypes: true });
    const salida = [];
    for (const e of entradas) {
      const completa = path.join(dir, e.name);
      const st = await fsp.stat(completa);
      salida.push({
        id: path.relative(this.raiz, completa),
        nombre: e.name,
        tipo: e.isDirectory() ? "directorio" : "archivo",
        tamanoBytes: st.size,
        version: 1,
      });
    }
    return salida;
  }

  async abrirLectura(archivoRelativo, _token) {
    const completa = this.#rutaSegura(archivoRelativo);
    const st = await fsp.stat(completa).catch(() => null);
    if (!st) throw new NoEncontrado(`archivo ${archivoRelativo}`);
    return { flujo: fs.createReadStream(completa), tamanoBytes: st.size, estado: 200 };
  }

  async rutaLocal(archivoRelativo, _token) {
    return { ruta: this.#rutaSegura(archivoRelativo), temporal: false };
  }

  // Borrar por NFS se saltaría permisos, cuotas y el índice de Storage.
  async eliminarArchivo(_archivoRelativo, _token) {
    throw new FuenteNoDisponible("con FUENTE_MEDIOS=nfs no se borran archivos: hágalo desde Storage");
  }
}

function crearFuente(config) {
  if (config.fuenteMedios === "nfs") return new NfsSource(config.raizNfs);
  return new StorageApiSource(config.urlStorage);
}

module.exports = { FuenteMedios, StorageApiSource, NfsSource, crearFuente };