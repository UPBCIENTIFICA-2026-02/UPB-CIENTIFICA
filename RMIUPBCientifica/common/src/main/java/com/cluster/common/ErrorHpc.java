package com.cluster.common;

/**
 * Excepción de dominio lanzada cuando se solicita una operación sobre un
 * {@code jobId} que no existe en el registro de {@code gestor-cluster}.
 *
 * Es checked y viaja por RMI: forma parte de la firma de
 * {@code getJobStatus}, {@code getJob} y {@code cancelJob} en
 * {@link JobService}. Al extender {@link Exception} ya es {@code Serializable}
 * de forma transitiva (vía {@link Throwable}), por lo que puede cruzar la
 * frontera RMI sin declaraciones adicionales.
 */
public class JobNoEncontradoException extends Exception {

    private static final long serialVersionUID = 1L;

    public JobNoEncontradoException(String jobId) {
        super("No existe ningún trabajo con id: " + jobId);
    }
}
