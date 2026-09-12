package com.cluster.api.dto;

import com.cluster.common.JobStatus;

/** Respuesta de {@code GET /jobs/{id}/estado}. */
public class JobStatusResponse {

    private final String id;
    private final JobStatus estado;

    public JobStatusResponse(String id, JobStatus estado) {
        this.id = id;
        this.estado = estado;
    }

    public String getId() {
        return id;
    }

    public JobStatus getEstado() {
        return estado;
    }
}
