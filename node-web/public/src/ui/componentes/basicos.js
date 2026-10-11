/*
 * Componentes que producen HTML (equivalentes a ui/components/*.kt del móvil).
 * Cada función devuelve un texto HTML; quien la usa lo inserta y conecta los
 * eventos. Todo texto que viene del servidor se escapa con esc().
 */

import { icono } from "../iconos.js";
import { esc, hashKotlin } from "../formato.js";

// ------------------------------------------------------------------ Avatar
/** Colores fijos, legibles con texto blanco en ambos temas (Componentes.kt). */
const COLORES_AVATAR = ["#1A73E8", "#188038", "#D93025", "#E37400", "#9334E6", "#007B83", "#C5221F", "#5F6368"];

/** Círculo con la inicial; el color depende del texto, así es estable entre pantallas. */
export function avatar(texto, tamano = 36) {
  const limpio = String(texto ?? "").trim();
  const inicial = limpio ? limpio[0].toUpperCase() : "?";
  const color = COLORES_AVATAR[hashKotlin(limpio.toLowerCase()) % COLORES_AVATAR.length];
  return `<span class="avatar" style="width:${tamano}px;height:${tamano}px;background:${color};font-size:${Math.round(tamano * 0.42)}px" aria-hidden="true">${esc(inicial)}</span>`;
}

// ---------------------------------------------------------- Tipo de archivo
/**
 * Icono y color de cada tipo, deducidos de la extensión. Los colores son
 * fijos (no del tema) porque identifican el tipo: un PDF es rojo en claro y
 * en oscuro. Misma tabla que TipoArchivo.kt.
 */
const TIPOS = {
  carpeta: { etiqueta: "Carpeta", icono: "carpetaActiva", color: "#5F6B7A" },
  pdf: { etiqueta: "PDF", icono: "pdf", color: "#D93025" },
  hoja: { etiqueta: "Hoja de cálculo", icono: "hoja", color: "#188038" },
  documento: { etiqueta: "Documento", icono: "documento", color: "#1A73E8" },
  presentacion: { etiqueta: "Presentación", icono: "presentacion", color: "#E37400" },
  imagen: { etiqueta: "Imagen", icono: "imagen", color: "#C5221F" },
  video: { etiqueta: "Video", icono: "video", color: "#D93025" },
  audio: { etiqueta: "Audio", icono: "audio", color: "#9334E6" },
  comprimido: { etiqueta: "Comprimido", icono: "comprimido", color: "#795548" },
  codigo: { etiqueta: "Código", icono: "codigo", color: "#007B83" },
  datos: { etiqueta: "Datos", icono: "datos", color: "#007B83" },
  generico: { etiqueta: "Archivo", icono: "archivo", color: "#5F6368" },
};
const EXTENSIONES = {
  pdf: "pdf",
  csv: "hoja", tsv: "hoja", xls: "hoja", xlsx: "hoja", ods: "hoja",
  doc: "documento", docx: "documento", odt: "documento", txt: "documento", md: "documento", rtf: "documento", tex: "documento",
  ppt: "presentacion", pptx: "presentacion", odp: "presentacion",
  png: "imagen", jpg: "imagen", jpeg: "imagen", gif: "imagen", webp: "imagen", svg: "imagen", bmp: "imagen", tif: "imagen", tiff: "imagen",
  mp4: "video", mkv: "video", mov: "video", avi: "video", webm: "video",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio",
  zip: "comprimido", rar: "comprimido", "7z": "comprimido", tar: "comprimido", gz: "comprimido", tgz: "comprimido", bz2: "comprimido",
  py: "codigo", java: "codigo", kt: "codigo", c: "codigo", cpp: "codigo", h: "codigo", js: "codigo", ts: "codigo",
  r: "codigo", m: "codigo", sh: "codigo", ipynb: "codigo",
  json: "datos", xml: "datos", yaml: "datos", yml: "datos", h5: "datos", hdf5: "datos", nc: "datos",
  parquet: "datos", mat: "datos", npy: "datos", fasta: "datos", pdb: "datos", msh: "datos",
};

export function tipoArchivo(nombre, esCarpeta = false) {
  if (esCarpeta) return TIPOS.carpeta;
  const partes = String(nombre ?? "").toLowerCase().split(".");
  const extension = partes.length > 1 ? partes.pop() : "";
  return TIPOS[EXTENSIONES[extension]] ?? TIPOS.generico;
}

/** Icono del tipo sobre un cuadrado redondeado con su color muy tenue (IconoTipoArchivo). */
export function iconoTipo(tipo, tamano = 40) {
  const interno = Math.round(tamano * 0.58);
  return `<span class="icono-tipo" style="width:${tamano}px;height:${tamano}px;background:color-mix(in srgb, ${tipo.color} 14%, transparent);color:${tipo.color}" title="${esc(tipo.etiqueta)}">${icono(tipo.icono).replace('class="ico ', `style="width:${interno}px;height:${interno}px" class="ico `)}</span>`;
}

// -------------------------------------------------------- Barra de búsqueda
/** Buscador en forma de píldora, al estilo de la barra superior de Drive (BarraBusqueda). */
export function barraSuperior({ placeholder, valor = "", acciones = "" }) {
  return `
    <header class="barra-superior">
      <div class="barra-busqueda" role="search">
        ${icono("buscar")}
        <input type="search" data-busqueda value="${esc(valor)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" spellcheck="false">
        <button type="button" class="boton-icono" data-limpiar-busqueda aria-label="Borrar búsqueda" ${valor ? "" : "hidden"}>${icono("cerrar")}</button>
        <span class="acciones-cuenta" data-acciones-cuenta>${acciones}</span>
      </div>
    </header>`;
}

/** Conecta el campo de búsqueda: avisa cada cambio y muestra/oculta la "x". */
export function conectarBusqueda(raiz, alCambiar) {
  const campo = raiz.querySelector("[data-busqueda]");
  const limpiar = raiz.querySelector("[data-limpiar-busqueda]");
  if (!campo) return;
  campo.addEventListener("input", () => {
    limpiar.hidden = !campo.value;
    alCambiar(campo.value);
  });
  limpiar.addEventListener("click", (e) => {
    e.preventDefault();
    campo.value = "";
    limpiar.hidden = true;
    alCambiar("");
    campo.focus();
  });
}

// ----------------------------------------------------- Estados de las listas
/** Mensaje centrado con icono para listas vacías o búsquedas sin resultados (EstadoVacio). */
export function estadoVacio({ icono: nombreIcono, titulo, mensaje, accion = "" }) {
  return `
    <div class="estado-vacio">
      <span class="burbuja">${icono(nombreIcono)}</span>
      <h2 class="t-title-l">${esc(titulo)}</h2>
      <p class="t-body-m">${esc(mensaje)}</p>
      ${accion}
    </div>`;
}

/** Error de red con botón para reintentar (EstadoError). */
export function estadoError(mensaje) {
  return estadoVacio({
    icono: "nubeOff",
    titulo: "No se pudo cargar",
    mensaje,
    accion: `<button type="button" class="boton boton-tonal" data-accion="reintentar">Reintentar</button>`,
  });
}

/** Filas "fantasma" que pulsan mientras llega la respuesta (EsqueletoLista). */
export function esqueleto(filas = 8) {
  let html = `<div class="esqueleto" aria-busy="true" aria-label="Cargando">`;
  for (let i = 0; i < filas; i++) {
    html += `<div class="fila-esq"><span class="bloque"></span><span class="lineas"><span class="linea" style="width:${i % 2 === 0 ? 70 : 50}%;display:block"></span><span class="linea" style="display:block"></span></span></div>`;
  }
  return html + "</div>";
}

/** Encabezado de sección en mayúsculas pequeñas ("CARPETAS"). */
export function encabezadoSeccion(texto) {
  return `<h2 class="encabezado-seccion">${esc(texto)}</h2>`;
}

/** Barra de progreso; con valor null es indeterminada. */
export function barra(valor, { color = null, clase = "" } = {}) {
  const indeterminada = valor === null || valor === undefined;
  const ancho = indeterminada ? 40 : Math.round(Math.max(0, Math.min(1, valor)) * 100);
  return `<div class="barra ${indeterminada ? "indeterminada" : ""} ${clase}" role="progressbar" ${indeterminada ? "" : `aria-valuenow="${ancho}" aria-valuemin="0" aria-valuemax="100"`}><span style="width:${ancho}%;${color ? `background:${color}` : ""}"></span></div>`;
}
