package com.cluster.api.dto;

import com.cluster.common.EstadoTrabajo;
import com.cluster.common.TrabajoHpc;

import java.util.List;

/**
 * GET /jobs/{id}/estado — ConsultarEstadoTrabajo (Contrato_HPC §3.2).
 * {@code progreso} es null: OpenMPI no informa avance de forma general.
 */
public record EstadoTrabajoResponse(String trabajoId, EstadoTrabajo estado, Double progreso,
                                    List<String> nodosAsignados, int posicionCola, String mensajeError) {

    public static EstadoTrabajoResponse desde(TrabajoHpc t) {
        return new EstadoTrabajoResponse(t.getId(), t.getEstado(), null, t.getNodosAsignados(),
                t.getPosicionCola(), t.getMensajeError());
    }
}
