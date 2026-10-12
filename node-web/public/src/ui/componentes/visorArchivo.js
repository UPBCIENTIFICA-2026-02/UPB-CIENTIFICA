/*
 * Visor de archivos de Storage DENTRO del portal: imágenes y videos de Mis
 * archivos y de lo que te compartieron se ven aquí, sin descargarlos.
 *
 *   Imagen  se pide con el token (fetch) y se muestra a pantalla completa.
 *   Video   el <video> lo pide por rangos a /api/storage/archivos/{id}/descargar.
 *           Un <video> no puede poner cabeceras, así que el token va como
 *           ?access_token=; node-web lo pasa a Authorization y lo quita de la
 *           URL antes de reenviarlo (docs/PASARELA.md).
 *
 * Funciona igual para lo compartido contigo: Storage ya aplica la compartición
 * en sus permisos, así que tu propio token basta.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano } from "../formato.js";
import { abrirDialogo, avisar } from "./superpuestos.js";
import { pedir, urlConToken } from "../../red/clienteApi.js";
import { almacenamiento } from "../../datos/almacenamiento.js";
import { esDemo } from "../../sesion/sesion.js";

const IMAGEN = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i;

/** true si el visor sabe mostrar este archivo. */
export const esVisible = (nombre) => IMAGEN.test(nombre || "") || VIDEO.test(nombre || "");

/**
 * Abre el archivo en el visor. `archivo`: { id, nombre, tamanoBytes? }.
 * Devuelve false si no es una imagen ni un video (quien llama decide qué hacer).
 */
export function abrirArchivo(archivo) {
  if (!esVisible(archivo.nombre)) return false;
  if (esDemo()) {
    avisar("Modo demostración: no hay un archivo real que mostrar.");
    return true;
  }
  const esVideo = VIDEO.test(archivo.nombre);
  const d = abrirDialogo(`
    <div class="visor-cab">
      <button type="button" class="boton-icono" data-cerrar aria-label="Cerrar">${icono("cerrar")}</button>
      <div class="titulo"><div class="t-title-m una-linea">${esc(archivo.nombre)}</div>
        <div class="t-body-s" style="opacity:.7">${archivo.tamanoBytes ? esc(formatearTamano(archivo.tamanoBytes)) : ""}</div></div>
      <button type="button" class="boton-icono" data-descargar aria-label="Descargar" title="Descargar">${icono("descargar")}</button>
    </div>
    <div class="visor-lienzo" data-lienzo><span class="rueda" style="color:#fff;width:32px;height:32px"></span></div>
    <div class="visor-pie"></div>`, "visor");

  const lienzo = d.querySelector("[data-lienzo]");
  let urlBlob = null;
  const mensaje = (texto) => { lienzo.innerHTML = `<p class="t-body-m" style="color:#fff;text-align:center">${esc(texto)}</p>`; };

  d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
  d.querySelector("[data-descargar]").addEventListener("click", async () => {
    try { await almacenamiento.descargar(archivo); }
    catch (error) { avisar(`No se pudo descargar: ${error.message}`); }
  });

  if (esVideo) {
    lienzo.innerHTML = `<video controls autoplay playsinline preload="metadata"
      style="max-width:100%;max-height:calc(100vh - 120px);background:#000"></video>`;
    const video = lienzo.querySelector("video");
    video.addEventListener("error", () =>
      mensaje("No se pudo reproducir el video. Revisa que el formato sea compatible con el navegador (MP4/H.264, WebM)."));
    video.src = urlConToken(`/storage/archivos/${encodeURIComponent(archivo.id)}/descargar`);
    d.addEventListener("close", () => { video.pause(); video.removeAttribute("src"); video.load(); });
  } else {
    pedir(`/storage/archivos/${encodeURIComponent(archivo.id)}/descargar`, { como: "blob", tiempo: 120_000 })
      .then((blob) => {
        if (!d.open) return;
        urlBlob = URL.createObjectURL(blob);
        lienzo.innerHTML = `<img alt="${esc(archivo.nombre)}" src="${urlBlob}">`;
      })
      .catch((error) => mensaje(`No se pudo abrir la imagen: ${error.message}`));
    d.addEventListener("close", () => { if (urlBlob) URL.revokeObjectURL(urlBlob); });
  }
  return true;
}
