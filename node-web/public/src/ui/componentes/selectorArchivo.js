/*
 * Selector de archivos de Mis archivos, para elegir el código fuente y el
 * dataset de un trabajo HPC. El job-api exige que ambos estén ya subidos a
 * Storage: aquí se navega el repositorio y se elige uno.
 *
 * Devuelve { id, nombre, ruta } — ruta relativa al Home ("/Código MPI/trapecio.c").
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano } from "../formato.js";
import { iconoTipo, tipoArchivo, esqueleto, estadoVacio } from "./basicos.js";
import { abrirDialogo } from "./superpuestos.js";
import { almacenamiento } from "../../datos/almacenamiento.js";

export function elegirArchivo({ titulo }) {
  return new Promise((resolver) => {
    let ruta = [{ id: "root", nombre: "Mis archivos" }];
    let elegido = null;

    const d = abrirDialogo(`
      <h2 class="t-headline-s">${esc(titulo)}</h2>
      <nav class="migas" style="padding:0;margin:0 -8px" data-migas></nav>
      <div data-lista style="max-height:50vh;overflow:auto;margin:8px -24px 0;border-top:1px solid var(--outline-variant);border-bottom:1px solid var(--outline-variant)"></div>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-texto" data-cancelar>Cancelar</button>
        <button type="button" class="boton boton-relleno" data-ok disabled>Elegir</button>
      </div>`);
    const lista = d.querySelector("[data-lista]");
    const ok = d.querySelector("[data-ok]");

    async function cargar() {
      d.querySelector("[data-migas]").innerHTML = ruta
        .map((c, i) => `${i ? icono("chevron") : ""}<button type="button" data-nivel="${i}" ${i === ruta.length - 1 ? "disabled" : ""}>${esc(c.nombre)}</button>`)
        .join("");
      lista.innerHTML = esqueleto(4);
      elegido = null;
      ok.disabled = true;
      try {
        const elementos = await almacenamiento.listar(ruta.at(-1).id);
        elementos.sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre, "es") : a.tipo === "directorio" ? -1 : 1));
        lista.innerHTML = elementos.length
          ? `<ul class="lista">${elementos.map((a) => `
              <li class="fila" tabindex="0" data-id="${esc(a.id)}" style="min-height:56px">
                ${iconoTipo(tipoArchivo(a.nombre, a.tipo === "directorio"), 36)}
                <div class="texto"><div class="t-body-l">${esc(a.nombre)}</div>
                <div class="secundario t-body-s">${a.tipo === "directorio" ? "Carpeta" : esc(formatearTamano(a.tamanoBytes))}</div></div>
                ${a.tipo === "directorio" ? icono("chevron") : ""}
              </li>`).join("")}</ul>`
          : estadoVacio({ icono: "carpetaAbierta", titulo: "Carpeta vacía", mensaje: "Sube primero el archivo en Mis archivos." });
        lista.querySelectorAll("[data-id]").forEach((fila) => {
          const a = elementos.find((x) => x.id === fila.dataset.id);
          const activar = () => {
            if (a.tipo === "directorio") { ruta = [...ruta, { id: a.id, nombre: a.nombre }]; cargar(); return; }
            lista.querySelectorAll(".fila").forEach((f) => f.style.background = "");
            fila.style.background = "var(--secondary-container)";
            elegido = { id: a.id, nombre: a.nombre, ruta: `/${[...ruta.slice(1).map((c) => c.nombre), a.nombre].join("/")}` };
            ok.disabled = false;
          };
          fila.addEventListener("click", activar);
          fila.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activar(); } });
          fila.addEventListener("dblclick", () => { if (elegido) d.close("ok"); });
        });
      } catch (error) {
        lista.innerHTML = `<p class="t-body-m" style="padding:16px 24px;color:var(--error)">${esc(error.message)}</p>`;
      }
    }

    d.querySelector("[data-migas]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-nivel]");
      if (b && !b.disabled) { ruta = ruta.slice(0, Number(b.dataset.nivel) + 1); cargar(); }
    });
    d.querySelector("[data-cancelar]").addEventListener("click", () => d.close());
    ok.addEventListener("click", () => d.close("ok"));
    d.addEventListener("close", () => resolver(d.returnValue === "ok" ? elegido : null));
    cargar();
  });
}
