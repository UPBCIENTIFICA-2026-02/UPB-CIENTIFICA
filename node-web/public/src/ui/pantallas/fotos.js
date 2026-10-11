/*
 * Fotos (Photo Album, node-media).
 *
 * El enunciado pide que el álbum "funcione sobre la web y permita explorar
 * en Home las imágenes, ordenarlas y presentarlas": rejilla de miniaturas,
 * orden por fecha o título, álbumes, y un visor a pantalla completa para
 * presentarlas una por una (flechas del teclado incluidas).
 *
 * El móvil todavía no tiene esta pantalla; sigue el mismo lenguaje visual.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano, formatearDia } from "../formato.js";
import { barraSuperior, conectarBusqueda, estadoVacio, estadoError, esqueleto } from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirMenu, abrirDialogo, pedirTexto, avisar } from "../componentes/superpuestos.js";
import { album } from "../../datos/medios.js";

let orden = "fecha";

export function montar(contenedor) {
  let consulta = "";
  let estado = { tipo: "cargando" };
  let albumes = [];
  let seleccion = null; // null = todas; si no, { id, nombre }
  let vivo = true;

  contenedor.innerHTML = `
    <div data-cab>${barraSuperior({ placeholder: "Buscar fotos", acciones: accionesCuenta() })}</div>
    <div class="fila-titulo">
      <h1 class="t-title-l" data-titulo>Fotos</h1>
      <button type="button" class="selector-orden" data-orden aria-haspopup="menu"></button>
      <button type="button" class="boton-icono" data-indexar aria-label="Buscar fotos nuevas en Mis archivos" title="Buscar fotos nuevas en Mis archivos">${icono("indexar")}</button>
      <button type="button" class="boton-icono" data-actualizar aria-label="Actualizar" title="Actualizar">${icono("actualizar")}</button>
    </div>
    <div class="albumes"><div class="chips desplazable" data-albumes></div></div>
    <div data-cuerpo></div>`;

  const $ = (s) => contenedor.querySelector(s);
  const cuerpo = $("[data-cuerpo]");
  conectarCuenta(contenedor);
  conectarBusqueda(contenedor, (v) => { consulta = v; pintar(); });

  // Las miniaturas se piden solo cuando entran en pantalla.
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      observador.unobserve(e.target);
      const foto = visibles().find((f) => f.id === e.target.dataset.foto);
      if (!foto) continue;
      album.urlMiniatura(foto)
        .then((url) => {
          if (!url) return;
          const img = e.target.querySelector("img");
          img.src = url;
          img.hidden = false;
          e.target.querySelector(".sin-miniatura")?.remove();
        })
        .catch(() => {});
    }
  }, { rootMargin: "200px" });

  function pintarOrden() {
    $("[data-orden]").innerHTML = `${orden === "fecha" ? "Fecha" : "Título"} ${icono(orden === "fecha" ? "abajo" : "arriba", "s18")}`;
  }

  function pintarAlbumes() {
    $("[data-albumes]").innerHTML = `
      <button type="button" class="chip" data-album="" aria-pressed="${!seleccion}">Todas las fotos</button>
      ${albumes.map((a) => `<button type="button" class="chip" data-album="${esc(a.id)}" aria-pressed="${seleccion?.id === a.id}">${icono("album", "s18")}${esc(a.nombre)} <span class="atenuado">${esc(a.totalFotos)}</span></button>`).join("")}
      <button type="button" class="chip" data-nuevo-album>${icono("mas", "s18")}Nuevo álbum</button>`;
    $("[data-titulo]").textContent = seleccion ? seleccion.nombre : "Fotos";
  }

  function visibles() {
    if (estado.tipo !== "listo") return [];
    const q = consulta.trim().toLowerCase();
    const lista = estado.fotos.filter((f) => (f.titulo ?? "").toLowerCase().includes(q));
    return lista.sort(orden === "fecha"
      ? (a, b) => String(b.fecha).localeCompare(String(a.fecha))
      : (a, b) => String(a.titulo).localeCompare(String(b.titulo), "es", { numeric: true }));
  }

  async function cargar() {
    estado = { tipo: "cargando" };
    pintar();
    try {
      const [fotos, listaAlbumes] = await Promise.all([
        seleccion ? album.verAlbum(seleccion.id).then((a) => a.fotos) : album.fotos(0),
        album.albumes().catch(() => []),
      ]);
      if (!vivo) return;
      albumes = listaAlbumes;
      estado = { tipo: "listo", fotos };
    } catch (error) {
      if (!vivo) return;
      estado = { tipo: "error", mensaje: error.message };
    }
    pintarAlbumes();
    pintar();
  }

  function pintar() {
    observador.disconnect();
    if (estado.tipo === "cargando") { cuerpo.innerHTML = esqueleto(6); return; }
    if (estado.tipo === "error") {
      cuerpo.innerHTML = estadoError(estado.mensaje);
      cuerpo.querySelector("[data-accion=reintentar]").addEventListener("click", cargar);
      return;
    }
    const lista = visibles();
    if (!estado.fotos.length) {
      cuerpo.innerHTML = seleccion
        ? estadoVacio({ icono: "album", titulo: "Este álbum está vacío", mensaje: "Abre una foto y usa “Agregar a álbum” para traerla aquí." })
        : estadoVacio({
            icono: "fotos", titulo: "Aún no hay fotos",
            mensaje: "Las imágenes que subas a Mis archivos aparecen aquí después de indexarlas.",
            accion: `<button type="button" class="boton boton-tonal" data-accion="indexar">${icono("indexar")}Buscar fotos ahora</button>`,
          });
      cuerpo.querySelector("[data-accion=indexar]")?.addEventListener("click", indexar);
      return;
    }
    if (!lista.length) {
      cuerpo.innerHTML = estadoVacio({ icono: "sinResultados", titulo: "Sin resultados", mensaje: `Ninguna foto coincide con "${consulta.trim()}".` });
      return;
    }
    cuerpo.innerHTML = `<div class="rejilla-fotos">${lista.map((f, i) => `
      <button type="button" class="foto" data-foto="${esc(f.id)}" data-i="${i}" aria-label="${esc(f.titulo)}">
        <span class="sin-miniatura">${icono("imagen")}</span>
        <img alt="" hidden>
        <span class="pie-foto">${esc(f.titulo)}</span>
      </button>`).join("")}</div>`;
    cuerpo.querySelectorAll("[data-foto]").forEach((el) => observador.observe(el));
  }

  async function indexar() {
    avisar("Buscando fotos y videos nuevos en Mis archivos…", 8000);
    try {
      const r = await album.indexar();
      avisar(typeof r?.indexados === "number" ? `${r.indexados} archivos nuevos indexados` : "Índice actualizado");
      cargar();
    } catch (error) {
      avisar(`No se pudo indexar: ${error.message}`);
    }
  }

  async function nuevoAlbum() {
    const nombre = await pedirTexto({ titulo: "Nuevo álbum", etiqueta: "Nombre del álbum", valor: "" });
    if (!nombre) return;
    try {
      const creado = await album.crearAlbum(nombre, "");
      avisar(`Álbum “${nombre}” creado`);
      seleccion = { id: creado.id, nombre };
      cargar();
    } catch (error) {
      avisar(`No se pudo crear el álbum: ${error.message}`);
    }
  }

  // ----------------------------------------------------------------- visor
  function abrirVisor(inicio) {
    const lista = visibles();
    let i = inicio;
    const urls = new Map();
    const d = abrirDialogo(`
      <div class="visor-cab">
        <button type="button" class="boton-icono" data-cerrar aria-label="Cerrar">${icono("cerrar")}</button>
        <div class="titulo"><div class="t-title-m una-linea" data-t></div><div class="t-body-s" style="opacity:.7" data-f></div></div>
        <button type="button" class="boton-icono" data-agregar aria-label="Agregar a álbum" title="Agregar a álbum" aria-haspopup="menu">${icono("album")}</button>
        <button type="button" class="boton-icono" data-descargar aria-label="Descargar" title="Descargar">${icono("descargar")}</button>
      </div>
      <div class="visor-lienzo">
        <img alt="" data-img>
        <button type="button" class="visor-flecha izq" data-ant aria-label="Foto anterior">${icono("anterior")}</button>
        <button type="button" class="visor-flecha der" data-sig aria-label="Foto siguiente">${icono("adelante")}</button>
      </div>
      <div class="visor-pie" data-pie></div>`, "visor");

    async function mostrar() {
      const f = lista[i];
      d.querySelector("[data-t]").textContent = f.titulo;
      d.querySelector("[data-f]").textContent = [formatearDia(f.fecha), f.ancho && f.alto ? `${f.ancho} × ${f.alto}` : "", formatearTamano(f.tamanoBytes)].filter(Boolean).join(" · ");
      d.querySelector("[data-pie]").textContent = `${i + 1} de ${lista.length}`;
      d.querySelector("[data-ant]").hidden = i === 0;
      d.querySelector("[data-sig]").hidden = i === lista.length - 1;
      const img = d.querySelector("[data-img]");
      img.alt = f.titulo;
      // Primero la miniatura (ya está en caché) y luego la original.
      img.src = (await album.urlMiniatura(f).catch(() => null)) || "";
      try {
        if (!urls.has(f.id)) urls.set(f.id, album.urlContenido(f));
        const url = await urls.get(f.id);
        if (lista[i] === f) img.src = url;
      } catch { /* se queda la miniatura */ }
    }
    const mover = (paso) => { const n = i + paso; if (n >= 0 && n < lista.length) { i = n; mostrar(); } };

    d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
    d.querySelector("[data-ant]").addEventListener("click", () => mover(-1));
    d.querySelector("[data-sig]").addEventListener("click", () => mover(1));
    d.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") mover(-1);
      if (e.key === "ArrowRight") mover(1);
    });
    d.querySelector("[data-descargar]").addEventListener("click", async () => {
      const f = lista[i];
      const url = await (urls.get(f.id) ?? album.urlContenido(f));
      const a = Object.assign(document.createElement("a"), { href: url, download: f.titulo });
      document.body.append(a); a.click(); a.remove();
    });
    d.querySelector("[data-agregar]").addEventListener("click", (e) => {
      const f = lista[i];
      const items = [
        { titulo: "Agregar a álbum" },
        ...albumes.map((a) => ({
          texto: a.nombre, icono: "album",
          accion: async () => {
            try { await album.agregarFoto(a.id, f.id); avisar(`Agregada a “${a.nombre}”`); }
            catch (error) { avisar(`No se pudo agregar: ${error.message}`); }
          },
        })),
      ];
      if (seleccion) {
        items.push("separador", {
          texto: `Quitar de “${seleccion.nombre}”`, icono: "eliminar", peligro: true,
          accion: async () => {
            try { await album.quitarFoto(seleccion.id, f.id); avisar("Foto quitada del álbum"); d.close(); cargar(); }
            catch (error) { avisar(`No se pudo quitar: ${error.message}`); }
          },
        });
      }
      if (!albumes.length && !seleccion) items.push({ texto: "Todavía no tienes álbumes", accion: () => {} });
      abrirMenu(e.currentTarget, items);
    });
    d.addEventListener("close", () => {
      for (const p of urls.values()) p.then((u) => u?.startsWith("blob:") && URL.revokeObjectURL(u)).catch(() => {});
    });
    mostrar();
  }

  // --------------------------------------------------------------- eventos
  $("[data-orden]").addEventListener("click", (e) =>
    abrirMenu(e.currentTarget, [
      { titulo: "Ordenar por" },
      { texto: "Fecha (recientes primero)", marcado: orden === "fecha", accion: () => { orden = "fecha"; pintarOrden(); pintar(); } },
      { texto: "Título (A-Z)", marcado: orden === "titulo", accion: () => { orden = "titulo"; pintarOrden(); pintar(); } },
    ])
  );
  $("[data-indexar]").addEventListener("click", indexar);
  $("[data-actualizar]").addEventListener("click", cargar);
  $("[data-albumes]").addEventListener("click", (e) => {
    if (e.target.closest("[data-nuevo-album]")) return nuevoAlbum();
    const chip = e.target.closest("[data-album]");
    if (!chip) return;
    const id = chip.dataset.album;
    seleccion = id ? { id, nombre: albumes.find((a) => a.id === id)?.nombre ?? "Álbum" } : null;
    pintarAlbumes();
    cargar();
  });
  cuerpo.addEventListener("click", (e) => {
    const f = e.target.closest("[data-foto]");
    if (f) abrirVisor(Number(f.dataset.i));
  });

  pintarOrden();
  pintarAlbumes();
  cargar();
  return () => { vivo = false; observador.disconnect(); };
}
