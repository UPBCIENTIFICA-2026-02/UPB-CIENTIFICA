package com.cluster.common;

import java.io.Serializable;

/**
 * Estados posibles de un {@link Job} dentro del ciclo de vida gestionado por
 * {@code gestor-cluster}.
 *
 * COMPLETED, FAILED y CANCELLED son estados terminales: ninguna transición
 * puede salir de ellos. La validación de transiciones se centraliza en
 * {@link JobStatusTransition} para que tanto el servidor como las pruebas
 * puedan reutilizar exactamente la misma regla.
 */
public enum JobStatus implements Serializable {
    /** Trabajo creado y a la espera de ser tomado por un worker. */
    QUEUED,
    /** El worker extrajo el trabajo de la cola y está ejecutando el comando. */
    RUNNING,
    /** El comando terminó con código de salida 0. */
    COMPLETED,
    /** El comando terminó con error o no pudo ejecutarse. */
    FAILED,
    /** El cliente solicitó la cancelación antes de que terminara. */
    CANCELLED
}
