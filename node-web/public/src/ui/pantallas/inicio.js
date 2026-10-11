/*
 * Inicio (HomeScreen.kt): saludo, franja de estado y un tile por servicio.
 *
 * Diferencia con el móvil: la franja del móvil resume File Sync. La web no
 * sincroniza carpetas, así que la franja resume lo que la web sí sabe: si
 * hay conexión con el servidor y cuánto espacio queda.
 */

import { icono } from "../iconos.js";
import { esc, formatearTamano, saludo } from "../formato.js";
import { barra, encabezadoSeccion } from "../componentes/basicos.js";
import { accionesCuenta, conectarCuenta } from "../componentes/cuenta.js";
import { abrirDialogo } from "../componentes/superpuestos.js";
import { config } from "../../config.js";
import { sesionActual, esDemo } from "../../sesion/sesion.js";
import { almacenamiento } from "../../datos/almacenamiento.js";
import { estadoConexion, alCambiarConexion } from "../../datos/conexion.js";

/** Un tile por servicio; cada uno lleva a su pestaña (lista `servicios` de HomeScreen.kt). */
const SERVICIOS = [
  { nombre: "Mis archivos", descripcion: "Tu almacenamiento personal", icono: "carpetaActiva", destino: "archivos", color: "c-primary" },
  { nombre: "Compartidos", descripcion: "Lo que otros compartieron contigo", icono: "compartidos", destino: "compartidos", color: "c-secondary" },
  { nombre: "Streaming", descripcion: "Videos y material audiovisual", icono: "streaming", destino: "streaming", color: "c-tertiary" },
  { nombre: "Cómputo HPC", descripcion: "Lanza y sigue trabajos en el clúster", icono: "hpc", destino: "hpc", color: "c-inverse" },
  { nombre: "Fotos", descripcion: "Explora, ordena y presenta tus imágenes", icono: "fotos", destino: "fotos", color: "c-primary" },
  { nombre: "Monitoreo", descripcion: "Uso de recursos y estado de los servicios", icono: "monitoreo", destino: null, color: "c-secondary" },
];

export function montar(contenedor, { navegar }) {
  const usuario = sesionActual()?.usuario ?? "";
  contenedor.innerHTML = `
    <section class="inicio">
      <div class="inicio-cabecera">
        <span class="logo-circulo marca-inicio">${icono("nube")}</span>
        <span class="nombre t-title-l marca-inicio">UPB-Científica</span>
        <span class="acciones-cuenta">${accionesCuenta()}</span>
      </div>

      <h1 class="saludo t-headline-s">${esc(saludo())}, ${esc(usuario)}</h1>
      <p class="t-body-l atenuado">¿Qué quieres hacer hoy?</p>

      <div class="franja" data-franja></div>

      <div style="margin:16px -16px 0">${encabezadoSeccion("Servicios")}</div>
      <div class="rejilla-servicios">
        ${SERVICIOS.map((s, i) => `
          <button type="button" class="tarjeta-servicio ${s.color}" data-servicio="${i}">
            <span class="burbuja">${icono(s.icono)}</span>
            <span class="nombre t-title-m">${esc(s.nombre)}</span>
            <span class="desc t-body-s">${esc(s.descripcion)}</span>
          </button>`).join("")}
      </div>
    </section>`;

  conectarCuenta(contenedor);

  contenedor.querySelectorAll("[data-servicio]").forEach((tile) =>
    tile.addEventListener("click", () => {
      const s = SERVICIOS[Number(tile.dataset.servicio)];
      if (s.destino) navegar(s.destino);
      else abrirMonitoreo();
    })
  );

  const franja = contenedor.querySelector("[data-franja]");
  let cuota = null;

  function pintarFranja() {
    const estado = esDemo() ? "demo" : estadoConexion();
    const aspecto = {
      demo: { icono: "nubeSync", color: "var(--tertiary)", titulo: "Modo demostración", detalle: "Los datos son de ejemplo; nada se envía al servidor" },
      ok: { icono: "nubeOk", color: "var(--exito)", titulo: "Conectado", detalle: "Tus servicios están disponibles" },
      off: { icono: "nubeOff", color: "var(--error)", titulo: "Sin conexión", detalle: "No hay respuesta del servidor; revisa la red" },
      desconocido: { icono: "nubeSync", color: "var(--primary)", titulo: "Comprobando la conexión…", detalle: "Un momento" },
    }[estado];
    const fraccion = cuota && cuota.cuota ? cuota.usados / cuota.cuota : null;
    const detalle = cuota ? `${formatearTamano(cuota.usados)} de ${formatearTamano(cuota.cuota)} usados · ${aspecto.detalle}` : aspecto.detalle;
    franja.innerHTML = `
      <div class="franja-fila">
        <span style="color:${aspecto.color};display:grid">${icono(aspecto.icono)}</span>
        <div><p class="t-title-s">${esc(aspecto.titulo)}</p><p class="t-body-s atenuado">${esc(detalle)}</p></div>
      </div>
      ${fraccion !== null ? barra(fraccion, { color: fraccion > 0.9 ? "var(--error)" : null }) : ""}`;
  }

  pintarFranja();
  almacenamiento.cuota().then((c) => { cuota = c; pintarFranja(); }).catch(() => {});
  const quitar = alCambiarConexion(pintarFranja);
  return () => quitar();
}

/** El tablero de monitoreo es Grafana (node-monitoreo); se abre aparte. */
function abrirMonitoreo() {
  if (!esDemo()) {
    window.open(config.URL_MONITOREO, "_blank", "noopener");
    return;
  }
  const d = abrirDialogo(`
    <div class="icono-dialogo">${icono("monitoreo")}</div>
    <h2 class="t-headline-s" style="text-align:center">Monitoreo</h2>
    <p class="t-body-m">En el despliegue, este acceso abre los tableros de Grafana de
    <strong>node-monitoreo</strong>: ocupación de CPU, memoria y almacenamiento de cada
    nodo, carga de trabajos del clúster, históricos y alertas.</p>
    <p class="t-body-m" style="margin-top:12px">En modo demostración no hay un Grafana al cual conectarse.</p>
    <div class="dialogo-acciones"><button class="boton boton-texto" data-ok>Entendido</button></div>`, "dialogo chico");
  d.querySelector("[data-ok]").addEventListener("click", () => d.close());
}
