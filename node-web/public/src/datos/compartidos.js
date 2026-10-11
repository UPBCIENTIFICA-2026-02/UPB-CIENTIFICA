/*
 * Shared File — equivalente a data/sharedfile/ del móvil.
 *
 * >>> NOTA PARA EL PROGRAMADOR DEL SERVIDOR (Shared File) <<<
 * Rutas esperadas en la pasarela (las mismas de SharedFileApi.kt):
 *   POST   /api/shared-file/compartir            { archivoId, destinatarioUsuarioId, destinatarioGrupoId, permisoUnix } -> { compartidoId }
 *   GET    /api/shared-file/compartidos-conmigo  -> [{ compartidoId, archivoId, nombreArchivo, propietario, permisoUnix }]
 *   DELETE /api/shared-file/compartir/{id}
 *
 * Hoy ningún servicio responde esas rutas. Mientras config.SHARED_FILE_DISPONIBLE
 * sea false se usan datos de ejemplo, y la pantalla lo dice.
 */

import { config } from "../config.js";
import { pedir } from "../red/clienteApi.js";
import { esDemo } from "../sesion/sesion.js";
import { compartidosDemo } from "./demo.js";

const real = {
  compartidosConmigo: () => pedir("/shared-file/compartidos-conmigo"),
  compartir: (solicitud) => pedir("/shared-file/compartir", { metodo: "POST", cuerpo: solicitud }),
  revocar: (id) => pedir(`/shared-file/compartir/${encodeURIComponent(id)}`, { metodo: "DELETE", como: "nada" }),
};

/** true cuando lo que se muestra NO viene del servidor. */
export const compartidosSimulados = () => esDemo() || !config.SHARED_FILE_DISPONIBLE;

const fuente = () => (compartidosSimulados() ? compartidosDemo : real);

export const compartidos = {
  compartidosConmigo: () => fuente().compartidosConmigo(),
  compartir: (solicitud) => fuente().compartir(solicitud),
  revocar: (id) => fuente().revocar(id),
};
