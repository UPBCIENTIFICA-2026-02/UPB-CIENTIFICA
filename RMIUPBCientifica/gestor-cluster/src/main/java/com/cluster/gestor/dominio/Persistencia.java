package com.cluster.gestor.dominio;

import com.cluster.common.NodoCluster;
import com.cluster.common.TrabajoHpc;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * Estado del gestor que tiene que sobrevivir a un reinicio.
 *
 * ANTES todo vivía en un ConcurrentHashMap: reiniciar el gestor perdía la cola,
 * el historial y los resultados (pendiente 7.3 de TRASPASO).
 */
public interface Persistencia {

    record Instantanea(List<TrabajoHpc> trabajos, Map<String, String> logs,
                       List<NodoCluster> nodosExternos) implements Serializable {
    }

    void guardar(Instantanea instantanea);

    /** null si no hay nada guardado. */
    Instantanea cargar();
}
