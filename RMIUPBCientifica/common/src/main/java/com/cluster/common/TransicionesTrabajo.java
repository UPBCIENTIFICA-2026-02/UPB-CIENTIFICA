package com.cluster.common;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Regla única de la máquina de estados de un {@link TrabajoHpc}. Vive en
 * {@code common} para que el gestor y las pruebas usen exactamente la misma.
 *
 * <pre>
 * PENDIENTE -> EN_COLA -> EJECUTANDO -> COMPLETADO
 *                                    -> COMPLETADO_PENDIENTE_ALMACENAMIENTO -> COMPLETADO
 *                                    -> FALLIDO | FALLIDO_TIMEOUT
 * PENDIENTE | EN_COLA | EJECUTANDO -> CANCELADO
 * EJECUTANDO -> EN_COLA   (un nodo asignado falló antes de arrancar: se reasigna)
 * </pre>
 */
public final class TransicionesTrabajo {

    private static final Map<EstadoTrabajo, Set<EstadoTrabajo>> VALIDAS = new EnumMap<>(EstadoTrabajo.class);

    static {
        VALIDAS.put(EstadoTrabajo.PENDIENTE, EnumSet.of(EstadoTrabajo.EN_COLA, EstadoTrabajo.CANCELADO));
        VALIDAS.put(EstadoTrabajo.EN_COLA, EnumSet.of(EstadoTrabajo.EJECUTANDO, EstadoTrabajo.CANCELADO));
        VALIDAS.put(EstadoTrabajo.EJECUTANDO, EnumSet.of(
                EstadoTrabajo.COMPLETADO, EstadoTrabajo.COMPLETADO_PENDIENTE_ALMACENAMIENTO,
                EstadoTrabajo.FALLIDO, EstadoTrabajo.FALLIDO_TIMEOUT,
                EstadoTrabajo.CANCELADO, EstadoTrabajo.EN_COLA));
        VALIDAS.put(EstadoTrabajo.COMPLETADO_PENDIENTE_ALMACENAMIENTO, EnumSet.of(EstadoTrabajo.COMPLETADO));
        VALIDAS.put(EstadoTrabajo.COMPLETADO, EnumSet.noneOf(EstadoTrabajo.class));
        VALIDAS.put(EstadoTrabajo.FALLIDO, EnumSet.noneOf(EstadoTrabajo.class));
        VALIDAS.put(EstadoTrabajo.FALLIDO_TIMEOUT, EnumSet.noneOf(EstadoTrabajo.class));
        VALIDAS.put(EstadoTrabajo.CANCELADO, EnumSet.noneOf(EstadoTrabajo.class));
    }

    private TransicionesTrabajo() {
    }

    public static boolean esValida(EstadoTrabajo actual, EstadoTrabajo nuevo) {
        if (actual == null || nuevo == null) {
            return false;
        }
        return VALIDAS.get(actual).contains(nuevo);
    }

    /** Sin transiciones de salida. COMPLETADO_PENDIENTE_ALMACENAMIENTO no lo es: aún se guarda. */
    public static boolean esTerminal(EstadoTrabajo estado) {
        return VALIDAS.get(estado).isEmpty();
    }

    /** Solo se cancela lo que todavía no terminó (Contrato_HPC §3.4, HPC-105). */
    public static boolean esCancelable(EstadoTrabajo estado) {
        return esValida(estado, EstadoTrabajo.CANCELADO);
    }

    /** ReintentarTrabajo solo aplica a FALLIDO y FALLIDO_TIMEOUT (§3.6, HPC-107). */
    public static boolean esReintentable(EstadoTrabajo estado) {
        return estado == EstadoTrabajo.FALLIDO || estado == EstadoTrabajo.FALLIDO_TIMEOUT;
    }
}
