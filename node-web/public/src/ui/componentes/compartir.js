/*
 * Diálogo "Compartir" (compartir_dialog.py del escritorio).
 *
 * Sirve para archivos (CompartirArchivo) y carpetas (CompartirDirectorio: el
 * permiso vale también para lo que se meta dentro después). Los niveles son
 * los del contrato de Shared File; Storage los combina con los bits Unix del
 * archivo y prevalece el más permisivo.
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";
import { abrirDialogo, avisar } from "./superpuestos.js";
import { compartidos, compartidosSimulados, NIVELES } from "../../datos/compartidos.js";

export function abrirCompartir(archivo) {
  let destino = "usuario";
  let permiso = NIVELES[0].valor;
  const esCarpeta = archivo.tipo === "directorio";

  const d = abrirDialogo(`
    <form method="dialog" novalidate>
      <h2 class="t-headline-s">Compartir ${esCarpeta ? "la carpeta " : ""}“${esc(archivo.nombre)}”</h2>
      ${esCarpeta ? `<p class="t-body-m atenuado" style="margin:0 0 16px">También tendrá acceso a todo lo que haya o se añada dentro.</p>` : ""}
      ${compartidosSimulados() ? `<div class="aviso-info" style="margin:0 0 16px">${icono("info")}<span>Modo demostración: no se comparte nada de verdad.</span></div>` : ""}
      <div class="grupo">
        <p class="t-title-s" style="margin:0 0 8px">Compartir con</p>
        <div class="chips" data-destino>
          <button type="button" class="chip" data-v="usuario" aria-pressed="true">Un usuario</button>
          <button type="button" class="chip" data-v="grupo" aria-pressed="false">Un grupo</button>
        </div>
      </div>
      <label class="campo" style="margin-top:16px">
        <span class="campo-etiqueta" data-etiqueta-destino>Usuario</span>
        <span class="campo-caja">${icono("persona")}<input name="destinatario" placeholder="p. ej. investigador" autocomplete="off" autocapitalize="none" spellcheck="false" required></span>
      </label>
      <div class="grupo" style="margin-top:16px">
        <p class="t-title-s" style="margin:0 0 8px">Permiso</p>
        <div class="chips" data-permiso>
          ${NIVELES.map((p, i) => `<button type="button" class="chip" data-v="${p.valor}" aria-pressed="${i === 0}">${esc(p.texto)}</button>`).join("")}
        </div>
      </div>
      <div class="dialogo-acciones">
        <button type="button" class="boton boton-texto" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-relleno" data-ok disabled>Compartir</button>
      </div>
    </form>`);

  const campo = d.querySelector("input[name=destinatario]");
  const ok = d.querySelector("[data-ok]");
  campo.focus();
  campo.addEventListener("input", () => (ok.disabled = !campo.value.trim()));
  d.querySelector("[data-cancelar]").addEventListener("click", () => d.close());

  const elegir = (grupo, alElegir) =>
    d.querySelectorAll(`[data-${grupo}] .chip`).forEach((chip) =>
      chip.addEventListener("click", () => {
        d.querySelectorAll(`[data-${grupo}] .chip`).forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
        alElegir(chip.dataset.v);
      })
    );
  elegir("destino", (v) => {
    destino = v;
    d.querySelector("[data-etiqueta-destino]").textContent = v === "usuario" ? "Usuario" : "Grupo";
    campo.placeholder = v === "usuario" ? "p. ej. investigador" : "p. ej. investigadores";
  });
  elegir("permiso", (v) => (permiso = v));

  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    ok.disabled = true;
    ok.innerHTML = `<span class="rueda"></span>Compartiendo…`;
    const nombre = campo.value.trim();
    try {
      await compartidos.compartir(archivo, destino === "usuario" ? "USUARIO" : "GRUPO", nombre, permiso);
      d.close();
      avisar(`“${archivo.nombre}” compartido con ${destino === "grupo" ? "el grupo " : ""}${nombre}${compartidosSimulados() ? " (demostración)" : ""}`);
    } catch (error) {
      ok.disabled = false;
      ok.textContent = "Compartir";
      avisar(`No se pudo compartir: ${error.message}`);
    }
  });
}
