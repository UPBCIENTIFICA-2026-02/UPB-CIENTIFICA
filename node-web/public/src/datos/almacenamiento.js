/*
 * Distributed Storage (node-repository) — equivalente a data/storage/ del móvil.
 *
 * Mismas rutas y mismos campos que StorageApi.kt, pero bajo el prefijo de la
 * pasarela: el navegador pide /api/storage/... y node-web lo reenvía a
 * node-repository:8084/storage/... con el mismo token.
 *
 * ArchivoDto: { id, nombre, tipo: "archivo"|"directorio", tamanoBytes, version, directorioContenedorId }
 */

import { pedir, subirConProgreso } from "../red/clienteApi.js";
import { esDemo } from "../sesion/sesion.js";
import { almacenamientoDemo } from "./demo.js";

const real = {
  listar: (directorioId) => pedir(`/storage/directorios/${encodeURIComponent(directorioId)}`),
  cuota: () => pedir("/storage/cuota"),
  subir(archivo, directorioId, alProgresar, sobrescribir = false) {
    const formulario = new FormData();
    formulario.append("archivo", archivo, archivo.name);
    const q = new URLSearchParams({ directorioDestino: directorioId, sobrescribir: String(sobrescribir) });
    return subirConProgreso(`/storage/archivos?${q}`, formulario, alProgresar);
  },
  crearCarpeta: (nombre, directorioPadreId) =>
    pedir("/storage/directorios", { metodo: "POST", cuerpo: { nombre, directorioPadreId } }),
  eliminar: (id) => pedir(`/storage/archivos/${encodeURIComponent(id)}`, { metodo: "DELETE", como: "nada" }),
  descargar: (archivo) =>
    pedir(`/storage/archivos/${encodeURIComponent(archivo.id)}/descargar`, { como: "blob", tiempo: 10 * 60_000 }),
};

const fuente = () => (esDemo() ? almacenamientoDemo : real);

export const almacenamiento = {
  listar: (id) => fuente().listar(id),
  cuota: () => fuente().cuota(),
  subir: (archivo, directorioId, alProgresar, sobrescribir) => fuente().subir(archivo, directorioId, alProgresar, sobrescribir),
  crearCarpeta: (nombre, padreId) => fuente().crearCarpeta(nombre, padreId),
  eliminar: (id) => fuente().eliminar(id),

  /** Descarga el archivo y lo entrega al navegador con su nombre original. */
  async descargar(archivo) {
    const blob = await fuente().descargar(archivo);
    const url = URL.createObjectURL(blob);
    const enlace = Object.assign(document.createElement("a"), { href: url, download: archivo.nombre });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};
