package com.cluster.common;

import java.io.Serializable;
import java.time.Instant;

/**
 * Salida de EnviarTrabajo y de ReintentarTrabajo (Contrato_HPC §3.1 y §3.6).
 * {@code advertencia} va en los reintentos: se usa la versión ACTUAL del código.
 */
public record RespuestaEnvio(String trabajoId, EstadoTrabajo estadoInicial,
                             int posicionEstimadaCola, Instant fechaEnvio,
                             String advertencia) implements Serializable {
}
