package com.cluster.api.controller;

import com.cluster.common.NoAutorizadoException;

/**
 * Extrae el token de {@code Authorization: Bearer ...}. Si falta se responde
 * igual que si fuera inválido (401): quien decide qué token vale es el gestor.
 */
final class Tokens {

    private static final String PREFIJO = "Bearer ";

    private Tokens() {
    }

    static String de(String cabecera) throws NoAutorizadoException {
        if (cabecera == null || !cabecera.startsWith(PREFIJO)) {
            throw NoAutorizadoException.tokenInvalido();
        }
        String token = cabecera.substring(PREFIJO.length()).trim();
        if (token.isEmpty()) {
            throw NoAutorizadoException.tokenInvalido();
        }
        return token;
    }
}
