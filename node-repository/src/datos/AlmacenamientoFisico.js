const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/**
 * Única capa que toca el sistema de archivos real (/srv/home, montado por NFSv4).
 * Aislarla permite testear el dominio sin disco y cambiar el backend después.
 */
class AlmacenamientoFisico {
  constructor(raiz) {
    this.raiz = raiz;
  }

  /**
   * Construye la ruta física y BLOQUEA path traversal.
   * Sin esta comprobación, un nombre como "../../etc/passwd" escaparía del Home.
   */
  rutaSegura(...segmentos) {
    const destino = path.resolve(this.raiz, ...segmentos);
    if (!destino.startsWith(path.resolve(this.raiz) + path.sep)) {
      throw new Error("Ruta fuera del área permitida");
    }
    return destino;
  }

  async guardar(rutaRelativa, bufferOStream) {
    const destino = this.rutaSegura(rutaRelativa);
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    await fsp.writeFile(destino, bufferOStream);
    const { size } = await fsp.stat(destino);
    return { rutaFisica: rutaRelativa, tamanoBytes: size };
  }

  /**
   * Abre el archivo para lectura, entero o por tramos.
   *
   * @param rango {{inicio: number, fin: number}|null} ambos inclusive, como en
   *        la cabecera Range de HTTP. El dominio ya los resolvió contra el
   *        tamaño real del archivo.
   */
  abrirLectura(rutaRelativa, rango = null) {
    const destino = this.rutaSegura(rutaRelativa);
    if (!rango) return fs.createReadStream(destino);

    // createReadStream también trata `end` como inclusive, así que los índices
    // pasan tal cual.
    return fs.createReadStream(destino, { start: rango.inicio, end: rango.fin });
  }

  async existe(rutaRelativa) {
    try {
      await fsp.access(this.rutaSegura(rutaRelativa));
      return true;
    } catch {
      return false;
    }
  }

  async eliminar(rutaRelativa) {
    try {
      await fsp.rm(this.rutaSegura(rutaRelativa), { force: true });
    } catch { /* ya no existe: idempotente */ }
  }

  async crearDirectorio(rutaRelativa) {
    await fsp.mkdir(this.rutaSegura(rutaRelativa), { recursive: true });
  }
}

module.exports = AlmacenamientoFisico;