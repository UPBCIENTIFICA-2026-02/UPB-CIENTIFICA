/*
 * Estado de la conexión con el servidor, para el indicador de la barra
 * superior.
 *
 * El móvil y el escritorio muestran ahí el estado de File Sync. El navegador
 * no sincroniza carpetas (no hay gRPC en el navegador ni acceso al disco), así
 * que la web muestra lo que sí puede saber: si node-web responde. Usa la sonda
 * /salud que node-web ya expone para el módulo de monitoreo.
 */

import { esDemo } from "../sesion/sesion.js";

const INTERVALO_MS = 20_000;
let estado = "desconocido"; // "ok" | "off" | "demo" | "desconocido"
const oyentes = new Set();
let temporizador = null;

function publicar(nuevo) {
  if (nuevo === estado) return;
  estado = nuevo;
  oyentes.forEach((f) => f(estado));
}

async function sondear() {
  if (esDemo()) return publicar("demo");
  if (!navigator.onLine) return publicar("off");
  try {
    const r = await fetch("/salud", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    publicar(r.ok ? "ok" : "off");
  } catch {
    publicar("off");
  }
}

export function estadoConexion() {
  return estado;
}

export function alCambiarConexion(funcion) {
  oyentes.add(funcion);
  return () => oyentes.delete(funcion);
}

export function iniciarSondeo() {
  detenerSondeo();
  estado = "desconocido";
  sondear();
  temporizador = setInterval(sondear, INTERVALO_MS);
  addEventListener("online", sondear);
  addEventListener("offline", sondear);
}

export function detenerSondeo() {
  clearInterval(temporizador);
  removeEventListener("online", sondear);
  removeEventListener("offline", sondear);
}
