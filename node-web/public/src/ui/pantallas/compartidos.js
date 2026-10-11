/*
 * Compartidos conmigo (SharedFileScreen.kt).
 *
 * El permiso Unix se traduce a algo que entienda cualquiera ("rw-" ->
 * "Puede editar"), pero la hoja de detalles muestra también el original.
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";
import {
  barraSuperior, conectarBusqueda, estadoVacio, estadoError, esqueleto, iconoTipo, tipoArchivo, avatar,
} from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirHoja, cuerpoDetalles, conectarHoja, avisar } from "../componentes/superpuestos.js";
import { compartidos, compartidosSimulados } from "../../datos/compartidos.js";
import { almacenamiento } from "../../datos/almacenamiento.js";
import { esDemo } from "../../sesion/sesion.js";

/** "rw-" -> "Puede editar" (describirPermiso de SharedFileScreen.kt). */
function describirPermiso(permisoUnix = "") {
  if (permisoUnix.includes("w")) return "Puede editar";
  if (permisoUnix.includes("r")) return "Solo lectura";
  if (permisoUnix.includes("x")) return "Solo ejecución";
  return "Sin acceso";
}

export function montar(contenedor) {
  let consulta = "";
  let estado = { tipo: "cargando" };
  let vivo = true;

  contenedor.innerHTML = `
    <div data-cab>${barraSuperior({ placeholder: "Buscar en Compartidos", acciones: accionesCuenta() })}</div>
    <div class="fila-titulo">
      <h1 class="t-title-l">Compartidos conmigo</h1>
      <button type="button" class="boton-icono" data-actualizar aria-label="Actualizar" title="Actualizar">${icono("actualizar")}</button>
    </div>
    ${compartidosSimulados() && !esDemo() ? `<div class="aviso-info">${icono("info")}<span>Datos de ejemplo: el servicio Shared File todavía no existe en el servidor. Cuando exista, esta lista será la real.</span></div>` : ""}
    <div data-cuerpo></div>`;

  const cuerpo = contenedor.querySelector("[data-cuerpo]");
  conectarCuenta(contenedor);
  conectarBusqueda(contenedor, (v) => { consulta = v; pintar(); });

  async function cargar() {
    estado = { tipo: "cargando" };
    pintar();
    try {
      const lista = await compartidos.compartidosConmigo();
      if (vivo) estado = { tipo: "listo", lista };
    } catch (error) {
      if (vivo) estado = { tipo: "error", mensaje: error.message };
    }
    if (vivo) pintar();
  }

  function pintar() {
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(6); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", cargar);
      return;
    }
    const q = consulta.trim().toLowerCase();
    const visibles = estado.lista.filter((r) => r.nombreArchivo.toLowerCase().includes(q) || r.propietario.toLowerCase().includes(q));
    if (!estado.lista.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "compartidos", titulo: "Nada compartido todavía", mensaje: "Cuando alguien comparta un archivo o carpeta contigo, aparecerá aquí." });
      return;
    }
    if (!visibles.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "sinResultados", titulo: "Sin resultados", mensaje: `Nada coincide con "${consulta.trim()}" en el nombre ni en el propietario.` });
      return;
    }
    cuerpo.innerHTML = `<ul class="lista">${visibles.map((r) => `
      <li class="fila" tabindex="0" data-id="${esc(r.compartidoId)}">
        ${iconoTipo(tipoArchivo(r.nombreArchivo))}
        <div class="texto">
          <div class="t-body-l">${esc(r.nombreArchivo)}</div>
          <div class="secundario">${avatar(r.propietario, 18)}<span class="una-linea">${esc(r.propietario)}</span></div>
        </div>
        <span class="pastilla cuadrada permiso">${esc(describirPermiso(r.permisoUnix))}</span>
      </li>`).join("")}</ul>`;
  }

  function detalles(r) {
    const acciones = [{
      texto: "Descargar", icono: "descargar", clase: "boton-relleno",
      accion: async () => {
        if (compartidosSimulados() && !esDemo()) { avisar("Este registro es de ejemplo: no hay un archivo real que descargar."); return; }
        try { await almacenamiento.descargar({ id: r.archivoId, nombre: r.nombreArchivo }); }
        catch (error) { avisar(`No se pudo descargar: ${error.message}`); }
      },
    }];
    const hoja = abrirHoja(cuerpoDetalles({
      iconoHtml: iconoTipo(tipoArchivo(r.nombreArchivo), 48),
      titulo: r.nombreArchivo,
      subtitulo: tipoArchivo(r.nombreArchivo).etiqueta,
      filas: [
        ["Propietario", r.propietario],
        ["Tu acceso", `${describirPermiso(r.permisoUnix)} (${r.permisoUnix})`],
        ["Identificador", r.archivoId, true],
      ],
      acciones,
    }));
    conectarHoja(hoja, acciones);
  }

  const porId = (id) => estado.lista?.find((r) => r.compartidoId === id);
  cuerpo.addEventListener("click", (e) => { const f = e.target.closest("[data-id]"); if (f) detalles(porId(f.dataset.id)); });
  cuerpo.addEventListener("keydown", (e) => {
    const f = e.target.closest(".fila[data-id]");
    if (f && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); detalles(porId(f.dataset.id)); }
  });
  contenedor.querySelector("[data-actualizar]").addEventListener("click", cargar);

  cargar();
  return () => { vivo = false; };
}
