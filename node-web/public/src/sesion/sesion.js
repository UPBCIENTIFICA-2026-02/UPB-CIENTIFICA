/*
 * Sesión del usuario (equivalente a session/TokenManager.kt del móvil).
 *
 * El token se guarda en sessionStorage: muere al cerrar la pestaña, que es lo
 * prudente en un equipo compartido de laboratorio. El navegador puede negar el
 * acceso al almacenamiento (modo privado, políticas del equipo), así que toda
 * lectura y escritura va protegida: si falla, la sesión vive solo en memoria.
 */

const CLAVE = "upbc.sesion";
let actual = leer();
const oyentes = new Set();

function leer() {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

function guardar(valor) {
  try {
    if (valor) sessionStorage.setItem(CLAVE, JSON.stringify(valor));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: la sesión queda solo en memoria */
  }
}

/** { usuario, token, roles, demo } o null si no hay sesión. */
export function sesionActual() {
  return actual;
}

export function token() {
  return actual?.token ?? null;
}

export function esDemo() {
  return Boolean(actual?.demo);
}

export function iniciarSesion({ usuario, token, roles = [], demo = false }) {
  actual = { usuario, token, roles, demo };
  guardar(actual);
  oyentes.forEach((f) => f(actual));
}

export function cerrarSesion(motivo = null) {
  actual = null;
  guardar(null);
  oyentes.forEach((f) => f(null, motivo));
}

/** Avisa cuando se inicia o se cierra la sesión (por ejemplo, al expirar). */
export function alCambiarSesion(funcion) {
  oyentes.add(funcion);
  return () => oyentes.delete(funcion);
}
