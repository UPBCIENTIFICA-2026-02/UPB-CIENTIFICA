package com.cluster.common;

import java.io.Serializable;
import java.util.List;

/**
 * ObtenerEstadoCluster + ObtenerEstadoCola (Contrato_HPC §3.9). Lo consultan
 * la pestaña HPC de los clientes y el monitoreo.
 *
 * {@code ejecutorConectado}: si job-runner (hpc-master) responde. Sin él los
 * trabajos esperan en cola en vez de fallar.
 */
public record EstadoCluster(int nodosTotales, int nodosDisponibles, int nodosEnFalla,
                            double capacidadUsoActual, int procesosTotales, int procesosEnUso,
                            int trabajosEnCola, int trabajosEjecutando,
                            long tiempoEsperaPromedioEstimadoSegundos,
                            boolean ejecutorConectado, List<NodoCluster> nodos)
        implements Serializable {
}
