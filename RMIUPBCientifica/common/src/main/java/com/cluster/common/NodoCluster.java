package com.cluster.common;

import java.io.Serializable;

/**
 * Entidad NodoCluster (Contrato_HPC §4).
 *
 * {@code origen} distingue las máquinas del laboratorio de los equipos que se
 * suman a la malla (Grid) desde fuera. El enunciado pide integrar
 * "computadoras, dispositivos móviles e IoT ... tanto desde su centro de cómputo
 * como de forma externa": un nodo externo es cualquier equipo con OpenMPI, la
 * llave SSH del clúster y /srv/home montado, que se registra con RegistrarNodo.
 */
public record NodoCluster(String id, Estado estado, int capacidadProcesos, int cargaActual,
                          Origen origen) implements Serializable {

    public enum Estado { DISPONIBLE, OCUPADO, EN_FALLA }

    public enum Origen { LABORATORIO, EXTERNO }

    /** Slots que todavía se pueden asignar. Un nodo en falla no ofrece ninguno. */
    public int libres() {
        return estado == Estado.EN_FALLA ? 0 : Math.max(0, capacidadProcesos - cargaActual);
    }
}
