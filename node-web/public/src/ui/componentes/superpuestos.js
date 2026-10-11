/*
 * Elementos que flotan sobre la pantalla: menús desplegables, diálogos,
 * hoja de detalles y snackbar. Se apoyan en <dialog> nativo, que ya resuelve
 * el foco, la tecla Esc y el fondo oscuro.
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";

// -------------------------------------------------------------------- Menú
let menuAbierto = null;

/**
 * Abre un menú anclado a un elemento (DropdownMenu).
 * items: { texto, icono?, accion, peligro?, marcado? } | { titulo } | "separador" | { html }
 */
export function abrirMenu(ancla, items, { alinear = "derecha" } = {}) {
  cerrarMenu();
  const menu = document.createElement("ul");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items
    .map((item, i) => {
      if (item === "separador") return `<li role="separator"><hr></li>`;
      if (item.titulo) return `<li class="menu-titulo">${esc(item.titulo)}</li>`;
      if (item.html) return `<li>${item.html}</li>`;
      return `<li role="none"><button type="button" role="menuitem" class="menu-item ${item.peligro ? "peligro" : ""}" data-i="${i}">
          ${item.icono ? icono(item.icono) : ""}<span>${esc(item.texto)}</span>
          ${item.marcado ? `<span class="marca" aria-label="Seleccionado">${icono("check")}</span>` : ""}
        </button></li>`;
    })
    .join("");
  document.body.append(menu);

  // Posición: debajo del ancla, sin salirse de la ventana.
  const r = ancla.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  let izquierda = alinear === "derecha" ? r.right - m.width : r.left;
  izquierda = Math.max(8, Math.min(izquierda, innerWidth - m.width - 8));
  let arriba = r.bottom + 4;
  if (arriba + m.height > innerHeight - 8) arriba = Math.max(8, r.top - m.height - 4);
  menu.style.left = `${izquierda}px`;
  menu.style.top = `${arriba}px`;

  const botones = [...menu.querySelectorAll(".menu-item")];
  botones[0]?.focus();

  menu.addEventListener("click", (e) => {
    const b = e.target.closest(".menu-item");
    if (!b) return;
    const item = items[Number(b.dataset.i)];
    cerrarMenu();
    item.accion?.();
  });
  menu.addEventListener("keydown", (e) => {
    const i = botones.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); botones[(i + 1) % botones.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); botones[(i - 1 + botones.length) % botones.length]?.focus(); }
    if (e.key === "Escape" || e.key === "Tab") { cerrarMenu(); ancla.focus(); }
  });

  const fuera = (e) => { if (!menu.contains(e.target) && !ancla.contains(e.target)) cerrarMenu(); };
  setTimeout(() => document.addEventListener("pointerdown", fuera), 0);
  addEventListener("resize", cerrarMenu, { once: true });
  menuAbierto = { menu, fuera };
}

export function cerrarMenu() {
  if (!menuAbierto) return;
  document.removeEventListener("pointerdown", menuAbierto.fuera);
  menuAbierto.menu.remove();
  menuAbierto = null;
}

// ----------------------------------------------------------------- Diálogos
function crearDialogo(clase, html) {
  const d = document.createElement("dialog");
  d.className = clase;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  // Clic en el fondo oscuro: cerrar.
  d.addEventListener("click", (e) => { if (e.target === d) d.close("fondo"); });
  d.showModal();
  return d;
}

/** Diálogo de confirmación (AlertDialog). Resuelve true si se acepta. */
export function confirmar({ titulo, mensaje, aceptar = "Aceptar", cancelar = "Cancelar", icono: nombreIcono = null, peligro = false }) {
  return new Promise((resolver) => {
    const d = crearDialogo(
      `dialogo chico ${nombreIcono ? "centrado" : ""}`,
      `<form method="dialog">
        ${nombreIcono ? `<div class="icono-dialogo">${icono(nombreIcono)}</div>` : ""}
        <h2 class="t-headline-s">${esc(titulo)}</h2>
        <p class="t-body-m">${esc(mensaje)}</p>
        <div class="dialogo-acciones">
          <button class="boton boton-texto" value="no">${esc(cancelar)}</button>
          <button class="boton boton-texto" value="si" ${peligro ? 'style="color:var(--error)"' : ""} autofocus>${esc(aceptar)}</button>
        </div>
      </form>`
    );
    d.addEventListener("close", () => resolver(d.returnValue === "si"));
  });
}

/** Pide un texto corto (nombre de carpeta o de álbum). Resuelve el texto o null. */
export function pedirTexto({ titulo, etiqueta, valor = "", aceptar = "Crear", ayuda = "" }) {
  return new Promise((resolver) => {
    const d = crearDialogo(
      "dialogo chico",
      `<form method="dialog">
        <h2 class="t-headline-s">${esc(titulo)}</h2>
        <label class="campo">
          <span class="campo-etiqueta">${esc(etiqueta)}</span>
          <span class="campo-caja"><input name="texto" value="${esc(valor)}" required maxlength="120" autocomplete="off"></span>
          ${ayuda ? `<span class="campo-ayuda">${esc(ayuda)}</span>` : ""}
        </label>
        <div class="dialogo-acciones">
          <button type="button" class="boton boton-texto" data-cancelar>Cancelar</button>
          <button class="boton boton-texto" value="si">${esc(aceptar)}</button>
        </div>
      </form>`
    );
    const campo = d.querySelector("input");
    campo.select();
    d.querySelector("[data-cancelar]").addEventListener("click", () => d.close("no"));
    d.addEventListener("close", () => resolver(d.returnValue === "si" && campo.value.trim() ? campo.value.trim() : null));
  });
}

/** Diálogo con contenido libre. Devuelve el <dialog> para conectar eventos. */
export function abrirDialogo(html, clase = "dialogo") {
  return crearDialogo(clase, html);
}

// ------------------------------------------------------- Hoja de detalles
/**
 * Panel con la ficha de un elemento (HojaDetalles del móvil): hoja inferior
 * en pantallas angostas y panel lateral en escritorio.
 */
export function abrirHoja(cuerpoHtml, { etiqueta = "Detalles" } = {}) {
  const d = crearDialogo("hoja", `<span class="hoja-agarre" aria-hidden="true"></span><div class="hoja-cuerpo">${cuerpoHtml}</div>`);
  d.setAttribute("aria-label", etiqueta);
  return d;
}

/** Cuerpo estándar de una hoja de detalles: cabecera, datos y acciones. */
export function cuerpoDetalles({ iconoHtml, titulo, subtitulo, filas, acciones = [] }) {
  return `
    <div class="cabecera-hoja">
      ${iconoHtml}
      <div class="texto">
        <div class="t-title-m">${esc(titulo)}</div>
        <div class="t-body-m atenuado">${esc(subtitulo)}</div>
      </div>
      <button type="button" class="boton-icono" data-cerrar-hoja aria-label="Cerrar">${icono("cerrar")}</button>
    </div>
    <hr>
    <h3 class="t-title-s" style="margin:8px 0">Detalles</h3>
    <dl>${filas.map(([etiqueta, valor, mono]) => `<div class="dato"><dt>${esc(etiqueta)}</dt><dd class="${mono ? "mono" : ""}">${esc(valor)}</dd></div>`).join("")}</dl>
    ${acciones.length ? `<div class="hoja-acciones">${acciones.map((a, i) => `<button type="button" class="boton ${a.clase ?? "boton-contorno"}" data-accion-hoja="${i}" ${a.peligro ? 'style="color:var(--error);border-color:var(--error)"' : ""}>${a.icono ? icono(a.icono) : ""}${esc(a.texto)}</button>`).join("")}</div>` : ""}`;
}

/** Conecta el botón cerrar y las acciones de una hoja creada con cuerpoDetalles. */
export function conectarHoja(hoja, acciones = []) {
  hoja.querySelector("[data-cerrar-hoja]")?.addEventListener("click", () => hoja.close());
  hoja.querySelectorAll("[data-accion-hoja]").forEach((b) =>
    b.addEventListener("click", () => acciones[Number(b.dataset.accionHoja)].accion(hoja))
  );
}

// ---------------------------------------------------------------- Snackbar
let snackbar = null;
let temporizador = null;

/** Mensaje breve en la parte inferior (SnackbarHost). */
export function avisar(texto, duracion = 4000) {
  if (!snackbar) {
    snackbar = document.createElement("div");
    snackbar.className = "snackbar";
    snackbar.setAttribute("role", "status");
    snackbar.setAttribute("aria-live", "polite");
    document.body.append(snackbar);
  }
  snackbar.textContent = texto;
  snackbar.classList.add("visible");
  clearTimeout(temporizador);
  temporizador = setTimeout(() => snackbar.classList.remove("visible"), duracion);
}
