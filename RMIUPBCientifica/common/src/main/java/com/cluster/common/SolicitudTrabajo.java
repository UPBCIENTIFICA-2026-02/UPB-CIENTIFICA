package com.cluster.common;

import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Parámetros de EnviarTrabajo (Contrato_HPC §3.1).
 *
 * El trabajo es CÓDIGO FUENTE Y DATASET guardados en Storage, no un comando de
 * shell. ANTES el gestor recibía {@code comando} y lo ejecutaba con
 * {@code bash -c} en su propia máquina: no había MPI ni clúster, y cualquier
 * usuario autenticado ejecutaba lo que quisiera (riesgo V-11).
 *
 * {@code rutaCodigo} y {@code rutaDataset} aceptan una ruta dentro del Home
 * ("/Proyectos/pi.c") o el identificador del nodo en Storage (lo que entrega el
 * explorador de archivos, y lo único que sirve para algo compartido por otro).
 */
public class SolicitudTrabajo implements Serializable {

    private static final long serialVersionUID = 1L;

    private final String nombreTrabajo;
    private final String rutaCodigo;
    private final String rutaDataset;
    private final int numeroProcesos;
    private final int tiempoMaximoEjecucion;
    private final Prioridad prioridad;
    private final LinkedHashMap<String, String> parametrosEjecucion;

    public SolicitudTrabajo(String nombreTrabajo, String rutaCodigo, String rutaDataset,
                            int numeroProcesos, int tiempoMaximoEjecucion, Prioridad prioridad,
                            Map<String, String> parametrosEjecucion) {
        this.nombreTrabajo = nombreTrabajo;
        this.rutaCodigo = rutaCodigo;
        this.rutaDataset = (rutaDataset == null || rutaDataset.isBlank()) ? null : rutaDataset;
        this.numeroProcesos = numeroProcesos;
        this.tiempoMaximoEjecucion = tiempoMaximoEjecucion;
        this.prioridad = prioridad == null ? Prioridad.NORMAL : prioridad;
        this.parametrosEjecucion = parametrosEjecucion == null
                ? new LinkedHashMap<>() : new LinkedHashMap<>(parametrosEjecucion);
    }

    public String getNombreTrabajo() { return nombreTrabajo; }
    public String getRutaCodigo() { return rutaCodigo; }
    public String getRutaDataset() { return rutaDataset; }
    public int getNumeroProcesos() { return numeroProcesos; }
    public int getTiempoMaximoEjecucion() { return tiempoMaximoEjecucion; }
    public Prioridad getPrioridad() { return prioridad; }
    public Map<String, String> getParametrosEjecucion() { return new LinkedHashMap<>(parametrosEjecucion); }
}
