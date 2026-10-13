package com.cluster.gestor.dominio;

import com.cluster.common.NodoCluster;
import com.cluster.common.NodoCluster.Estado;
import com.cluster.common.NodoCluster.Origen;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Nodos de la malla y su carga (entidades NodoCluster y AsignacionRecursos).
 *
 * Los del laboratorio se cargan al arrancar (HPC_NODOS); los externos se suman
 * con RegistrarNodo. Métodos sincronizados: los usan a la vez el planificador,
 * los hilos de ejecución y las llamadas RMI.
 */
public final class RegistroNodos {

    private static final class Nodo {
        final String id;
        final Origen origen;
        int capacidad;
        int carga;
        boolean enFalla;

        Nodo(String id, int capacidad, Origen origen) {
            this.id = id;
            this.capacidad = capacidad;
            this.origen = origen;
        }

        NodoCluster vista() {
            Estado e = enFalla ? Estado.EN_FALLA : (carga >= capacidad ? Estado.OCUPADO : Estado.DISPONIBLE);
            return new NodoCluster(id, e, capacidad, carga, origen);
        }
    }

    private final Map<String, Nodo> nodos = new LinkedHashMap<>();

    /** "hpc-master:2,hpc-worker1:2" -> nodos del laboratorio. */
    public static RegistroNodos desdeConfiguracion(String lista) {
        RegistroNodos r = new RegistroNodos();
        for (String parte : lista.split(",")) {
            String p = parte.trim();
            if (p.isEmpty()) continue;
            String[] hc = p.split(":");
            int capacidad = hc.length > 1 ? Integer.parseInt(hc[1].trim()) : 1;
            r.registrar(hc[0].trim(), capacidad, Origen.LABORATORIO);
        }
        return r;
    }

    public synchronized NodoCluster registrar(String id, int capacidad, Origen origen) {
        Nodo existente = nodos.get(id);
        if (existente != null) {
            existente.capacidad = capacidad;
            existente.enFalla = false;
            return existente.vista();
        }
        Nodo n = new Nodo(id, capacidad, origen);
        nodos.put(id, n);
        return n.vista();
    }

    public synchronized boolean retirar(String id) {
        return nodos.remove(id) != null;
    }

    public synchronized List<NodoCluster> instantanea() {
        List<NodoCluster> lista = new ArrayList<>();
        nodos.values().forEach(n -> lista.add(n.vista()));
        return lista;
    }

    public synchronized List<String> ids() {
        return new ArrayList<>(nodos.keySet());
    }

    /** Procesos que caben en toda la malla, contando también los nodos en falla. */
    public synchronized int capacidadInstalada() {
        return nodos.values().stream().mapToInt(n -> n.capacidad).sum();
    }

    public synchronized void reservar(Map<String, Integer> asignacion) {
        asignacion.forEach((id, p) -> {
            Nodo n = nodos.get(id);
            if (n != null) n.carga += p;
        });
    }

    public synchronized void liberar(Map<String, Integer> asignacion) {
        asignacion.forEach((id, p) -> {
            Nodo n = nodos.get(id);
            if (n != null) n.carga = Math.max(0, n.carga - p);
        });
    }

    /** @return true si cambió de estado (para registrar el evento NodoEnFalla una sola vez). */
    public synchronized boolean marcarFalla(String id, boolean enFalla) {
        Nodo n = nodos.get(id);
        if (n == null || n.enFalla == enFalla) return false;
        n.enFalla = enFalla;
        return true;
    }
}
