package com.cluster.api.dto;

import com.cluster.common.Job;
import com.cluster.common.JobStatus;

import java.time.Instant;

/**
 * Representación HTTP de un {@link Job}. Se desacopla deliberadamente del
 * modelo de transporte RMI: así, un cambio futuro en el DTO REST (por
 * ejemplo, renombrar un campo para el frontend) no obliga a tocar el
 * contrato RMI compartido, y viceversa.
 */
public class JobResponse {

    private final String id;
    private final String nombre;
    private final String comando;
    private final int prioridad;
    private final JobStatus estado;
    private final Instant fechaCreacion;
    private final Instant fechaInicio;
    private final Instant fechaFin;
    private final String resultado;
    private final String mensajeError;

    private JobResponse(Job job) {
        this.id = job.getId();
        this.nombre = job.getNombre();
        this.comando = job.getComando();
        this.prioridad = job.getPrioridad();
        this.estado = job.getEstado();
        this.fechaCreacion = job.getFechaCreacion();
        this.fechaInicio = job.getFechaInicio();
        this.fechaFin = job.getFechaFin();
        this.resultado = job.getResultado();
        this.mensajeError = job.getMensajeError();
    }

    public static JobResponse desde(Job job) {
        return new JobResponse(job);
    }

    public String getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public String getComando() {
        return comando;
    }

    public int getPrioridad() {
        return prioridad;
    }

    public JobStatus getEstado() {
        return estado;
    }

    public Instant getFechaCreacion() {
        return fechaCreacion;
    }

    public Instant getFechaInicio() {
        return fechaInicio;
    }

    public Instant getFechaFin() {
        return fechaFin;
    }

    public String getResultado() {
        return resultado;
    }

    public String getMensajeError() {
        return mensajeError;
    }
}
