/*
 * Shared File (Contrato_SharedFile) — equivalente a data/sharedfile/ del móvil.
 *
 * El servicio es node-shared-file (puerto 8085, VM node-repository); node-web
 * lo reenvía bajo /api/shared-file. Rutas (node-shared-file/README.md):
 *   POST   /shared-file/compartir             CompartirArchivo     { archivoId, destinatarioTipo, destinatarioId, nivelPermiso }
 *   POST   /shared-file/compartir-directorio  CompartirDirectorio  { directorioId, ... }
 *   PATCH  /shared-file/compartir/{id}        ActualizarPermisosCompartidos { nuevoNivelPermiso }
 *   DELETE /shared-file/compartir/{id}        DejarDeCompartir
 *   GET    /shared-file/compartidos-conmigo   ListarCompartidosConmigo
 *   GET    /shared-file/que-yo-comparto       ListarQueYoComparto
 *
 * RelacionCompartido: { compartidoId, elementoId, elementoTipo: "ARCHIVO"|"DIRECTORIO",
 *   nombre, tamanoBytes, propietario, compartidoPor, destinatarioTipo, destinatarioId,
 *   nivelPermiso, fechaCompartido, fechaExpiracion }
 *
 * Lo que hay DENTRO de una carpeta compartida y los bytes de los archivos se
 * piden a Storage (datos/almacenamiento.js): Storage ya aplica la compartición.
 */

import { config } from "../config.js";
import { pedir } from "../red/clienteApi.js";
import { esDemo } from "../sesion/sesion.js";
import { compartidosDemo } from "./demo.js";

/** Niveles del contrato, en orden. El tercero permite volver a compartir. */
export const NIVELES = [
  { valor: "LECTURA", texto: "Solo ver" },
  { valor: "LECTURA_ESCRITURA", texto: "Ver y editar" },
  { valor: "LECTURA_ESCRITURA_COMPARTIR", texto: "Ver, editar y compartir" },
];
export const textoNivel = (valor) => NIVELES.find((n) => n.valor === valor)?.texto ?? valor;

const real = {
  compartidosConmigo: () => pedir("/shared-file/compartidos-conmigo"),
  queYoComparto: () => pedir("/shared-file/que-yo-comparto"),
  /** Archivo o carpeta: cada uno es una operación distinta del contrato. */
  compartir: (elemento, destinatarioTipo, destinatarioId, nivelPermiso) =>
    elemento.tipo === "directorio"
      ? pedir("/shared-file/compartir-directorio", {
          metodo: "POST", cuerpo: { directorioId: elemento.id, destinatarioTipo, destinatarioId, nivelPermiso },
        })
      : pedir("/shared-file/compartir", {
          metodo: "POST", cuerpo: { archivoId: elemento.id, destinatarioTipo, destinatarioId, nivelPermiso },
        }),
  cambiarNivel: (compartidoId, nuevoNivelPermiso) =>
    pedir(`/shared-file/compartir/${encodeURIComponent(compartidoId)}`, { metodo: "PATCH", cuerpo: { nuevoNivelPermiso } }),
  revocar: (compartidoId) =>
    pedir(`/shared-file/compartir/${encodeURIComponent(compartidoId)}`, { metodo: "DELETE", como: "nada" }),
};

/** true cuando lo que se muestra NO viene del servidor (modo demostración). */
export const compartidosSimulados = () => esDemo() || !config.SHARED_FILE_DISPONIBLE;

const fuente = () => (compartidosSimulados() ? compartidosDemo : real);

export const compartidos = {
  compartidosConmigo: () => fuente().compartidosConmigo(),
  queYoComparto: () => fuente().queYoComparto(),
  compartir: (elemento, tipo, destinatario, nivel) => fuente().compartir(elemento, tipo, destinatario, nivel),
  cambiarNivel: (id, nivel) => fuente().cambiarNivel(id, nivel),
  revocar: (id) => fuente().revocar(id),
};
