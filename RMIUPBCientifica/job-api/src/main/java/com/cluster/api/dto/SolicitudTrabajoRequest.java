package com.cluster.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * Cuerpo esperado en {@code POST /jobs}. La validación de formato (campos
 * obligatorios, rango de prioridad) ocurre aquí, en la capa HTTP, ANTES de
 * cruzar la frontera RMI; la validación semántica adicional vive en
 * {@code gestor-cluster} (JobServiceImpl), como segunda línea de defensa.
 */
public class SubmitJobRequest {

    @NotBlank(message = "El nombre del trabajo es obligatorio")
    private String nombre;

    @NotBlank(message = "El comando del trabajo es obligatorio")
    private String comando;

    @Min(value = 1, message = "La prioridad mínima es 1")
    @Max(value = 10, message = "La prioridad máxima es 10")
    private int prioridad = 5;

    public SubmitJobRequest() {
    }

    public String getNombre() {
        return nombre;
    }

    public void setNombre(String nombre) {
        this.nombre = nombre;
    }

    public String getComando() {
        return comando;
    }

    public void setComando(String comando) {
        this.comando = comando;
    }

    public int getPrioridad() {
        return prioridad;
    }

    public void setPrioridad(int prioridad) {
        this.prioridad = prioridad;
    }
}
