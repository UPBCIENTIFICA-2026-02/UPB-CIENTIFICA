package com.cluster.api.exception;

/**
 * Envuelve cualquier fallo de infraestructura RMI (registry no disponible,
 * conexión perdida, servicio no encontrado) en una excepción unchecked
 * propia de {@code job-api}. Se traduce siempre a HTTP 503 en
 * {@link com.cluster.api.exception.GlobalExceptionHandler}.
 *
 * Se maneja internamente en job-api (no es una excepción de dominio del
 * contrato RMI): representa "no pude hablar con gestor-cluster", no un
 * error de negocio del trabajo en sí.
 */
public class RmiNoDisponibleException extends RuntimeException {

    public RmiNoDisponibleException(String mensaje, Throwable causa) {
        super(mensaje, causa);
    }
}
