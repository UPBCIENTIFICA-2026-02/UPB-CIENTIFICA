/*
 * Cliente HTTP hacia la pasarela de node-web (equivalente a
 * network/RestClient.kt del móvil).
 *
 * Responsabilidades, y ninguna más:
 *  - Poner "Authorization: Bearer <token>" en cada llamada.
 *  - Cortar la espera cuando un servicio no responde.
 *  - Convertir cualquier fallo en un ErrorApi con un mensaje que una persona
 *    pueda leer. Los servicios del backend responden { error, mensaje }; se
 *    usa ese mensaje cuando viene, porque es el que mejor explica qué pasó.
 *  - Avisar a la sesión cuando el token ya no sirve (HTTP 401).
 */

import { config } from "../config.js";
import { token, cerrarSesion } from "../sesion/sesion.js";

export class ErrorApi extends Error {
  constructor(mensaje, estado = 0, codigo = null) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const MENSAJES_POR_ESTADO = {
  400: "La solicitud no es válida.",
  403: "No tienes permiso para hacer esto.",
  404: "No se encontró el recurso.",
  413: "No hay espacio suficiente: superarías tu cuota.",
  416: "El rango pedido no existe en el archivo.",
  500: "El servidor tuvo un error interno.",
  501: "Esta función todavía no está disponible en el servidor.",
  502: "node-web no pudo comunicarse con el servicio.",
  503: "El servicio no está disponible en este momento.",
  504: "El servicio tardó demasiado en responder.",
};

function cabeceras(extra = {}) {
  const t = token();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

async function errorDesdeRespuesta(respuesta) {
  let cuerpo = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    /* sin cuerpo JSON */
  }
  const mensaje =
    cuerpo?.mensaje || cuerpo?.message || (typeof cuerpo?.error === "string" && cuerpo.error.includes(" ") ? cuerpo.error : null) ||
    MENSAJES_POR_ESTADO[respuesta.status] || `El servidor respondió ${respuesta.status}.`;
  return new ErrorApi(mensaje, respuesta.status, cuerpo?.error ?? null);
}

/**
 * Hace una petición a la pasarela.
 * @param {string} ruta     ruta bajo API_BASE, p. ej. "/storage/cuota"
 * @param {object} opciones { metodo, cuerpo (JSON), formulario (FormData), como: "json"|"blob"|"nada" }
 */
export async function pedir(ruta, { metodo = "GET", cuerpo, formulario, como = "json", tiempo } = {}) {
  const extra = cuerpo !== undefined ? { "Content-Type": "application/json" } : {};
  let respuesta;
  try {
    respuesta = await fetch(config.API_BASE + ruta, {
      method: metodo,
      headers: cabeceras(extra),
      body: formulario ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
      signal: AbortSignal.timeout(tiempo ?? config.TIEMPO_ESPERA_MS),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") {
      throw new ErrorApi("El servidor tardó demasiado en responder. Revisa que el servicio esté encendido.", 0);
    }
    throw new ErrorApi("No hay conexión con el servidor. Revisa la red o que node-web esté en línea.", 0);
  }

  if (respuesta.status === 401) {
    const error = await errorDesdeRespuesta(respuesta);
    // Un 401 en el inicio de sesión es "credenciales malas", no "sesión expirada".
    if (ruta !== "/sesion") cerrarSesion("Tu sesión expiró. Vuelve a iniciar sesión.");
    throw error;
  }
  if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);

  if (como === "nada" || respuesta.status === 204) return null;
  if (como === "blob") return respuesta.blob();
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

/**
 * Sube un archivo con progreso. fetch() no informa el avance de la subida,
 * así que aquí se usa XMLHttpRequest.
 */
export function subirConProgreso(ruta, formulario, alProgresar) {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", config.API_BASE + ruta);
    const t = token();
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) alProgresar?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolver(xhr.response);
      if (xhr.status === 401) cerrarSesion("Tu sesión expiró. Vuelve a iniciar sesión.");
      const cuerpo = xhr.response || {};
      rechazar(new ErrorApi(cuerpo.mensaje || MENSAJES_POR_ESTADO[xhr.status] || `El servidor respondió ${xhr.status}.`, xhr.status, cuerpo.error));
    };
    xhr.onerror = () => rechazar(new ErrorApi("No hay conexión con el servidor.", 0));
    xhr.send(formulario);
  });
}

/**
 * URL para elementos que el navegador descarga solo (<video>, <img>).
 *
 * Esos elementos no pueden poner la cabecera Authorization, así que el token
 * viaja como parámetro access_token y node-web lo pasa a cabecera antes de
 * reenviar al servicio. Se usa SOLO para el video, donde descargarlo entero a
 * memoria rompería el salto en la línea de tiempo (Range).
 */
export function urlConToken(ruta) {
  const separador = ruta.includes("?") ? "&" : "?";
  return `${config.API_BASE}${ruta}${separador}access_token=${encodeURIComponent(token() ?? "")}`;
}
