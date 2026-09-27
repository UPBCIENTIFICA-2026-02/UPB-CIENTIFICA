package com.cluster.gestor.auth;

import java.util.List;

/**
 * Acepta tokens "mock-token-&lt;uid&gt;-..." para desarrollo local sin la VM de
 * node-soap levantada. Debe coincidir con el validador simulado de
 * node-repository, node-media y node-sync.
 *
 * NO usar en producción: acepta cualquier token con ese prefijo, así que
 * cualquiera puede hacerse pasar por cualquier usuario.
 */
public class ValidadorSimulado implements ValidadorToken {

    private static final String PREFIJO = "mock-token-";

    @Override
    public Usuario validar(String token) {
        if (token == null || !token.startsWith(PREFIJO)) {
            return null;
        }
        String[] partes = token.split("-");
        if (partes.length < 3 || partes[2].isBlank()) {
            return null;
        }
        return new Usuario(partes[2], List.of("investigador"), List.of("usuarios"));
    }
}
