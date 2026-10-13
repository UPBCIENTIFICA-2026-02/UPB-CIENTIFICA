package com.cluster.gestor.dominio;

import com.cluster.common.NodoCluster;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AsignarNodos (Contrato_HPC §3.8). Regla del contrato: "debe considerar la
 * carga actual de cada nodo, no solo disponibilidad binaria", para no
 * concentrar todo en los primeros nodos libres.
 *
 * Reparte proceso a proceso: cada uno va al nodo con menor ocupación relativa
 * ((carga + lo ya asignado) / capacidad). Un trabajo de 4 procesos en cuatro
 * nodos vacíos queda 1+1+1+1, no 2+2 en los dos primeros.
 *
 * Función pura: recibe una instantánea de los nodos y no modifica nada.
 */
public final class AsignadorNodos {

    private AsignadorNodos() {
    }

    /**
     * @return host -> procesos en ese host, en el orden de los nodos; o null si
     *         ahora no hay slots libres suficientes (HPC-201: el trabajo sigue en
     *         cola, no es un error).
     */
    public static Map<String, Integer> asignar(List<NodoCluster> nodos, int procesos) {
        int libresTotal = nodos.stream().mapToInt(NodoCluster::libres).sum();
        if (procesos < 1 || libresTotal < procesos) {
            return null;
        }
        Map<String, Integer> asignacion = new LinkedHashMap<>();
        for (int i = 0; i < procesos; i++) {
            NodoCluster mejor = null;
            double mejorOcupacion = Double.MAX_VALUE;
            for (NodoCluster n : nodos) {
                int ya = asignacion.getOrDefault(n.id(), 0);
                if (n.libres() - ya <= 0) {
                    continue;
                }
                double ocupacion = (double) (n.cargaActual() + ya) / n.capacidadProcesos();
                if (ocupacion < mejorOcupacion) {
                    mejorOcupacion = ocupacion;
                    mejor = n;
                }
            }
            asignacion.merge(mejor.id(), 1, Integer::sum);
        }
        Map<String, Integer> ordenada = new LinkedHashMap<>();
        for (NodoCluster n : nodos) {
            if (asignacion.containsKey(n.id())) {
                ordenada.put(n.id(), asignacion.get(n.id()));
            }
        }
        return ordenada;
    }
}
