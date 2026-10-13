package com.cluster.common;

import java.io.Serializable;
import java.time.Instant;

/**
 * ObtenerResultado (Contrato_HPC §3.3): la REFERENCIA al resultado en el Home
 * del usuario, nunca su contenido (no se satura el canal RMI); el cliente lo
 * descarga de Storage. {@code incompleto} = salida parcial de un FALLIDO_TIMEOUT.
 */
public record ResultadoTrabajo(String trabajoId, String rutaResultado, long tamanoBytes,
                               Instant fecha, Integer codigoSalida, boolean incompleto)
        implements Serializable {
}
