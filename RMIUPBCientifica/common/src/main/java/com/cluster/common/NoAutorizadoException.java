package com.cluster.common;

/**
 * El token es inválido, falta, o el usuario autenticado no es el propietario
 * del trabajo sobre el que intenta operar.
 *
 * Es una excepción de negocio y viaja por RMI, así que forma parte de
 * {@code common} junto al resto del contrato. {@code job-api} la traduce a
 * 401 cuando no hay identidad y a 403 cuando la hay pero no alcanza.
 */
public class NoAutorizadoException extends Exception {

    private static final long serialVersionUID = 1L;

    /** true si el problema es el token; false si es de permisos sobre el recurso. */
    private final boolean sinIdentidad;

    public NoAutorizadoException(String detalle, boolean sinIdentidad) {
        super(detalle);
        this.sinIdentidad = sinIdentidad;
    }

    /** Token ausente, mal formado o rechazado por Authentication Service. */
    public static NoAutorizadoException tokenInvalido() {
        return new NoAutorizadoException("Token ausente o inválido", true);
    }

    /** El usuario está autenticado, pero el trabajo no es suyo. */
    public static NoAutorizadoException noEsPropietario(String jobId) {
        return new NoAutorizadoException(
                "El trabajo " + jobId + " pertenece a otro usuario", false);
    }

    public boolean isSinIdentidad() {
        return sinIdentidad;
    }
}
