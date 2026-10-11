/*
 * Cómputo HPC (HpcScreen.kt): tarjeta del clúster, filtros, trabajos con su
 * estado y el formulario "Nuevo trabajo".
 *
 * Se consulta cada pocos segundos SOLO mientras la pestaña está a la vista
 * (como el LaunchedEffect del móvil), y se pausa si la ventana se oculta.
 *
 * El formulario sigue el contrato REAL de job-api, no el del móvil: ya no se
 * envía un comando de shell, sino el código fuente y el dataset (ya subidos a
 * Storage) y cuántos procesos MPI usar. El servidor arma el mpirun.
 */

import { icono } from "../iconos.js";
import { esc, formatearHace, formatearFecha, idCorto } from "../formato.js";
import { barraSuperior, conectarBusqueda, estadoVacio, estadoError, esqueleto, barra } from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirHoja, cuerpoDetalles, conectarHoja, confirmar, avisar } from "../componentes/superpuestos.js";
import { elegirArchivo } from "../componentes/selectorArchivo.js";
import { config } from "../../config.js";
import { hpc, ESTADOS } from "../../datos/hpc.js";

const FILTROS = { TODOS: "Todos", ACTIVOS: "Activos", FINALIZADOS: "Finalizados" };
const PRIORIDADES = [
  { valor: 2, texto: "Baja" },
  { valor: 5, texto: "Normal" },
  { valor: 8, texto: "Alta" },
  { valor: 10, texto: "Urgente" },
];
const textoPrioridad = (p) => PRIORIDADES.reduce((a, b) => (Math.abs(b.valor - p) < Math.abs(a.valor - p) ? b : a)).texto.toLowerCase();
const aspecto = (estado) => ESTADOS[estado] ?? { etiqueta: estado, icono: "info", color: "var(--on-surface-variant)", activo: false };

let filtro = "TODOS";

export function montar(contenedor) {
  let consulta = "";
  let estado = { tipo: "cargando" };
  let vivo = true;
  let temporizador = null;
  let hojaDetalle = null;

  contenedor.innerHTML = `
    <div data-cab>${barraSuperior({ placeholder: "Buscar trabajos", acciones: accionesCuenta() })}</div>
    <div class="lista-hpc" data-cuerpo></div>
    <button type="button" class="fab" data-nuevo>${icono("mas")}Nuevo trabajo</button>`;

  const cuerpo = contenedor.querySelector("[data-cuerpo]");
  conectarCuenta(contenedor);
  conectarBusqueda(contenedor, (v) => { consulta = v; pintar(); });

  // ------------------------------------------------------------- consulta
  async function actualizar() {
    try {
      const [trabajos, cluster] = await Promise.all([
        hpc.trabajos(),
        hpc.estadoCluster().catch(() => null),
      ]);
      if (!vivo) return;
      estado = { tipo: "listo", trabajos: trabajos ?? [], cluster };
    } catch (error) {
      if (!vivo) return;
      // Si ya había datos, un fallo puntual no borra la pantalla.
      if (estado.tipo !== "listo") estado = { tipo: "error", mensaje: error.message };
    }
    pintar();
    refrescarDetalle();
  }

  function programar() {
    clearTimeout(temporizador);
    if (!vivo || document.hidden) return;
    temporizador = setTimeout(async () => { await actualizar(); programar(); }, config.INTERVALO_HPC_MS);
  }
  const alCambiarVisibilidad = () => { if (!document.hidden) { actualizar(); programar(); } else clearTimeout(temporizador); };
  document.addEventListener("visibilitychange", alCambiarVisibilidad);

  // ---------------------------------------------------------------- pintar
  function tarjetaCluster(c) {
    if (!c) {
      return `<section class="tarjeta-cluster"><div class="cab">
        <span class="burbuja-icono" style="background:var(--primary-container);color:var(--on-primary-container)">${icono("hpc")}</span>
        <div class="texto"><div class="t-title-m">Clúster UPB</div><div class="t-body-s atenuado">No se pudo consultar el estado del clúster</div></div>
      </div></section>`;
    }
    const vivos = c.nodosVivos?.length ?? 0;
    const esperados = c.nodosEsperados ?? 0;
    const estadoCluster = vivos === 0
      ? { texto: "Sin nodos", color: "var(--error)" }
      : vivos >= esperados ? { texto: "En línea", color: "var(--exito)" } : { texto: "Parcial", color: "var(--tertiary)" };
    // cargaPromedio llega como fracción (0..1); si algún día llega como load
    // average (>1), se muestra recortada al 100 %.
    const carga = Math.max(0, Math.min(1, Number(c.cargaPromedio) || 0));
    const trabajos = estado.trabajos ?? [];
    return `
      <section class="tarjeta-cluster" aria-label="Estado del clúster">
        <div class="cab">
          <span class="burbuja-icono" style="background:var(--primary-container);color:var(--on-primary-container)">${icono("hpc")}</span>
          <div class="texto">
            <div class="t-title-m">Clúster UPB</div>
            <div class="t-body-s atenuado">${vivos} de ${esperados} nodos en línea</div>
          </div>
          <span class="en-linea" style="color:${estadoCluster.color}"><span class="punto"></span>${estadoCluster.texto}</span>
        </div>
        <div class="medidor">
          <div class="fila-medidor"><span class="t-label-l">Carga promedio</span><span class="t-label-l atenuado">${Math.round(carga * 100)} %</span></div>
          ${barra(carga)}
        </div>
        <div class="cifras">
          <div><p class="t-title-l">${vivos}/${esperados}</p><p class="t-body-s atenuado">Nodos en línea</p></div>
          <div><p class="t-title-l">${trabajos.filter((t) => t.estado === "QUEUED").length}</p><p class="t-body-s atenuado">En cola</p></div>
          <div><p class="t-title-l">${trabajos.filter((t) => t.estado === "RUNNING").length}</p><p class="t-body-s atenuado">Ejecutando</p></div>
        </div>
      </section>`;
  }

  function tarjetaTrabajo(t) {
    const a = aspecto(t.estado);
    let progreso = "";
    if (t.estado === "RUNNING") {
      // El contrato real no informa avance: barra indeterminada. En demo sí hay.
      progreso = t._progreso != null
        ? `<div style="display:flex;align-items:center;gap:12px">${barra(t._progreso, { clase: "fina" }).replace('class="barra', 'style="flex:1" class="barra')}<span class="t-label-m atenuado">${Math.round(t._progreso * 100)} %</span></div>`
        : barra(null, { clase: "fina" });
    } else if (t.estado === "QUEUED") {
      progreso = barra(null, { clase: "fina", color: a.color });
    }
    return `
      <button type="button" class="tarjeta-trabajo" data-id="${esc(t.id)}">
        <div class="cab">
          <span class="icono-tipo" style="width:40px;height:40px;background:color-mix(in srgb, ${a.color} 14%, transparent);color:${a.color}">${icono(a.icono)}</span>
          <div class="texto">
            <div class="t-title-s una-linea">${esc(t.nombre)}</div>
            <div class="t-body-s atenuado">#${esc(idCorto(t.id))} · ${esc(formatearHace(t.fechaCreacion))}</div>
          </div>
          <span class="pastilla" style="background:color-mix(in srgb, ${a.color} 14%, transparent);color:${a.color}">${esc(a.etiqueta)}</span>
        </div>
        ${progreso}
        <div class="detalle">
          <p class="t-body-s atenuado mono una-linea">${esc(t.rutaCodigoFuente)}</p>
          <p class="t-body-s atenuado">${esc(t.numeroProcesos)} procesos MPI · prioridad ${esc(textoPrioridad(t.prioridad))}</p>
        </div>
      </button>`;
  }

  function pintar() {
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(6); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", () => { estado = { tipo: "cargando" }; pintar(); actualizar(); });
      return;
    }
    const pasaFiltro = (t, f) => f === "TODOS" || (f === "ACTIVOS" ? aspecto(t.estado).activo : !aspecto(t.estado).activo);
    const q = consulta.trim().toLowerCase();
    const visibles = estado.trabajos
      .filter((t) => pasaFiltro(t, filtro))
      .filter((t) => t.nombre.toLowerCase().includes(q) || String(t.id).toLowerCase().includes(q))
      .sort((a, b) => String(b.fechaCreacion).localeCompare(String(a.fechaCreacion)));

    cuerpo.innerHTML = `
      ${tarjetaCluster(estado.cluster)}
      <div class="chips desplazable" role="group" aria-label="Filtrar trabajos">
        ${Object.entries(FILTROS).map(([clave, texto]) =>
          `<button type="button" class="chip" data-filtro="${clave}" aria-pressed="${clave === filtro}">${texto} · ${estado.trabajos.filter((t) => pasaFiltro(t, clave)).length}</button>`).join("")}
      </div>
      ${visibles.length
        ? visibles.map(tarjetaTrabajo).join("")
        : estadoVacio(q
          ? { icono: "sinResultados", titulo: "Sin resultados", mensaje: `Ningún trabajo coincide con "${consulta.trim()}".` }
          : { icono: "servidor", titulo: "No hay trabajos aquí", mensaje: "Envía un trabajo al clúster con “Nuevo trabajo”." })}`;
  }

  // ---------------------------------------------------------------- detalle
  function contenidoDetalle(t) {
    const a = aspecto(t.estado);
    const filas = [
      ["Estado", t._progreso != null && t.estado === "RUNNING" ? `${a.etiqueta} · ${Math.round(t._progreso * 100)} %` : a.etiqueta],
      ["Código fuente", t.rutaCodigoFuente, true],
      ["Dataset", t.rutaDataset, true],
      ["Recursos", `${t.numeroProcesos} procesos MPI · prioridad ${textoPrioridad(t.prioridad)} (${t.prioridad})`],
      ["Enviado", `${formatearFecha(t.fechaCreacion)} (${formatearHace(t.fechaCreacion)})`],
    ];
    if (t.fechaInicio) filas.push(["Inicio", formatearFecha(t.fechaInicio)]);
    if (t.fechaFin) filas.push(["Fin", formatearFecha(t.fechaFin)]);
    if (t.resultadoResumen) filas.push(["Resultado", t.resultadoResumen]);
    if (t.rutaResultados) filas.push(["Resultados en", t.rutaResultados, true]);
    if (t.mensajeError) filas.push(["Error", t.mensajeError]);
    filas.push(["Identificador", `#${t.id}`, true]);
    const acciones = a.activo ? [{ texto: "Cancelar trabajo", icono: "detener", peligro: true, accion: () => cancelar(t) }] : [];
    return {
      html: cuerpoDetalles({
        iconoHtml: `<span class="icono-tipo" style="width:48px;height:48px;background:color-mix(in srgb, ${a.color} 14%, transparent);color:${a.color}">${icono(a.icono)}</span>`,
        titulo: t.nombre,
        subtitulo: a.etiqueta,
        filas,
        acciones,
      }),
      acciones,
    };
  }

  function mostrarDetalle(t) {
    const { html, acciones } = contenidoDetalle(t);
    hojaDetalle = abrirHoja(html);
    hojaDetalle.dataset.id = t.id;
    conectarHoja(hojaDetalle, acciones);
    hojaDetalle.addEventListener("close", () => { hojaDetalle = null; });
  }

  /** Con la hoja abierta, el detalle sigue el estado más reciente. */
  function refrescarDetalle() {
    if (!hojaDetalle || estado.tipo !== "listo") return;
    const t = estado.trabajos.find((x) => x.id === hojaDetalle.dataset.id);
    if (!t) return;
    const { html, acciones } = contenidoDetalle(t);
    hojaDetalle.querySelector(".hoja-cuerpo").innerHTML = html;
    conectarHoja(hojaDetalle, acciones);
  }

  async function cancelar(t) {
    const si = await confirmar({
      titulo: "¿Cancelar el trabajo?",
      mensaje: `“${t.nombre}” se detendrá en el clúster. Los resultados parciales pueden perderse.`,
      aceptar: "Cancelar trabajo",
      cancelar: "Volver",
      peligro: true,
    });
    if (!si) return;
    try {
      await hpc.cancelar(t.id);
      avisar("Trabajo cancelado");
      actualizar();
    } catch (error) {
      avisar(`No se pudo cancelar: ${error.message}`);
    }
  }

  // ---------------------------------------------------------- nuevo trabajo
  function abrirNuevoTrabajo() {
    const valores = { nombre: "", fuente: null, dataset: null, procesos: 4, prioridad: 5 };
    let enviando = false;

    const hoja = abrirHoja(`
      <form class="hoja-form" novalidate>
        <div class="cabecera-hoja">
          <div class="texto"><h2 class="t-title-l" style="margin:0">Nuevo trabajo</h2>
          <p class="t-body-m atenuado" style="margin:0">Se enviará a la cola del clúster UPB</p></div>
          <button type="button" class="boton-icono" data-cerrar-hoja aria-label="Cerrar">${icono("cerrar")}</button>
        </div>

        <label class="campo" style="margin-top:20px">
          <span class="campo-etiqueta">Nombre del trabajo</span>
          <span class="campo-caja"><input name="nombre" placeholder="Simulación de fluidos" maxlength="120" autocomplete="off" required></span>
        </label>

        ${["fuente", "dataset"].map((campo) => `
          <div class="campo" style="margin-top:12px">
            <span class="campo-etiqueta">${campo === "fuente" ? "Código fuente" : "Dataset"}</span>
            <div class="selector-archivo">
              <span class="campo-caja mono"><input data-ruta="${campo}" placeholder="${campo === "fuente" ? "Elige un .c ya subido" : "Elige los datos de entrada"}" readonly></span>
              <button type="button" class="boton boton-tonal" data-elegir="${campo}">Elegir</button>
            </div>
          </div>`).join("")}
        <span class="campo-ayuda">Ambos deben estar en Mis archivos. El servidor arma la ejecución de mpirun; no se envían comandos.</span>

        <div class="fila-contador">
          <span class="t-title-s">Procesos MPI</span>
          <div class="contador">
            <button type="button" class="boton-icono tonal" data-menos aria-label="Menos procesos">${icono("menos")}</button>
            <output data-procesos>${valores.procesos}</output>
            <button type="button" class="boton-icono tonal" data-mas aria-label="Más procesos">${icono("mas")}</button>
          </div>
        </div>

        <div class="grupo">
          <p class="t-title-s">Prioridad</p>
          <div class="chips" data-prioridades>
            ${PRIORIDADES.map((p) => `<button type="button" class="chip" data-v="${p.valor}" aria-pressed="${p.valor === valores.prioridad}">${p.texto}</button>`).join("")}
          </div>
        </div>

        <div class="resumen-recursos t-body-m" data-resumen></div>

        <button type="submit" class="boton boton-relleno boton-grande" style="margin-top:24px" data-enviar disabled>Enviar al clúster</button>
      </form>`, { etiqueta: "Nuevo trabajo" });

    const form = hoja.querySelector("form");
    const enviar = hoja.querySelector("[data-enviar]");
    const valido = () => valores.nombre.trim() && valores.fuente && valores.dataset;
    const repintar = () => {
      hoja.querySelector("[data-procesos]").textContent = valores.procesos;
      hoja.querySelector("[data-menos]").disabled = enviando || valores.procesos <= 1;
      hoja.querySelector("[data-mas]").disabled = enviando || valores.procesos >= 64;
      hoja.querySelector("[data-resumen]").textContent = `Total: ${valores.procesos} procesos MPI · prioridad ${textoPrioridad(valores.prioridad)}`;
      enviar.disabled = enviando || !valido();
    };

    hoja.querySelector("[data-cerrar-hoja]").addEventListener("click", () => { if (!enviando) hoja.close(); });
    hoja.addEventListener("cancel", (e) => { if (enviando) e.preventDefault(); });
    form.elements.nombre.addEventListener("input", (e) => { valores.nombre = e.target.value; repintar(); });
    form.elements.nombre.focus();
    hoja.querySelector("[data-menos]").addEventListener("click", () => { valores.procesos = Math.max(1, valores.procesos - 1); repintar(); });
    hoja.querySelector("[data-mas]").addEventListener("click", () => { valores.procesos = Math.min(64, valores.procesos + 1); repintar(); });
    hoja.querySelectorAll("[data-prioridades] .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        valores.prioridad = Number(chip.dataset.v);
        hoja.querySelectorAll("[data-prioridades] .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
        repintar();
      })
    );
    hoja.querySelectorAll("[data-elegir]").forEach((boton) =>
      boton.addEventListener("click", async () => {
        const campo = boton.dataset.elegir;
        const archivo = await elegirArchivo({ titulo: campo === "fuente" ? "Elegir código fuente" : "Elegir dataset" });
        if (!archivo) return;
        valores[campo] = archivo;
        hoja.querySelector(`[data-ruta="${campo}"]`).value = archivo.ruta;
        repintar();
      })
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!valido() || enviando) return;
      enviando = true;
      enviar.innerHTML = `<span class="rueda"></span>Enviando…`;
      repintar();
      try {
        const r = await hpc.enviar({
          nombre: valores.nombre.trim(),
          rutaCodigoFuente: valores.fuente.ruta,
          rutaDataset: valores.dataset.ruta,
          numeroProcesos: valores.procesos,
          prioridad: valores.prioridad,
        });
        enviando = false;
        hoja.close();
        avisar(`Trabajo #${idCorto(r?.id)} enviado al clúster`);
        actualizar();
      } catch (error) {
        enviando = false;
        enviar.textContent = "Enviar al clúster";
        repintar();
        avisar(`No se pudo enviar: ${error.message}`);
      }
    });
    repintar();
  }

  // --------------------------------------------------------------- eventos
  cuerpo.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filtro]");
    if (chip) { filtro = chip.dataset.filtro; pintar(); return; }
    const tarjeta = e.target.closest("[data-id]");
    if (tarjeta) mostrarDetalle(estado.trabajos.find((t) => t.id === tarjeta.dataset.id));
  });
  contenedor.querySelector("[data-nuevo]").addEventListener("click", abrirNuevoTrabajo);

  pintar();
  actualizar().then(programar);

  return () => {
    vivo = false;
    clearTimeout(temporizador);
    document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  };
}
