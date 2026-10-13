package com.cluster.api.dto;

import java.time.Instant;

/**
 * Cuerpo de error uniforme. {@code codigo} es el código de Contrato_HPC
 * (HPC-001...) cuando el error viene del gestor; null en los demás.
 */
public record ErrorResponse(Instant timestamp, int status, String error, String codigo, String mensaje) {

    public ErrorResponse(int status, String error, String codigo, String mensaje) {
        this(Instant.now(), status, error, codigo, mensaje);
    }
}
