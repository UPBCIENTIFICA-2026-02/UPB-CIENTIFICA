package com.cluster.gestor.auth;

/**
 * No se pudo contactar con Authentication Service.
 *
 * Distinta de "token inválido" a propósito: job-api la traduce a 503, para que
 * el cliente reintente en vez de mandar al usuario a iniciar sesión otra vez.
 */
public class AuthNoDisponibleException extends Exception {

    private static final long serialVersionUID = 1L;

    public AuthNoDisponibleException(String detalle, Throwable causa) {
        super("No se pudo validar el token contra Authentication Service: " + detalle, causa);
    }

    public AuthNoDisponibleException(String detalle) {
        this(detalle, null);
    }
}
