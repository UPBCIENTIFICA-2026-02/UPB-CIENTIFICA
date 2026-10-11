/*
 * Diálogo "Compartir" (compartir_dialog.py del escritorio). El enunciado pide
 * compartir "respetando el código Unix de permisos", así que se elige el
 * permiso como en Unix y se traduce a palabras para quien no lo conoce.
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";
import { abrirDialogo, avisar } from "./superpuestos.js";
import { compartidos, compartidosSimulados } from "../../datos/compartidos.js";

const PERMISOS = [
  { valor: "r--", texto: "Solo lectura" },
  { valor: "rw-", texto: "Puede editar" },
];

export function abrirCompartir(archivo) {
  let destino = "usuario";
  let permiso = "r--";

  const d = abrirDialogo(`
    <form method="dialog" novalidate>
      <h2 class="t-headline-s">Compartir “${esc(archivo.nombre)}”</h2>
      ${compartidosSimulados() ? `<div class="aviso-info" style="margin:0 0 16px">${icono("info")}<span>El servicio Shared File aún no existe en el servidor: el envío es simulado.</span></div>` : ""}
      <div class="grupo">
        <p class="t-title-s" style="margin:0 0 8px">Compartir con</p>
        <div class="chips" data-destino>
          <button type="button" class="chip" data-v="usuario" aria-pressed="true">Un usuario</button>
          <button type="button" class="chip" data-v="grupo" aria-pressed="false">Un grupo</button>
        </div>
      </div>
      <label class="campo" style="margin-top:16px">
        <span class="campo-etiqueta" data-etiqueta-destino>Usuario</span>
        <span class="campo-caja">${icono("persona")}<input name="destinatario" placeholder="p. ej. maria.lopez" autocomplete="off" autocapitalize="none" spellcheck="false" required></span>
      </label>
      <div class="grupo" style="margin-top:16px">
        <p class="t-title-s" style="margin:0 0 8px">Permiso</p>
        <div class="chips" data-permiso>
          ${PERMISOS.map((p, i) => `<button type="button" class="chip" data-v="${p.valor}" aria-pressed="${i === 0}">${esc(p.texto)} <span class="mono atenuado">${p.valor}</span></button>`).join("")}
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
    campo.placeholder = v === "usuario" ? "p. ej. maria.lopez" : "p. ej. investigadores";
  });
  elegir("permiso", (v) => (permiso = v));

  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    ok.disabled = true;
    ok.innerHTML = `<span class="rueda"></span>Compartiendo…`;
    const nombre = campo.value.trim();
    try {
      await compartidos.compartir({
        archivoId: archivo.id,
        destinatarioUsuarioId: destino === "usuario" ? nombre : null,
        destinatarioGrupoId: destino === "grupo" ? nombre : null,
        permisoUnix: permiso,
      });
      d.close();
      avisar(`“${archivo.nombre}” compartido con ${nombre}${compartidosSimulados() ? " (simulado)" : ""}`);
    } catch (error) {
      ok.disabled = false;
      ok.textContent = "Compartir";
      avisar(`No se pudo compartir: ${error.message}`);
    }
  });
}
