/*
 * Claro, oscuro o según el sistema (el móvil sigue al sistema con
 * isSystemInDarkTheme; aquí además se puede elegir a mano desde el menú de
 * la cuenta). La preferencia se recuerda en este navegador.
 */

const CLAVE = "upbc.tema";

export function temaGuardado() {
  try {
    return localStorage.getItem(CLAVE) || "sistema";
  } catch {
    return "sistema";
  }
}

export function aplicarTema(tema = temaGuardado()) {
  const raiz = document.documentElement;
  if (tema === "claro" || tema === "oscuro") raiz.dataset.tema = tema;
  else delete raiz.dataset.tema;
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    /* sin almacenamiento: dura lo que dure la pestaña */
  }
}
