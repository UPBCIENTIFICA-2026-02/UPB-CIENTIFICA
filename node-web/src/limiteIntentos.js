// limiteIntentos.js — Freno a la fuerza bruta en el inicio de sesión (G2).
//
// Hallazgo: POST /api/sesion aceptaba intentos sin límite (30 contraseñas
// falsas seguidas y luego la buena entraba sin problema). Ahora, tras
// MAX_FALLOS fallos en VENTANA_MS para el mismo usuario desde la misma IP, o
// MAX_FALLOS_IP desde una IP para cualquier usuario, se responde 429 hasta que
// pase el bloqueo. Un inicio correcto limpia el contador de ese usuario.
//
// En memoria a propósito: node-web es un solo proceso. Si se reinicia, los
// contadores vuelven a cero (riesgo asumido, ver el informe).

const VENTANA_MS = 15 * 60_000;
const MAX_FALLOS = 5;          // mismo usuario y misma IP
const MAX_FALLOS_IP = 20;      // misma IP, cualquier usuario (prueba de muchos usuarios)

const fallos = new Map();      // clave -> [instantes de fallo]

function recientes(clave, ahora) {
  const lista = (fallos.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  if (lista.length) fallos.set(clave, lista); else fallos.delete(clave);
  return lista;
}

const claves = (ip, usuario) => [`u|${ip}|${String(usuario).toLowerCase()}`, `ip|${ip}`];

/** Segundos que faltan para poder intentarlo de nuevo, o 0 si puede. */
export function bloqueado(ip, usuario, ahora = Date.now()) {
  const [porUsuario, porIp] = claves(ip, usuario);
  const a = recientes(porUsuario, ahora), b = recientes(porIp, ahora);
  const limite = a.length >= MAX_FALLOS ? a[0] : b.length >= MAX_FALLOS_IP ? b[0] : null;
  return limite === null ? 0 : Math.ceil((limite + VENTANA_MS - ahora) / 1000);
}

export function registrarFallo(ip, usuario, ahora = Date.now()) {
  for (const c of claves(ip, usuario)) fallos.set(c, [...recientes(c, ahora), ahora]);
  // Tope de memoria: si alguien rota miles de usuarios, se olvida lo más viejo.
  if (fallos.size > 10_000) fallos.delete(fallos.keys().next().value);
}

export function registrarExito(ip, usuario) {
  fallos.delete(claves(ip, usuario)[0]);
}
