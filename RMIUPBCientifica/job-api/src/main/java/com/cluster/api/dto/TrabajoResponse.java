package com.cluster.api.dto;

import com.cluster.common.EstadoTrabajo;
import com.cluster.common.Prioridad;
import com.cluster.common.TrabajoHpc;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Representación HTTP de un TrabajoHPC (Contrato_HPC §4). Desacoplada del
 * objeto RMI: renombrar algo aquí no obliga a tocar el contrato RMI.
 */
public record TrabajoResponse(
        String id,
        String nombreTrabajo,
        String rutaCodigo,
        String rutaDataset,
        int numeroProcesos,
        int tiempoMaximoEjecucion,
        Prioridad prioridad,
        Map<String, String> parametrosEjecucion,
        EstadoTrabajo estado,
        int posicionCola,
        List<String> nodosAsignados,
        Instant fechaEnvio,
        Instant fechaInicio,
        Instant fechaFin,
        Integer codigoSalida,
        String rutaResultado,
        long tamanoResultadoBytes,
        boolean resultadoIncompleto,
        String mensajeError,
        String trabajoOriginalId) {

    public static TrabajoResponse desde(TrabajoHpc t) {
        return new TrabajoResponse(t.getId(), t.getNombreTrabajo(), t.getRutaCodigo(), t.getRutaDataset(),
                t.getNumeroProcesos(), t.getTiempoMaximoEjecucion(), t.getPrioridad(), t.getParametrosEjecucion(),
                t.getEstado(), t.getPosicionCola(), t.getNodosAsignados(), t.getFechaEnvio(), t.getFechaInicio(),
                t.getFechaFin(), t.getCodigoSalida(), t.getRutaResultado(), t.getTamanoResultadoBytes(),
                t.isResultadoIncompleto(), t.getMensajeError(), t.getTrabajoOriginalId());
    }
}
