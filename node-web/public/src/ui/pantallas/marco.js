/*
 * Estructura de la app ya autenticada (MainScreen.kt): contenido de la
 * pestaña activa más la navegación.
 *
 *  - Pantalla angosta: barra de navegación inferior, igual que el móvil.
 *  - Escritorio: navegación lateral con el botón "Nuevo" y la cuota, como
 *    Drive en el navegador.
 *
 * La pestaña activa vive en la URL (#/archivos), así el botón Atrás del
 * navegador y los enlaces directos funcionan.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano } from "../formato.js";
import { barra } from "../componentes/basicos.js";
import { abrirMenu } from "../componentes/superpuestos.js";
import { almacenamiento } from "../../datos/almacenamiento.js";

import * as inicio from "./inicio.js";
import * as archivos from "./archivos.js";
import * as compartidos from "./compartidos.js";
import * as fotos from "./fotos.js";
import * as streaming from "./streaming.js";
import * as hpc from "./hpc.js";

/** Destinos de la navegación (enum Pestana de MainScreen.kt, más Fotos). */
export const PESTANAS = [
  { id: "inicio", etiqueta: "Inicio", larga: "Inicio", icono: "inicio", activo: "inicioActivo", modulo: inicio },
  { id: "archivos", etiqueta: "Archivos", larga: "Mis archivos", icono: "carpeta", activo: "carpetaActiva", modulo: archivos },
  { id: "compartidos", etiqueta: "Compartidos", larga: "Compartidos conmigo", icono: "compartidos", activo: "compartidosActivo", modulo: compartidos },
  { id: "fotos", etiqueta: "Fotos", larga: "Fotos", icono: "fotos", activo: "fotosActivo", modulo: fotos },
  { id: "streaming", etiqueta: "Streaming", larga: "Streaming", icono: "streaming", activo: "streamingActivo", modulo: streaming },
  { id: "hpc", etiqueta: "HPC", larga: "Cómputo HPC", icono: "hpc", activo: "hpcActivo", modulo: hpc },
];

export function pestanaDesdeUrl() {
  const id = location.hash.replace(/^#\/?/, "").split("/")[0];
  return PESTANAS.some((p) => p.id === id) ? id : "inicio";
}

export function montar(contenedor) {
  contenedor.innerHTML = `
    <div class="app">
      <nav class="riel" aria-label="Navegación principal">
        <div class="riel-marca">
          <span class="logo-circulo">${icono("nube")}</span>
          <span class="t-title-l">UPB-Científica</span>
        </div>
        <button type="button" class="boton-nuevo" data-nuevo-riel aria-haspopup="menu">${icono("nuevo")}Nuevo</button>
        ${PESTANAS.map((p) => `<a class="riel-item" href="#/${p.id}" data-pestana="${p.id}">${icono(p.icono)}<span>${esc(p.larga)}</span></a>`).join("")}
        <div class="riel-cuota" data-cuota></div>
      </nav>

      <div class="contenido"><div class="vista" data-vista></div></div>

      <nav class="barra-inferior" aria-label="Navegación principal">
        ${PESTANAS.map((p) => `<a href="#/${p.id}" data-pestana="${p.id}"><span class="indicador">${icono(p.icono)}</span><span class="etiqueta">${esc(p.etiqueta)}</span></a>`).join("")}
      </nav>
    </div>`;

  const vista = contenedor.querySelector("[data-vista]");
  let desmontarPantalla = null;
  let intencion = null;

  function mostrar() {
    const id = pestanaDesdeUrl();
    const pestana = PESTANAS.find((p) => p.id === id);

    contenedor.querySelectorAll("[data-pestana]").forEach((enlace) => {
      const activa = enlace.dataset.pestana === id;
      if (activa) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
      const def = PESTANAS.find((p) => p.id === enlace.dataset.pestana);
      const svg = enlace.querySelector(".ico");
      if (svg) svg.outerHTML = icono(activa ? def.activo : def.icono);
    });

    desmontarPantalla?.();
    vista.innerHTML = "";
    vista.scrollTop = 0;
    scrollTo(0, 0);
    document.title = `${pestana.larga} · UPB-Científica`;
    desmontarPantalla = pestana.modulo.montar(vista, { navegar, intencion });
    intencion = null;
  }

  function navegar(id, nuevaIntencion = null) {
    intencion = nuevaIntencion;
    if (pestanaDesdeUrl() === id && location.hash) mostrar();
    else location.hash = `#/${id}`;
  }

  // Botón "Nuevo" de la navegación lateral: lleva a Mis archivos con la acción elegida.
  const nuevo = contenedor.querySelector("[data-nuevo-riel]");
  nuevo.addEventListener("click", () =>
    abrirMenu(nuevo, [
      { texto: "Subir archivos", icono: "subir", accion: () => navegar("archivos", "subir") },
      { texto: "Nueva carpeta", icono: "nuevaCarpeta", accion: () => navegar("archivos", "carpeta") },
    ], { alinear: "izquierda" })
  );

  // Cuota en la navegación lateral (como el "Almacenamiento" de Drive).
  const cajaCuota = contenedor.querySelector("[data-cuota]");
  async function refrescarCuota() {
    try {
      const c = await almacenamiento.cuota();
      const fraccion = c.cuota ? c.usados / c.cuota : 0;
      cajaCuota.innerHTML = `
        <div class="t-label-l">Almacenamiento</div>
        ${barra(fraccion, { clase: "fina", color: fraccion > 0.9 ? "var(--error)" : null })}
        <div class="t-body-s atenuado">${esc(formatearTamano(c.usados))} de ${esc(formatearTamano(c.cuota))} usados</div>`;
    } catch {
      cajaCuota.innerHTML = "";
    }
  }
  refrescarCuota();
  addEventListener("upbc:cuota-cambio", refrescarCuota);

  addEventListener("hashchange", mostrar);
  if (!location.hash) history.replaceState(null, "", "#/inicio");
  mostrar();

  return () => {
    removeEventListener("hashchange", mostrar);
    removeEventListener("upbc:cuota-cambio", refrescarCuota);
    desmontarPantalla?.();
  };
}
