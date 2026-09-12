package com.cluster.common;

/**
 * Excepción de dominio lanzada cuando se solicita una operación incompatible
 * con el estado actual del trabajo (por ejemplo, cancelar un trabajo que ya
 * terminó). Es checked y forma parte de la firma de {@code cancelJob} en
 * {@link JobService}.
 */
public class EstadoInvalidoException extends Exception {

    private static final long serialVersionUID = 1L;

    public EstadoInvalidoException(String jobId, JobStatus estadoActual) {
        super("El trabajo " + jobId + " está en estado " + estadoActual
                + " y no admite la operación solicitada");
    }
}
