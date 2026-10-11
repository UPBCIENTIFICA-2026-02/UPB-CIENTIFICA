const { spawn } = require("child_process");
const fsp = require("fs/promises");
const path = require("path");

/**
 * Envoltorio mínimo de FFmpeg/FFprobe. Aislado en su propio módulo para que
 * el dominio no sepa que existe un proceso externo, y para poder sustituirlo
 * en pruebas sin tener FFmpeg instalado.
 */
class Ffmpeg {
  constructor({ ffmpegBin, ffprobeBin, dirMiniaturas, anchoMiniatura }) {
    this.ffmpegBin = ffmpegBin;
    this.ffprobeBin = ffprobeBin;
    this.dirMiniaturas = dirMiniaturas;
    this.anchoMiniatura = anchoMiniatura;
  }

  #ejecutar(binario, args) {
    return new Promise((resolver, rechazar) => {
      const proceso = spawn(binario, args);
      let salida = "";
      let error = "";
      proceso.stdout.on("data", (d) => (salida += d));
      proceso.stderr.on("data", (d) => (error += d));
      proceso.on("error", (e) => rechazar(new Error(`${binario} no disponible: ${e.message}`)));
      proceso.on("close", (codigo) => {
        if (codigo === 0) resolver(salida);
        else rechazar(new Error(`${binario} salió con código ${codigo}: ${error.slice(0, 500)}`));
      });
    });
  }

  /** Metadatos técnicos: ancho, alto, duración. */
  async inspeccionar(rutaArchivo) {
    const salida = await this.#ejecutar(this.ffprobeBin, [
      "-v", "quiet", "-print_format", "json",
      "-show_format", "-show_streams", rutaArchivo,
    ]);
    const datos = JSON.parse(salida);
    const video = (datos.streams || []).find((s) => s.codec_type === "video");
    return {
      ancho: video?.width ?? null,
      alto: video?.height ?? null,
      duracionSegundos: datos.format?.duration
        ? Math.round(Number(datos.format.duration))
        : null,
    };
  }

  /** Genera la miniatura y devuelve su ruta. Para video toma el segundo 1. */
  async generarMiniatura(rutaArchivo, medioId, esVideo) {
    await fsp.mkdir(this.dirMiniaturas, { recursive: true });
    const destino = path.join(this.dirMiniaturas, `${medioId}.jpg`);

    const args = esVideo
      ? ["-y", "-ss", "00:00:01", "-i", rutaArchivo, "-vframes", "1",
         "-vf", `scale=${this.anchoMiniatura}:-1`, destino]
      : ["-y", "-i", rutaArchivo,
         "-vf", `scale=${this.anchoMiniatura}:-1`, destino];

    await this.#ejecutar(this.ffmpegBin, args);
    return destino;
  }
}

module.exports = Ffmpeg;