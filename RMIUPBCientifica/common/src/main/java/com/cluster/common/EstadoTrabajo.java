package com.cluster.common;

/**
 * Estados de un trabajo HPC, con los nombres de Contrato_HPC §3.2 y §4.
 *
 * ANTES eran QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED: no distinguían un
 * trabajo que se pasó de tiempo de uno que falló, ni un resultado calculado que
 * todavía no se pudo guardar en Storage.
 */
public enum EstadoTrabajo {
    /** Recibido y validado; aún no entra a la cola. */
    PENDIENTE,
    /** Esperando nodos libres en la cola del planificador. */
    EN_COLA,
    /** Compilándose o ejecutándose con mpirun en los nodos asignados. */
    EJECUTANDO,
    /** Terminó con código 0 y el resultado ya está en el Home del usuario. */
    COMPLETADO,
    /** Terminó bien pero Storage no respondió: se reintenta guardar el resultado. */
    COMPLETADO_PENDIENTE_ALMACENAMIENTO,
    /** No compiló, terminó con código distinto de 0 o no se pudo lanzar. */
    FALLIDO,
    /** Superó tiempoMaximoEjecucion; la salida parcial se conserva marcada como incompleta. */
    FALLIDO_TIMEOUT,
    /** El usuario lo canceló antes de que terminara. */
    CANCELADO
}
