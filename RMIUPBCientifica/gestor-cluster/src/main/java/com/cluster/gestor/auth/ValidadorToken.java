package com.cluster.gestor.auth;

/**
 * Patrón Strategy para la validación de token, igual que en node-repository,
 * node-media y node-sync: {@code ValidadorSimulado} en desarrollo,
 * {@code ValidadorSoap} contra node-soap en producción.
 *
 * Se elige en el composition root ({@code Main}), en un solo sitio.
 */
public interface ValidadorToken {

    /**
     * @return el usuario autenticado, o {@code null} si el token no es válido
     * @throws AuthNoDisponibleException si no se pudo consultar a Authentication
     *         Service. Es distinto de devolver null: "no pude comprobarlo" no es
     *         lo mismo que "no vale", y confundirlos haría que el cliente
     *         descartara una sesión que sigue siendo buena.
     */
    Usuario validar(String token) throws AuthNoDisponibleException;
}
