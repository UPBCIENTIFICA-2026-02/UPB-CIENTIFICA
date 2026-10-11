/*
 * Lo que va a la derecha de la barra superior en todas las pestañas
 * (accionesCuenta de MainScreen.kt): el indicador de estado y el avatar con
 * el menú de la cuenta (MenuCuenta de Cuenta.kt).
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";
import { avatar } from "./basicos.js";
import { abrirMenu, confirmar } from "./superpuestos.js";
import { sesionActual, esDemo } from "../../sesion/sesion.js";
import { estadoConexion } from "../../datos/conexion.js";
import { salir } from "../../datos/auth.js";
import { aplicarTema, temaGuardado } from "../tema.js";

const ASPECTO_ESTADO = {
  ok: { icono: "nubeOk", clase: "ok", texto: "Conectado a UPB-Científica" },
  off: { icono: "nubeOff", clase: "off", texto: "Sin conexión con el servidor" },
  demo: { icono: "nubeSync", clase: "demo", texto: "Modo demostración: datos de ejemplo" },
  desconocido: { icono: "nubeSync", clase: "", texto: "Comprobando la conexión" },
};

/** Indicador de solo lectura; el texto lo leen los lectores de pantalla. */
export function indicadorEstado(estado = estadoConexion()) {
  const a = ASPECTO_ESTADO[estado] ?? ASPECTO_ESTADO.desconocido;
  return `<span class="indicador-estado ${a.clase}" data-indicador role="img" aria-label="${esc(a.texto)}" title="${esc(a.texto)}">${icono(a.icono)}</span>`;
}

/** Refresca todos los indicadores que haya en pantalla. */
export function refrescarIndicadores(estado) {
  document.querySelectorAll("[data-indicador]").forEach((el) => el.outerHTML = indicadorEstado(estado));
}

export function accionesCuenta() {
  const usuario = sesionActual()?.usuario ?? "";
  return `${indicadorEstado()}<button type="button" class="boton-avatar" data-cuenta aria-label="Cuenta de ${esc(usuario)}" aria-haspopup="menu">${avatar(usuario, 32)}</button>`;
}

/** Conecta el avatar de una barra superior a su menú. */
export function conectarCuenta(raiz) {
  raiz.querySelectorAll("[data-cuenta]").forEach((boton) =>
    boton.addEventListener("click", (e) => {
      e.preventDefault();
      abrirMenuCuenta(boton);
    })
  );
}

function abrirMenuCuenta(ancla) {
  const usuario = sesionActual()?.usuario ?? "";
  const tema = temaGuardado();
  abrirMenu(ancla, [
    {
      html: `<div class="menu-cuenta">${avatar(usuario, 40)}<div style="min-width:0">
        <div class="t-title-s una-linea">${esc(usuario)}</div>
        <div class="t-body-s atenuado">${esDemo() ? "Modo demostración" : "Sesión iniciada"}</div></div></div>`,
    },
    "separador",
    { titulo: "Apariencia" },
    { texto: "Según el sistema", icono: "nube", marcado: tema === "sistema", accion: () => aplicarTema("sistema") },
    { texto: "Claro", icono: "claro", marcado: tema === "claro", accion: () => aplicarTema("claro") },
    { texto: "Oscuro", icono: "oscuro", marcado: tema === "oscuro", accion: () => aplicarTema("oscuro") },
    "separador",
    {
      texto: "Cerrar sesión",
      icono: "salir",
      accion: async () => {
        const si = await confirmar({
          titulo: "¿Cerrar sesión?",
          mensaje: "Tendrás que volver a ingresar tu usuario y contraseña.",
          aceptar: "Cerrar sesión",
          icono: "salir",
        });
        if (si) salir();
      },
    },
  ]);
}
