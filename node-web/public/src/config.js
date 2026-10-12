/*
 * Único lugar donde se configura el cliente web (equivalente a
 * network/Configuracion.kt del móvil).
 *
 * El navegador NO habla con cada servicio por separado: todo pasa por
 * node-web, que es la pasarela del cliente web en el diagrama de despliegue
 * (un navegador no puede hablar SOAP, RMI ni gRPC). Por eso basta con una
 * sola dirección base, relativa: el mismo node-web que entrega esta página
 * atiende /api en el mismo origen, sin CORS.
 *
 * Para cambiar algún valor sin tocar este archivo, defínelo en index.html:
 *   <script>window.UPBC_CONFIG = { URL_MONITOREO: "https://10.0.0.26:3000" }</script>
 */

const valoresPorDefecto = {
  /** Prefijo de la pasarela en node-web. Ver docs/PASARELA.md. */
  API_BASE: "/api",

  /**
   * Shared File Service (node-shared-file, puerto 8085, VM node-repository),
   * reenviado por node-web bajo /api/shared-file. En false, la pestaña
   * Compartidos usa datos de ejemplo y lo dice en pantalla.
   */
  SHARED_FILE_DISPONIBLE: true,

  /** Tablero de Grafana (node-monitoreo). Se abre en una pestaña nueva. */
  URL_MONITOREO: "/monitoreo/",

  /** Cada cuánto se refresca la pestaña HPC mientras está abierta. */
  INTERVALO_HPC_MS: 3000,

  /** Sin un tiempo máximo, una VM apagada deja la interfaz colgada. */
  TIEMPO_ESPERA_MS: 15000,

  /** Muestra el botón "Entrar en modo demostración" en el inicio de sesión. */
  PERMITIR_DEMO: true,
};

export const config = Object.freeze({ ...valoresPorDefecto, ...(window.UPBC_CONFIG || {}) });
