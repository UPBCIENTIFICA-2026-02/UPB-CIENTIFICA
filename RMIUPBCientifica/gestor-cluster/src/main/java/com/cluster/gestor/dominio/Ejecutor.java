package com.cluster.gestor.dominio;

import com.cluster.common.EstadoEjecucion;
import com.cluster.common.OrdenEjecucion;

import java.util.List;
import java.util.Map;

/**
 * El Cluster MPI visto desde el dominio: lo implementa datos/EjecutorRmi contra
 * job-runner (hpc-master). Mismas operaciones que el contrato interno
 * {@link com.cluster.common.EjecutorMpi}, sin tipos de java.rmi.
 */
public interface Ejecutor {

    /** job-runner no responde. Los trabajos esperan en cola en vez de fallar. */
    class NoDisponible extends Exception {
        public NoDisponible(String mensaje, Throwable causa) {
            super(mensaje, causa);
        }
    }

    boolean disponible();

    void iniciar(OrdenEjecucion orden) throws NoDisponible;

    EstadoEjecucion consultar(String trabajoId) throws NoDisponible;

    String logs(String trabajoId, int maxBytes) throws NoDisponible;

    Map<String, byte[]> resultados(String trabajoId) throws NoDisponible;

    void cancelar(String trabajoId) throws NoDisponible;

    void limpiar(String trabajoId) throws NoDisponible;

    List<String> nodosSinRespuesta(List<String> hosts) throws NoDisponible;
}
