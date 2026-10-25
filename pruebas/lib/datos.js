/**
 * Datos de prueba generados en el momento: nada binario en el repositorio.
 */
const zlib = require("zlib");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const sha256 = (datos) => crypto.createHash("sha256").update(datos).digest("hex");

// ------------------------------------------------------------------ PNG válido

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
}

/**
 * PNG RGB con un degradado. La semilla cambia los colores para que dos
 * imágenes de la misma ejecución no tengan el mismo hash.
 */
function generarPng(ancho = 64, alto = 48, semilla = 0) {
    const filas = [];
    for (let y = 0; y < alto; y++) {
        const fila = Buffer.alloc(1 + ancho * 3); // byte 0: filtro "ninguno"
        for (let x = 0; x < ancho; x++) {
            fila[1 + x * 3] = (x * 4 + semilla) & 0xff;
            fila[2 + x * 3] = (y * 5 + semilla * 3) & 0xff;
            fila[3 + x * 3] = (128 + semilla * 7) & 0xff;
        }
        filas.push(fila);
    }
    const cabecera = Buffer.alloc(13);
    cabecera.writeUInt32BE(ancho, 0);
    cabecera.writeUInt32BE(alto, 4);
    cabecera[8] = 8;  // bits por canal
    cabecera[9] = 2;  // RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        trozo("IHDR", cabecera),
        trozo("IDAT", zlib.deflateSync(Buffer.concat(filas))),
        trozo("IEND", Buffer.alloc(0)),
    ]);
}

// --------------------------------------------------------------- video (mp4)

/**
 * Un mp4 de 3 s. Usa --video si se dio; si no, lo genera con ffmpeg (patrón
 * de prueba testsrc). Devuelve null si no hay ninguna de las dos cosas.
 */
function obtenerVideo(cfg) {
    if (cfg.video) return fs.readFileSync(cfg.video);
    const destino = path.join(os.tmpdir(), `upbc-e2e-${process.pid}.mp4`);
    const r = spawnSync(cfg.ffmpeg, [
        "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", destino,
    ], { stdio: "pipe" });
    if (r.error || r.status !== 0 || !fs.existsSync(destino)) return null;
    const bytes = fs.readFileSync(destino);
    fs.rmSync(destino, { force: true });
    return bytes;
}

// ------------------------------------------------------- programas MPI de prueba

/*
 * Un solo programa con varios comportamientos según parametrosEjecucion, que
 * job-runner pasa como argumentos "clave=valor" (ReglasTrabajo.argumentos):
 *   espera=N   duerme N segundos (para cancelar o provocar timeout)
 *   salida=N   termina con ese código (para provocar FALLIDO)
 * El dataset llega como ruta en los argumentos (Ejecucion.ejecutar): se cuentan
 * sus líneas para comprobar que el gestor lo bajó de Storage.
 *
 * Funciona con mpi4py (clúster real) y sin él (mpirun simulado del PC).
 */
const PROGRAMA_PY = `import os, sys, time
try:
    from mpi4py import MPI
    com = MPI.COMM_WORLD
    rango, total = com.Get_rank(), com.Get_size()
except ImportError:
    com, rango, total = None, 0, 1

espera, salida, lineas = 0, 0, -1
for a in sys.argv[1:]:
    if a.startswith("espera="): espera = int(a.split("=", 1)[1])
    elif a.startswith("salida="): salida = int(a.split("=", 1)[1])
    elif os.path.isfile(a):
        with open(a) as f: lineas = sum(1 for _ in f)

parcial = sum(range(rango, 1001, total))
suma = com.reduce(parcial, root=0) if com else parcial
if espera: time.sleep(espera)
if rango == 0:
    print("E2E-OK procesos=%d suma=%d lineas=%d" % (total, suma, lineas), flush=True)
sys.exit(salida)
`;

const PROGRAMA_C = `#include <mpi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    int rango, total, espera = 0, salida = 0, lineas = -1;
    long parcial = 0, suma = 0;
    MPI_Init(&argc, &argv);
    MPI_Comm_rank(MPI_COMM_WORLD, &rango);
    MPI_Comm_size(MPI_COMM_WORLD, &total);
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "espera=", 7) == 0) espera = atoi(argv[i] + 7);
        else if (strncmp(argv[i], "salida=", 7) == 0) salida = atoi(argv[i] + 7);
        else {
            FILE *f = fopen(argv[i], "r");
            if (f) { int c; lineas = 0; while ((c = fgetc(f)) != EOF) if (c == '\\n') lineas++; fclose(f); }
        }
    }
    for (long i = rango; i <= 1000; i += total) parcial += i;
    MPI_Reduce(&parcial, &suma, 1, MPI_LONG, MPI_SUM, 0, MPI_COMM_WORLD);
    if (espera) sleep(espera);
    if (rango == 0) { printf("E2E-OK procesos=%d suma=%ld lineas=%d\\n", total, suma, lineas); fflush(stdout); }
    MPI_Finalize();
    return salida;
}
`;

function programaMpi(lenguaje) {
    return lenguaje === "c"
        ? { extension: "c", codigo: PROGRAMA_C }
        : { extension: "py", codigo: PROGRAMA_PY };
}

/** Dataset de 10 líneas: el programa debe informar lineas=10. */
const DATASET = Array.from({ length: 10 }, (_, i) => `${i},${i * i}`).join("\n") + "\n";

module.exports = { generarPng, obtenerVideo, programaMpi, DATASET, sha256 };
