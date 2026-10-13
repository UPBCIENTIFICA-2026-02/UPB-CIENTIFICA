package com.cluster.api.dto;

import com.cluster.common.Prioridad;
import com.cluster.common.SolicitudTrabajo;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Map;

/**
 * Cuerpo de POST /jobs: los campos de EnviarTrabajo en Contrato_HPC §3.1.
 * Validación de formato aquí; las reglas de negocio (cuota, límite de tiempo,
 * que el código exista) las aplica el gestor.
 *
 * ANTES: { nombre, comando, prioridad 1-10 }.
 */
public record SolicitudTrabajoRequest(
        @NotBlank(message = "nombreTrabajo es obligatorio")
        @Size(max = 128, message = "nombreTrabajo admite hasta 128 caracteres")
        String nombreTrabajo,
        @NotBlank(message = "rutaCodigo es obligatorio (ruta en tu Home o id de Storage)")
        String rutaCodigo,
        String rutaDataset,
        @Min(value = 1, message = "numeroProcesos mínimo es 1")
        int numeroProcesos,
        @Min(value = 1, message = "tiempoMaximoEjecucion mínimo es 1 segundo")
        int tiempoMaximoEjecucion,
        String prioridad,
        Map<String, String> parametrosEjecucion) {

    public SolicitudTrabajo aSolicitud() {
        return new SolicitudTrabajo(nombreTrabajo, rutaCodigo, rutaDataset, numeroProcesos,
                tiempoMaximoEjecucion, Prioridad.desde(prioridad), parametrosEjecucion);
    }
}
