package com.cluster.common;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Regla única de la máquina de estados de un {@link Job}. Se centraliza aquí
 * (en {@code common}) en lugar de duplicarla en {@code gestor-cluster} para
 * que el mismo comportamiento pueda ser probado de forma aislada y sea
 * imposible que servidor y pruebas diverjan en la definición de qué
 * transición es válida.
 */
public final class JobStatusTransition {

    private static final Map<JobStatus, Set<JobStatus>> TRANSICIONES_VALIDAS = new EnumMap<>(JobStatus.class);

    static {
        TRANSICIONES_VALIDAS.put(JobStatus.QUEUED, EnumSet.of(JobStatus.RUNNING, JobStatus.CANCELLED));
        TRANSICIONES_VALIDAS.put(JobStatus.RUNNING, EnumSet.of(JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED));
        TRANSICIONES_VALIDAS.put(JobStatus.COMPLETED, EnumSet.noneOf(JobStatus.class));
        TRANSICIONES_VALIDAS.put(JobStatus.FAILED, EnumSet.noneOf(JobStatus.class));
        TRANSICIONES_VALIDAS.put(JobStatus.CANCELLED, EnumSet.noneOf(JobStatus.class));
    }

    private JobStatusTransition() {
    }

    /**
     * Indica si es válido pasar del estado {@code actual} al estado {@code nuevo}.
     */
    public static boolean esValida(JobStatus actual, JobStatus nuevo) {
        if (actual == null || nuevo == null) {
            return false;
        }
        return TRANSICIONES_VALIDAS.get(actual).contains(nuevo);
    }

    /**
     * Indica si el estado es terminal (no admite ninguna transición saliente).
     */
    public static boolean esTerminal(JobStatus estado) {
        return TRANSICIONES_VALIDAS.get(estado).isEmpty();
    }
}
