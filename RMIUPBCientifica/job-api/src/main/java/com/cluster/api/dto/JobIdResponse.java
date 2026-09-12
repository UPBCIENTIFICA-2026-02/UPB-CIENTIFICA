package com.cluster.api.dto;

/** Respuesta de {@code POST /jobs}: solo el identificador generado. */
public class JobIdResponse {

    private final String id;

    public JobIdResponse(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }
}
