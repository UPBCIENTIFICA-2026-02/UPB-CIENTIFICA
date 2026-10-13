package com.cluster.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * POST /cluster/nodos — suma un equipo a la malla (Grid). {@code externo}
 * por defecto true: lo normal es registrar equipos de fuera del laboratorio.
 */
public record NodoRequest(
        @NotBlank(message = "host es obligatorio") String host,
        @Min(value = 1, message = "capacidadProcesos mínimo es 1")
        @Max(value = 256, message = "capacidadProcesos máximo es 256") int capacidadProcesos,
        Boolean externo) {

    public boolean esExterno() {
        return externo == null || externo;
    }
}
