/*
 * Utilidades de texto y formato (las mismas funciones del móvil, en
 * ui/components/TipoArchivo.kt y HomeScreen.kt).
 */

/** Escapa texto para insertarlo en HTML. Todo dato del servidor pasa por aquí. */
export function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** 1536 -> "1.5 KB". Sin decimales para B y KB: "512 B" se lee mejor que "512,0 B". */
export function formatearTamano(bytes) {
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = Number(bytes) || 0;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  const texto = i <= 1 ? Math.round(valor).toString() : valor.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${texto} ${unidades[i]}`;
}

/** 3725 -> "1:02:05"; 95 -> "1:35". Formato de reproductor de video. */
export function formatearDuracion(segundos) {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Fecha -> "hace un momento", "hace 5 min", "hace 2 h", "hace 3 días". */
export function formatearHace(fecha, ahora = Date.now()) {
  const instante = typeof fecha === "number" ? fecha : Date.parse(fecha);
  if (Number.isNaN(instante)) return "";
  const segundos = Math.max(0, Math.floor((ahora - instante) / 1000));
  if (segundos < 60) return "hace un momento";
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`;
  if (segundos < 86_400) return `hace ${Math.floor(segundos / 3600)} h`;
  const dias = Math.floor(segundos / 86_400);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** "12 oct 2026, 3:05 p. m." */
export function formatearFecha(fecha) {
  if (!fecha) return "—";
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatearDia(fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

/** Mismo saludo que HomeScreen.kt según la hora. */
export function saludo(hora = new Date().getHours()) {
  if (hora >= 5 && hora <= 11) return "Buenos días";
  if (hora >= 12 && hora <= 18) return "Buenas tardes";
  return "Buenas noches";
}

/** Igual que String.hashCode() de Kotlin, para que el color del avatar coincida con el móvil. */
export function hashKotlin(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (Math.imul(31, h) + texto.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Id largo (UUID) -> los primeros 8 caracteres, para mostrarlo sin ocupar media pantalla. */
export function idCorto(id) {
  return String(id ?? "").split("-")[0].slice(0, 8);
}
