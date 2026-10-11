/*
 * HPC Service (job-api + gestor-cluster, repositorio RMIUPBCientifica).
 *
 * El navegador no habla RMI. job-api ya es la fachada HTTP del gestor RMI, y
 * node-web la reenvía bajo la pasarela:
 *   GET    /api/jobs           -> JobResponse[] (el servidor filtra por propietario)
 *   POST   /api/jobs           { nombre, rutaCodigoFuente, rutaDataset, numeroProcesos, prioridad } -> { id }
 *   DELETE /api/jobs/{id}      -> { id, cancelado }
 *   GET    /api/cluster/estado -> { nodosVivos[], nodosEsperados, cargaPromedio, clusterCompleto, consultadoEn }
 *
 * Diferencia con la app móvil: allí el formulario pide un "comando" de shell.
 * Esta interfaz sigue Contrato_HPC: el código fuente y el dataset ya subidos a
 * Storage y cuántos procesos MPI usar; el servidor arma el mpirun.
 * OJO: el job-api actual (SubmitJobRequest.java) todavía exige "comando" y no
 * tiene /cluster/estado, así que enviar y el estado del clúster fallan hasta
 * que job-api implemente el contrato. Listar y cancelar sí funcionan.
 */

import { pedir } from "../red/clienteApi.js";
import { esDemo } from "../sesion/sesion.js";
import { hpcDemo } from "./demo.js";

const real = {
  trabajos: () => pedir("/jobs"),
  estadoCluster: () => pedir("/cluster/estado"),
  enviar: (solicitud) => pedir("/jobs", { metodo: "POST", cuerpo: solicitud, tiempo: 30_000 }),
  cancelar: (id) => pedir(`/jobs/${encodeURIComponent(id)}`, { metodo: "DELETE" }),
};

const fuente = () => (esDemo() ? hpcDemo : real);

/** Estados del enum JobStatus de Java -> lo que ve la persona. */
export const ESTADOS = {
  QUEUED: { etiqueta: "En cola", icono: "enCola", color: "var(--tertiary)", activo: true },
  RUNNING: { etiqueta: "Ejecutando", icono: "ejecutando", color: "var(--primary)", activo: true },
  COMPLETED: { etiqueta: "Completado", icono: "completado", color: "var(--exito)", activo: false },
  FAILED: { etiqueta: "Fallido", icono: "fallido", color: "var(--error)", activo: false },
  CANCELLED: { etiqueta: "Cancelado", icono: "cancelado", color: "var(--on-surface-variant)", activo: false },
};

export const hpc = {
  trabajos: () => fuente().trabajos(),
  estadoCluster: () => fuente().estadoCluster(),
  enviar: (solicitud) => fuente().enviar(solicitud),
  cancelar: (id) => fuente().cancelar(id),
};
