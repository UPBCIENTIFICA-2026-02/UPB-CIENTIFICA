package com.cluster.gestor.dominio;

import com.cluster.common.TrabajoHpc;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Cola del Scheduler (Contrato_HPC §3.7 EncolarTrabajo): prioridad con
 * ENVEJECIMIENTO. La prioridad efectiva es el peso de la prioridad (BAJA 0,
 * NORMAL 1, ALTA 2) más un punto por cada {@code envejecimiento} de espera: un
 * trabajo NORMAL que espera lo bastante pasa delante de los ALTA nuevos y no se
 * queda sin turno.
 *
 * ANTES: PriorityBlockingQueue con prioridad fija de 1 a 10; un flujo constante
 * de trabajos de prioridad 10 dejaba a los demás esperando para siempre.
 *
 * El orden se recalcula al pedirlo porque la prioridad efectiva cambia con el
 * tiempo. Con colas de decenas de trabajos ordenar es despreciable.
 *
 * No es thread-safe: el gestor la usa bajo su propio candado.
 */
public final class Planificador {

    private final Duration envejecimiento;
    private final List<TrabajoHpc> cola = new ArrayList<>();

    public Planificador(Duration envejecimiento) {
        this.envejecimiento = envejecimiento;
    }

    public void encolar(TrabajoHpc t) {
        if (!cola.contains(t)) {
            cola.add(t);
        }
    }

    public boolean quitar(TrabajoHpc t) {
        return cola.remove(t);
    }

    public int tamano() {
        return cola.size();
    }

    public long prioridadEfectiva(TrabajoHpc t, Instant ahora) {
        long espera = Math.max(0, Duration.between(t.getFechaEnvio(), ahora).toSeconds());
        return t.getPrioridad().peso() + espera / Math.max(1, envejecimiento.toSeconds());
    }

    /** Trabajos en el orden en que se intentará asignarles nodos. */
    public List<TrabajoHpc> enOrden(Instant ahora) {
        List<TrabajoHpc> copia = new ArrayList<>(cola);
        copia.sort(Comparator
                .comparingLong((TrabajoHpc t) -> prioridadEfectiva(t, ahora)).reversed()
                .thenComparing(TrabajoHpc::getFechaEnvio));
        return copia;
    }

    /** Posición (1 = el siguiente); 0 si no está en la cola. */
    public int posicion(TrabajoHpc t, Instant ahora) {
        return enOrden(ahora).indexOf(t) + 1;
    }
}
