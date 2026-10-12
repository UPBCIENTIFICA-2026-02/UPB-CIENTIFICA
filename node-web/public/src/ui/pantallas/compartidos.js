/*
 * Compartidos (SharedFileScreen.kt), contra Shared File Service.
 *
 *   Conmigo       ListarCompartidosConmigo. Una carpeta se abre aquí mismo
 *                 (su contenido lo lista Storage, que ya aplica el permiso);
 *                 un archivo se descarga.
 *   Que comparto  ListarQueYoComparto. Cambiar el nivel
 *                 (ActualizarPermisosCompartidos) o dejar de compartir.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano, formatearFecha } from "../formato.js";
import {
  barraSuperior, conectarBusqueda, estadoVacio, estadoError, esqueleto, iconoTipo, tipoArchivo, avatar,
} from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirHoja, cuerpoDetalles, conectarHoja, avisar, confirmar } from "../componentes/superpuestos.js";
import { compartidos, compartidosSimulados, NIVELES, textoNivel } from "../../datos/compartidos.js";
import { almacenamiento } from "../../datos/almacenamiento.js";
import { esDemo } from "../../sesion/sesion.js";

const SECCIONES = { conmigo: "Conmigo", comparto: "Que comparto" };
const esDir = (r) => r.elementoTipo === "DIRECTORIO";
const destinatarioLegible = (r) => (r.destinatarioTipo === "GRUPO" ? `grupo ${r.destinatarioId}` : r.destinatarioId);

export function montar(contenedor) {
  let consulta = "";
  let seccion = "conmigo";
  let estado = { tipo: "cargando" };
  /** Carpetas compartidas abiertas: [{ id, nombre }]. Vacía = la lista. */
  let ruta = [];
  let vivo = true;

  contenedor.innerHTML = `
    <div data-cab>${barraSuperior({ placeholder: "Buscar en Compartidos", acciones: accionesCuenta() })}</div>
    <div class="fila-titulo">
      <h1 class="t-title-l">Compartidos</h1>
      <button type="button" class="boton-icono" data-actualizar aria-label="Actualizar" title="Actualizar">${icono("actualizar")}</button>
    </div>
    ${compartidosSimulados() && !esDemo() ? `<div class="aviso-info">${icono("info")}<span>Shared File está desactivado en la configuración (SHARED_FILE_DISPONIBLE): se muestran datos de ejemplo.</span></div>` : ""}
    <div class="albumes"><div class="chips" data-secciones></div></div>
    <nav class="migas" aria-label="Ubicación" data-migas hidden></nav>
    <div data-cuerpo></div>`;

  const $ = (sel) => contenedor.querySelector(sel);
  const cuerpo = $("[data-cuerpo]");
  conectarCuenta(contenedor);
  conectarBusqueda(contenedor, (v) => { consulta = v; pintar(); });

  // ------------------------------------------------------------ carga
  async function cargar() {
    estado = { tipo: "cargando" };
    pintar();
    try {
      let lista;
      if (ruta.length) lista = await almacenamiento.listar(ruta.at(-1).id);
      else lista = seccion === "conmigo" ? await compartidos.compartidosConmigo() : await compartidos.queYoComparto();
      if (vivo) estado = { tipo: "listo", lista };
    } catch (error) {
      if (vivo) estado = { tipo: "error", mensaje: error.message };
    }
    if (vivo) pintar();
  }

  // ------------------------------------------------------------ pintar
  function pintarCabecera() {
    $("[data-secciones]").innerHTML = Object.entries(SECCIONES)
      .map(([clave, texto]) => `<button type="button" class="chip" data-seccion="${clave}" aria-pressed="${clave === seccion && !ruta.length}">${esc(texto)}</button>`)
      .join("");
    const migas = $("[data-migas]");
    migas.hidden = !ruta.length;
    migas.innerHTML = ruta.length
      ? [`<button type="button" data-nivel="-1">Compartidos</button>`,
         ...ruta.map((c, i) => `${icono("chevron")}<button type="button" data-nivel="${i}" ${i === ruta.length - 1 ? 'disabled aria-current="location"' : ""}>${esc(c.nombre)}</button>`)].join("")
      : "";
  }

  function pintar() {
    pintarCabecera();
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(6); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", cargar);
      return;
    }
    const q = consulta.trim().toLowerCase();
    if (ruta.length) return pintarCarpeta(q);

    const visibles = estado.lista.filter((r) =>
      [r.nombre, r.propietario, r.destinatarioId].some((t) => (t || "").toLowerCase().includes(q)));
    if (!estado.lista.length) {
      cuerpo.innerHTML = seccion === "conmigo"
        ? estadoVacio({ icono: "compartidos", titulo: "Nada compartido contigo", mensaje: "Cuando alguien comparta un archivo o carpeta contigo, aparecerá aquí." })
        : estadoVacio({ icono: "compartir", titulo: "No compartes nada", mensaje: "Comparte desde Mis archivos con la opción Compartir de cada archivo o carpeta." });
      return;
    }
    if (!visibles.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "sinResultados", titulo: "Sin resultados", mensaje: `Nada coincide con "${consulta.trim()}".` });
      return;
    }
    cuerpo.innerHTML = `<ul class="lista">${visibles.map((r) => {
      const persona = seccion === "conmigo" ? r.propietario : r.destinatarioId;
      return `
      <li class="fila" tabindex="0" data-id="${esc(r.compartidoId)}">
        ${iconoTipo(tipoArchivo(r.nombre, esDir(r)))}
        <div class="texto">
          <div class="t-body-l">${esc(r.nombre)}</div>
          <div class="secundario">${avatar(persona, 18)}<span class="una-linea">${esc(seccion === "conmigo" ? persona : `con ${destinatarioLegible(r)}`)}</span></div>
        </div>
        <span class="pastilla cuadrada permiso">${esc(textoNivel(r.nivelPermiso))}</span>
      </li>`;
    }).join("")}</ul>`;
  }

  function pintarCarpeta(q) {
    const visibles = estado.lista
      .filter((a) => a.nombre.toLowerCase().includes(q))
      .sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre) : a.tipo === "directorio" ? -1 : 1));
    if (!visibles.length) {
      cuerpo.innerHTML = estadoVacio({
        icono: "carpetaAbierta",
        titulo: estado.lista.length ? "Sin resultados" : "Esta carpeta está vacía",
        mensaje: estado.lista.length ? `Nada coincide con "${consulta.trim()}".` : "Todavía no hay nada aquí.",
      });
      return;
    }
    cuerpo.innerHTML = `<ul class="lista">${visibles.map((a) => `
      <li class="fila" tabindex="0" data-elemento="${esc(a.id)}">
        ${iconoTipo(tipoArchivo(a.nombre, a.tipo === "directorio"))}
        <div class="texto">
          <div class="t-body-l">${esc(a.nombre)}</div>
          <div class="secundario t-body-m">${a.tipo === "directorio" ? "Carpeta" : esc(formatearTamano(a.tamanoBytes))}</div>
        </div>
      </li>`).join("")}</ul>`;
  }

  // ------------------------------------------------------------ acciones
  function abrirCarpeta(id, nombre) {
    ruta = [...ruta, { id, nombre }];
    consulta = "";
    cargar();
  }

  async function descargar(id, nombre) {
    if (esDemo()) { avisar("Modo demostración: no hay un archivo real que descargar."); return; }
    avisar(`Descargando “${nombre}”…`);
    try { await almacenamiento.descargar({ id, nombre }); }
    catch (error) { avisar(`No se pudo descargar: ${error.message}`); }
  }

  function detallesConmigo(r) {
    const acciones = esDir(r)
      ? [{ texto: "Abrir", icono: "carpetaAbierta", clase: "boton-relleno", accion: (h) => { h.close(); abrirCarpeta(r.elementoId, r.nombre); } }]
      : [{ texto: "Descargar", icono: "descargar", clase: "boton-relleno", accion: () => descargar(r.elementoId, r.nombre) }];
    const hoja = abrirHoja(cuerpoDetalles({
      iconoHtml: iconoTipo(tipoArchivo(r.nombre, esDir(r)), 48),
      titulo: r.nombre,
      subtitulo: esDir(r) ? "Carpeta compartida" : tipoArchivo(r.nombre).etiqueta,
      filas: [
        ["Propietario", r.propietario],
        ["Compartido por", r.compartidoPor],
        ["Tu acceso", textoNivel(r.nivelPermiso)],
        ...(r.fechaExpiracion ? [["Caduca", formatearFecha(r.fechaExpiracion)]] : []),
        ...(esDir(r) ? [] : [["Tamaño", formatearTamano(r.tamanoBytes)]]),
      ],
      acciones,
    }));
    conectarHoja(hoja, acciones);
  }

  function detallesComparto(r) {
    let nivel = r.nivelPermiso;
    const acciones = [
      {
        texto: "Guardar permiso", icono: "check", clase: "boton-relleno",
        accion: async (h) => {
          if (nivel === r.nivelPermiso) { h.close(); return; }
          try {
            const res = await compartidos.cambiarNivel(r.compartidoId, nivel);
            h.close();
            avisar(res?.advertencia?.mensaje || `${destinatarioLegible(r)} ahora puede: ${textoNivel(nivel).toLowerCase()}`, res?.advertencia ? 8000 : 4000);
            cargar();
          } catch (error) { avisar(`No se pudo cambiar el permiso: ${error.message}`); }
        },
      },
      {
        texto: "Dejar de compartir", icono: "eliminar", peligro: true,
        accion: async (h) => {
          const si = await confirmar({
            titulo: "¿Dejar de compartir?",
            mensaje: `${destinatarioLegible(r)} perderá el acceso a “${r.nombre}” de inmediato.`,
            aceptar: "Dejar de compartir", peligro: true,
          });
          if (!si) return;
          try {
            await compartidos.revocar(r.compartidoId);
            h.close();
            avisar(`${destinatarioLegible(r)} ya no tiene acceso a “${r.nombre}”`);
            cargar();
          } catch (error) { avisar(`No se pudo dejar de compartir: ${error.message}`); }
        },
      },
    ];
    const hoja = abrirHoja(cuerpoDetalles({
      iconoHtml: iconoTipo(tipoArchivo(r.nombre, esDir(r)), 48),
      titulo: r.nombre,
      subtitulo: `Compartido con ${destinatarioLegible(r)}`,
      filas: [
        ["Permiso actual", textoNivel(r.nivelPermiso)],
        ["Desde", formatearFecha(r.fechaCompartido)],
        ...(r.fechaExpiracion ? [["Caduca", formatearFecha(r.fechaExpiracion)]] : []),
      ],
      acciones,
    }));
    // Selector de nivel encima de los botones.
    const zona = hoja.querySelector(".hoja-acciones");
    const selector = document.createElement("div");
    selector.className = "chips";
    selector.style.margin = "8px 0 16px";
    selector.innerHTML = NIVELES.map((n) => `<button type="button" class="chip" data-v="${n.valor}" aria-pressed="${n.valor === nivel}">${esc(n.texto)}</button>`).join("");
    selector.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-v]");
      if (!chip) return;
      nivel = chip.dataset.v;
      selector.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    });
    zona.parentNode.insertBefore(selector, zona);
    conectarHoja(hoja, acciones);
  }

  // ------------------------------------------------------------ eventos
  function activar(fila) {
    if (fila.dataset.elemento) {
      const a = estado.lista.find((x) => x.id === fila.dataset.elemento);
      if (!a) return;
      if (a.tipo === "directorio") abrirCarpeta(a.id, a.nombre);
      else descargar(a.id, a.nombre);
      return;
    }
    const r = estado.lista?.find((x) => x.compartidoId === fila.dataset.id);
    if (!r) return;
    if (seccion === "conmigo") {
      if (esDir(r)) abrirCarpeta(r.elementoId, r.nombre);
      else detallesConmigo(r);
    } else detallesComparto(r);
  }

  cuerpo.addEventListener("click", (e) => { const f = e.target.closest(".fila"); if (f) activar(f); });
  cuerpo.addEventListener("keydown", (e) => {
    const f = e.target.closest(".fila");
    if (f && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); activar(f); }
  });
  $("[data-secciones]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seccion]");
    if (!b) return;
    seccion = b.dataset.seccion;
    ruta = [];
    cargar();
  });
  $("[data-migas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nivel]");
    if (!b || b.disabled) return;
    const i = Number(b.dataset.nivel);
    ruta = i < 0 ? [] : ruta.slice(0, i + 1);
    cargar();
  });
  $("[data-actualizar]").addEventListener("click", cargar);

  cargar();
  return () => { vivo = false; };
}
