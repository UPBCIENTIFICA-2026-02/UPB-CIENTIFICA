package com.cluster.common;

import java.io.Serializable;

/**
 * Estado de una ejecución en job-runner.
 *
 * @param fase             PREPARANDO, COMPILANDO, EJECUTANDO, TERMINADO o DESCONOCIDO
 *                         (job-runner no conoce el trabajo, p. ej. porque se reinició)
 * @param codigoSalida     de mpirun (o del compilador si no compiló); null si no ha terminado
 * @param errorCompilacion el código no compiló (HPC-004)
 * @param tiempoAgotado    se terminó por superar tiempoMaximoEjecucion
 * @param cancelado        se terminó por CancelarTrabajo
 */
public record EstadoEjecucion(String fase, Integer codigoSalida, boolean errorCompilacion,
                              boolean tiempoAgotado, boolean cancelado, String mensaje)
        implements Serializable {

    public static final String PREPARANDO = "PREPARANDO";
    public static final String COMPILANDO = "COMPILANDO";
    public static final String EJECUTANDO = "EJECUTANDO";
    public static final String TERMINADO = "TERMINADO";
    public static final String DESCONOCIDO = "DESCONOCIDO";

    public boolean terminado() {
        return TERMINADO.equals(fase) || DESCONOCIDO.equals(fase);
    }
}
