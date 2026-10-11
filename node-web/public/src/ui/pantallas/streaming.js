/*
 * Streaming (StreamingScreen.kt): catálogo en cuadrícula con miniaturas en
 * degradado y duración. Al elegir un video se abre una sesión de
 * reproducción en node-media y el reproductor pide el contenido por rangos,
 * así se puede saltar en la línea de tiempo sin descargar el archivo entero.
 */

import { icono } from "../iconos.js";
import { esc, formatearDuracion, formatearDia, hashKotlin } from "../formato.js";
import { barraSuperior, conectarBusqueda, estadoVacio, estadoError, esqueleto } from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirDialogo } from "../componentes/superpuestos.js";
import { streaming } from "../../datos/medios.js";

/** Pares de colores para las miniaturas; uno por video, estable (DegradadosMiniatura). */
const DEGRADADOS = [
  ["#1A5BC0", "#4FD8E3"],
  ["#7A4E9C", "#E37400"],
  ["#006970", "#9AE6B4"],
  ["#C5221F", "#F6AE2D"],
  ["#2E3A59", "#8E9CC9"],
];
const degradado = (id) => {
  const [desde, hasta] = DEGRADADOS[hashKotlin(String(id)) % DEGRADADOS.length];
  return `linear-gradient(135deg, ${desde}, ${hasta})`;
};

export function montar(contenedor) {
  let consulta = "";
  let estado = { tipo: "cargando" };
  let vivo = true;

  contenedor.innerHTML = `
    <div data-cab>${barraSuperior({ placeholder: "Buscar videos", acciones: accionesCuenta() })}</div>
    <div class="fila-titulo">
      <h1 class="t-title-l">Streaming</h1>
      <button type="button" class="boton-icono" data-actualizar aria-label="Actualizar" title="Actualizar">${icono("actualizar")}</button>
    </div>
    <div data-cuerpo></div>`;

  const cuerpo = contenedor.querySelector("[data-cuerpo]");
  conectarCuenta(contenedor);
  conectarBusqueda(contenedor, (v) => { consulta = v; pintar(); });

  async function cargar() {
    estado = { tipo: "cargando" };
    pintar();
    try {
      const lista = await streaming.catalogo(0);
      if (vivo) estado = { tipo: "listo", lista };
    } catch (error) {
      if (vivo) estado = { tipo: "error", mensaje: error.message };
    }
    if (vivo) pintar();
  }

  function pintar() {
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", cargar);
      return;
    }
    const q = consulta.trim().toLowerCase();
    const visibles = estado.lista.filter((v) => (v.titulo ?? "").toLowerCase().includes(q));
    if (!estado.lista.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "biblioteca", titulo: "El catálogo está vacío", mensaje: "Todavía no hay contenido disponible para reproducir. Los videos que subas a Mis archivos aparecen aquí después de indexarlos en Fotos." });
      return;
    }
    if (!visibles.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "sinResultados", titulo: "Sin resultados", mensaje: `Ningún video coincide con "${consulta.trim()}".` });
      return;
    }
    cuerpo.innerHTML = `<div class="rejilla-videos">${visibles.map((v) => `
      <button type="button" class="tarjeta-video" data-id="${esc(v.id)}">
        <div class="miniatura-video" style="background:${degradado(v.id)}">
          <span class="boton-play">${icono("play")}</span>
          <span class="duracion">${esc(formatearDuracion(v.duracionSegundos))}</span>
        </div>
        <div class="t-title-s">${esc(v.titulo)}</div>
        ${v.fecha ? `<div class="t-body-s atenuado">${esc(formatearDia(v.fecha))}</div>` : ""}
      </button>`).join("")}</div>`;
  }

  async function reproducir(video) {
    const d = abrirDialogo(`
      <div class="reproductor">
        <div data-lienzo><div class="sin-video" style="background:${degradado(video.id)}"><span class="rueda" style="color:#fff;width:32px;height:32px"></span></div></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:16px">
          <div style="flex:1;min-width:0"><h2 class="t-title-l" style="margin:0">${esc(video.titulo)}</h2>
          <p class="t-body-m">${esc(formatearDuracion(video.duracionSegundos))}${video.fecha ? ` · ${esc(formatearDia(video.fecha))}` : ""}</p></div>
          <button type="button" class="boton boton-texto" data-cerrar>Cerrar</button>
        </div>
      </div>`, "dialogo");
    d.style.width = "min(960px, calc(100vw - 32px))";
    d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
    const lienzo = d.querySelector("[data-lienzo]");

    try {
      const sesion = await streaming.sesion(video.id);
      const url = streaming.urlReproduccion(sesion);
      if (!url) {
        lienzo.innerHTML = `<div class="sin-video" style="background:${degradado(video.id)}"><div><div style="display:flex;justify-content:center">${icono("play")}</div>
          <p class="t-body-m" style="color:#fff;margin-top:8px">Modo demostración: no hay un video real que reproducir.<br>En el despliegue, el contenido lo entrega node-media por rangos.</p></div></div>`;
        return;
      }
      lienzo.innerHTML = `<video controls autoplay playsinline preload="metadata"></video>`;
      const reproductor = lienzo.querySelector("video");
      reproductor.addEventListener("error", () => {
        lienzo.innerHTML = `<div class="sin-video">No se pudo reproducir el video. Revisa que el formato sea compatible con el navegador (MP4/H.264).</div>`;
      });
      reproductor.src = url;
      d.addEventListener("close", () => { reproductor.pause(); reproductor.removeAttribute("src"); reproductor.load(); });
    } catch (error) {
      lienzo.innerHTML = `<div class="sin-video">${esc(`No se pudo iniciar la reproducción: ${error.message}`)}</div>`;
    }
  }

  cuerpo.addEventListener("click", (e) => {
    const t = e.target.closest("[data-id]");
    if (t) reproducir(estado.lista.find((v) => String(v.id) === t.dataset.id));
  });
  contenedor.querySelector("[data-actualizar]").addEventListener("click", cargar);

  cargar();
  return () => { vivo = false; };
}
