/*
 * Mis archivos (StorageScreen.kt): buscador, migas de pan, orden, lista o
 * cuadrícula, y la hoja de detalles. Además de lo que hace el móvil, aquí se
 * sube (botón o arrastrando archivos), se crea carpeta, se descarga, se
 * comparte y se elimina: todo contra node-repository.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano } from "../formato.js";
import {
  barraSuperior, conectarBusqueda, encabezadoSeccion, estadoVacio, estadoError,
  esqueleto, iconoTipo, tipoArchivo, barra,
} from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import {
  abrirMenu, abrirHoja, cuerpoDetalles, conectarHoja, confirmar, pedirTexto, avisar,
} from "../componentes/superpuestos.js";
import { abrirCompartir } from "../componentes/compartir.js";
import { almacenamiento } from "../../datos/almacenamiento.js";

const ORDENES = {
  NOMBRE_ASC: "Nombre (A-Z)",
  NOMBRE_DESC: "Nombre (Z-A)",
  TAMANO_DESC: "Tamaño (mayor primero)",
  TAMANO_ASC: "Tamaño (menor primero)",
};

// Se conservan al cambiar de pestaña, como rememberSaveable en el móvil.
let ruta = [{ id: "root", nombre: "Mis archivos" }];
let orden = "NOMBRE_ASC";
let enCuadricula = false;

const esCarpeta = (a) => a.tipo === "directorio";

function ordenar(lista) {
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base", numeric: true });
  const comparador = {
    NOMBRE_ASC: porNombre,
    NOMBRE_DESC: (a, b) => -porNombre(a, b),
    TAMANO_DESC: (a, b) => b.tamanoBytes - a.tamanoBytes || porNombre(a, b),
    TAMANO_ASC: (a, b) => a.tamanoBytes - b.tamanoBytes || porNombre(a, b),
  }[orden];
  return [...lista].sort(comparador);
}

export function montar(contenedor, { intencion }) {
  let consulta = "";
  let estado = { tipo: "cargando" };
  let vivo = true;

  contenedor.innerHTML = `
    <div data-cab></div>
    <nav class="migas" aria-label="Ubicación" data-migas></nav>
    <div class="herramientas">
      <button type="button" class="selector-orden" data-orden aria-haspopup="menu"></button>
      <span class="espaciador"></span>
      <button type="button" class="boton-icono solo-movil" data-nuevo aria-label="Nuevo" aria-haspopup="menu">${icono("mas")}</button>
      <button type="button" class="boton-icono solo-escritorio" data-subir aria-label="Subir archivos" title="Subir archivos">${icono("subir")}</button>
      <button type="button" class="boton-icono solo-escritorio" data-carpeta aria-label="Nueva carpeta" title="Nueva carpeta">${icono("nuevaCarpeta")}</button>
      <button type="button" class="boton-icono" data-actualizar aria-label="Actualizar" title="Actualizar">${icono("actualizar")}</button>
      <button type="button" class="boton-icono" data-vista-modo></button>
    </div>
    <div data-cuerpo></div>
    <input type="file" multiple hidden data-entrada>
    <div class="zona-soltar" data-zona><div>${icono("subir")}Suelta los archivos para subirlos aquí</div></div>`;

  const $ = (s) => contenedor.querySelector(s);
  const cuerpo = $("[data-cuerpo]");
  const entrada = $("[data-entrada]");

  // ------------------------------------------------------------- cabecera
  function pintarCabecera() {
    $("[data-cab]").innerHTML = barraSuperior({ placeholder: `Buscar en ${ruta.at(-1).nombre}`, valor: consulta, acciones: accionesCuenta() });
    conectarCuenta($("[data-cab]"));
    conectarBusqueda($("[data-cab]"), (v) => { consulta = v; pintarCuerpo(); });
  }

  function pintarMigas() {
    $("[data-migas]").innerHTML = ruta
      .map((c, i) => `${i > 0 ? icono("chevron") : ""}<button type="button" data-nivel="${i}" ${i === ruta.length - 1 ? 'disabled aria-current="location"' : ""}>${esc(c.nombre)}</button>`)
      .join("");
    $("[data-migas]").scrollLeft = 1e6;
  }

  function pintarHerramientas() {
    const porNombre = orden.startsWith("NOMBRE");
    const asc = orden.endsWith("ASC");
    $("[data-orden]").innerHTML = `${porNombre ? "Nombre" : "Tamaño"} ${icono(asc ? "arriba" : "abajo", "s18")}`;
    const modo = $("[data-vista-modo]");
    modo.innerHTML = icono(enCuadricula ? "lista" : "cuadricula");
    modo.setAttribute("aria-label", enCuadricula ? "Ver como lista" : "Ver como cuadrícula");
    modo.title = modo.getAttribute("aria-label");
  }

  // ---------------------------------------------------------------- datos
  async function cargar() {
    estado = { tipo: "cargando" };
    pintarCuerpo();
    const pedido = ruta.at(-1).id;
    try {
      const lista = await almacenamiento.listar(pedido);
      if (!vivo || ruta.at(-1).id !== pedido) return;
      estado = { tipo: "listo", lista };
    } catch (error) {
      if (!vivo) return;
      estado = { tipo: "error", mensaje: error.message };
    }
    pintarCuerpo();
  }

  function irA(nivel) {
    ruta = ruta.slice(0, nivel + 1);
    consulta = "";
    pintarTodo();
    cargar();
  }

  function abrirCarpeta(carpeta) {
    ruta = [...ruta, { id: carpeta.id, nombre: carpeta.nombre }];
    consulta = "";
    pintarTodo();
    cargar();
  }

  // ---------------------------------------------------------------- cuerpo
  function filaHtml(a) {
    const tipo = tipoArchivo(a.nombre, esCarpeta(a));
    return `
      <li class="fila" tabindex="0" data-id="${esc(a.id)}">
        ${iconoTipo(tipo)}
        <div class="texto">
          <div class="t-body-l">${esc(a.nombre)}</div>
          <div class="secundario t-body-m solo-movil">${esCarpeta(a) ? "Carpeta" : `${esc(formatearTamano(a.tamanoBytes))} · v${esc(a.version)}`}</div>
        </div>
        <span class="columna">${esCarpeta(a) ? "—" : esc(formatearTamano(a.tamanoBytes))}</span>
        <span class="columna">${esCarpeta(a) ? "—" : `v${esc(a.version)}`}</span>
        <button type="button" class="boton-icono" data-mas="${esc(a.id)}" aria-label="Más acciones para ${esc(a.nombre)}">${icono("masVert")}</button>
      </li>`;
  }

  function tarjetaHtml(a) {
    const tipo = tipoArchivo(a.nombre, esCarpeta(a));
    if (esCarpeta(a)) {
      return `<button type="button" class="tarjeta-contorno carpeta-compacta" data-id="${esc(a.id)}">${iconoTipo(tipo, 32)}<span class="t-title-s una-linea">${esc(a.nombre)}</span></button>`;
    }
    return `
      <button type="button" class="tarjeta-contorno tarjeta-archivo" data-id="${esc(a.id)}">
        <div class="lienzo" style="background:color-mix(in srgb, ${tipo.color} 10%, transparent);color:${tipo.color}">${icono(tipo.icono)}</div>
        <div class="pie"><div class="t-title-s una-linea">${esc(a.nombre)}</div><div class="t-body-s atenuado">${esc(formatearTamano(a.tamanoBytes))}</div></div>
      </button>`;
  }

  function pintarCuerpo() {
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", cargar);
      return;
    }
    const q = consulta.trim().toLowerCase();
    const visibles = ordenar(estado.lista.filter((a) => a.nombre.toLowerCase().includes(q)));
    const carpetas = visibles.filter(esCarpeta);
    const archivos = visibles.filter((a) => !esCarpeta(a));

    if (!estado.lista.length) {
      cuerpo.innerHTML = estadoVacio({
        icono: "carpetaAbierta",
        titulo: "Esta carpeta está vacía",
        mensaje: "Los archivos que subas a esta carpeta aparecerán aquí. También puedes arrastrarlos a esta ventana.",
        accion: `<button type="button" class="boton boton-tonal" data-accion="subir">${icono("subir")}Subir archivos</button>`,
      });
      cuerpo.querySelector("[data-accion=subir]").addEventListener("click", () => entrada.click());
      return;
    }
    if (!visibles.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "sinResultados", titulo: "Sin resultados", mensaje: `Ningún elemento coincide con "${consulta.trim()}".` });
      return;
    }

    if (enCuadricula) {
      cuerpo.innerHTML = `
        ${carpetas.length ? `<div style="padding:0 0">${encabezadoSeccion("Carpetas")}</div><div class="cuadricula">${carpetas.map(tarjetaHtml).join("")}</div>` : ""}
        ${archivos.length ? `${encabezadoSeccion("Archivos")}<div class="cuadricula">${archivos.map(tarjetaHtml).join("")}</div>` : ""}`;
    } else {
      cuerpo.innerHTML = `
        <div class="cabecera-tabla solo-escritorio"><span>Nombre</span><span class="columna">Tamaño</span><span class="columna">Versión</span><span class="hueco"></span></div>
        ${carpetas.length ? `${encabezadoSeccion("Carpetas")}<ul class="lista">${carpetas.map(filaHtml).join("")}</ul>` : ""}
        ${archivos.length ? `${encabezadoSeccion("Archivos")}<ul class="lista">${archivos.map(filaHtml).join("")}</ul>` : ""}`;
    }
  }

  function pintarTodo() {
    pintarCabecera();
    pintarMigas();
    pintarHerramientas();
    pintarCuerpo();
  }

  const porId = (id) => estado.lista?.find((a) => a.id === id);

  // -------------------------------------------------------------- acciones
  function abrir(elemento) {
    if (esCarpeta(elemento)) abrirCarpeta(elemento);
    else mostrarDetalles(elemento);
  }

  function mostrarDetalles(a) {
    const tipo = tipoArchivo(a.nombre, esCarpeta(a));
    const acciones = esCarpeta(a)
      ? [{ texto: "Abrir", icono: "carpetaAbierta", clase: "boton-relleno", accion: (h) => { h.close(); abrirCarpeta(a); } }]
      : [
          { texto: "Descargar", icono: "descargar", clase: "boton-relleno", accion: () => descargar(a) },
          { texto: "Compartir", icono: "compartir", accion: (h) => { h.close(); abrirCompartir(a); } },
          { texto: "Eliminar", icono: "eliminar", peligro: true, accion: (h) => { h.close(); eliminar(a); } },
        ];
    const hoja = abrirHoja(cuerpoDetalles({
      iconoHtml: iconoTipo(tipo, 48),
      titulo: a.nombre,
      subtitulo: tipo.etiqueta,
      filas: [
        ...(esCarpeta(a) ? [] : [["Tamaño", formatearTamano(a.tamanoBytes)], ["Versión", `v${a.version}`]]),
        ["Ubicación", ruta.map((c) => c.nombre).join(" / ")],
        ["Identificador", a.id, true],
      ],
      acciones,
    }));
    conectarHoja(hoja, acciones);
  }

  function menuElemento(boton, a) {
    const items = esCarpeta(a)
      ? [
          { texto: "Abrir", icono: "carpetaAbierta", accion: () => abrirCarpeta(a) },
          { texto: "Compartir", icono: "compartir", accion: () => abrirCompartir(a) },
          { texto: "Detalles", icono: "info", accion: () => mostrarDetalles(a) },
        ]
      : [
          { texto: "Descargar", icono: "descargar", accion: () => descargar(a) },
          { texto: "Compartir", icono: "compartir", accion: () => abrirCompartir(a) },
          { texto: "Detalles", icono: "info", accion: () => mostrarDetalles(a) },
          "separador",
          { texto: "Eliminar", icono: "eliminar", peligro: true, accion: () => eliminar(a) },
        ];
    abrirMenu(boton, items);
  }

  async function descargar(a) {
    avisar(`Descargando “${a.nombre}”…`);
    try {
      await almacenamiento.descargar(a);
    } catch (error) {
      avisar(`No se pudo descargar: ${error.message}`);
    }
  }

  async function eliminar(a) {
    const si = await confirmar({
      titulo: `¿Eliminar “${a.nombre}”?`,
      mensaje: "Se borrará del repositorio con todas sus versiones. Esta acción no se puede deshacer.",
      aceptar: "Eliminar",
      peligro: true,
    });
    if (!si) return;
    try {
      await almacenamiento.eliminar(a.id);
      avisar(`“${a.nombre}” eliminado`);
      dispatchEvent(new Event("upbc:cuota-cambio"));
      cargar();
    } catch (error) {
      avisar(`No se pudo eliminar: ${error.message}`);
    }
  }

  async function nuevaCarpeta() {
    const nombre = await pedirTexto({ titulo: "Nueva carpeta", etiqueta: "Nombre", valor: "Carpeta sin título" });
    if (!nombre) return;
    try {
      await almacenamiento.crearCarpeta(nombre, ruta.at(-1).id);
      avisar(`Carpeta “${nombre}” creada`);
      cargar();
    } catch (error) {
      avisar(`No se pudo crear la carpeta: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------- subida
  let panel = null;
  async function subir(lista) {
    const archivos = [...lista];
    if (!archivos.length) return;
    const destino = ruta.at(-1);
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "subidas";
      panel.setAttribute("aria-live", "polite");
      document.body.append(panel);
    }
    const tareas = archivos.map((f, i) => ({ f, i, progreso: 0, estado: "subiendo", error: null }));
    const pintarPanel = () => {
      const listos = tareas.filter((t) => t.estado !== "subiendo").length;
      panel.innerHTML = `
        <div class="subidas-cab"><strong class="t-title-s">${listos === tareas.length ? `${tareas.filter((t) => t.estado === "ok").length} de ${tareas.length} subidos` : `Subiendo ${tareas.length - listos} de ${tareas.length}…`}</strong>
          <button type="button" class="boton-icono" data-cerrar-panel aria-label="Cerrar">${icono("cerrar")}</button></div>
        <ul>${tareas.map((t) => {
          const tipo = tipoArchivo(t.f.name);
          return `<li>${iconoTipo(tipo, 32)}<div class="texto"><div class="t-body-m una-linea">${esc(t.f.name)}</div>
            ${t.estado === "subiendo" ? barra(t.progreso, { clase: "fina" }) : `<div class="t-body-s" style="color:${t.estado === "ok" ? "var(--exito)" : "var(--error)"}">${t.estado === "ok" ? "Subido" : esc(t.error)}</div>`}
          </div></li>`;
        }).join("")}</ul>`;
      panel.querySelector("[data-cerrar-panel]").addEventListener("click", () => { panel.remove(); panel = null; });
    };
    pintarPanel();

    // De a una: el servidor recibe el archivo en memoria (multer memoryStorage).
    for (const t of tareas) {
      try {
        await almacenamiento.subir(t.f, destino.id, (p) => { t.progreso = p; if (panel) pintarPanel(); });
        t.estado = "ok";
      } catch (error) {
        t.estado = "error";
        t.error = error.message;
      }
      if (panel) pintarPanel();
    }
    dispatchEvent(new Event("upbc:cuota-cambio"));
    if (vivo && ruta.at(-1).id === destino.id) cargar();
    const fallidos = tareas.filter((t) => t.estado === "error").length;
    if (!fallidos) setTimeout(() => { panel?.remove(); panel = null; }, 4000);
  }

  // --------------------------------------------------------------- eventos
  $("[data-migas]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nivel]");
    if (b && !b.disabled) irA(Number(b.dataset.nivel));
  });
  $("[data-orden]").addEventListener("click", (e) =>
    abrirMenu(e.currentTarget, [
      { titulo: "Ordenar por" },
      ...Object.entries(ORDENES).map(([clave, texto]) => ({
        texto, marcado: clave === orden, accion: () => { orden = clave; pintarHerramientas(); pintarCuerpo(); },
      })),
    ], { alinear: "izquierda" })
  );
  $("[data-vista-modo]").addEventListener("click", () => { enCuadricula = !enCuadricula; pintarHerramientas(); pintarCuerpo(); });
  $("[data-actualizar]").addEventListener("click", cargar);
  $("[data-subir]").addEventListener("click", () => entrada.click());
  $("[data-carpeta]").addEventListener("click", nuevaCarpeta);
  $("[data-nuevo]").addEventListener("click", (e) =>
    abrirMenu(e.currentTarget, [
      { texto: "Subir archivos", icono: "subir", accion: () => entrada.click() },
      { texto: "Nueva carpeta", icono: "nuevaCarpeta", accion: nuevaCarpeta },
    ])
  );
  entrada.addEventListener("change", () => { subir(entrada.files); entrada.value = ""; });

  cuerpo.addEventListener("click", (e) => {
    const mas = e.target.closest("[data-mas]");
    if (mas) { e.stopPropagation(); menuElemento(mas, porId(mas.dataset.mas)); return; }
    const el = e.target.closest("[data-id]");
    if (el) abrir(porId(el.dataset.id));
  });
  cuerpo.addEventListener("keydown", (e) => {
    const el = e.target.closest(".fila[data-id]");
    if (el && (e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); abrir(porId(el.dataset.id)); }
  });

  // Arrastrar y soltar archivos desde el escritorio.
  const zona = $("[data-zona]");
  let profundidad = 0;
  const conArchivos = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const alEntrar = (e) => { if (!conArchivos(e)) return; e.preventDefault(); profundidad++; zona.classList.add("activa"); };
  const alSalir = () => { profundidad = Math.max(0, profundidad - 1); if (!profundidad) zona.classList.remove("activa"); };
  const alSobre = (e) => { if (conArchivos(e)) e.preventDefault(); };
  const alSoltar = (e) => { if (!conArchivos(e)) return; e.preventDefault(); profundidad = 0; zona.classList.remove("activa"); subir(e.dataTransfer.files); };
  addEventListener("dragenter", alEntrar);
  addEventListener("dragleave", alSalir);
  addEventListener("dragover", alSobre);
  addEventListener("drop", alSoltar);

  pintarTodo();
  cargar();
  if (intencion === "subir") entrada.click();
  if (intencion === "carpeta") nuevaCarpeta();

  return () => {
    vivo = false;
    removeEventListener("dragenter", alEntrar);
    removeEventListener("dragleave", alSalir);
    removeEventListener("dragover", alSobre);
    removeEventListener("drop", alSoltar);
  };
}
