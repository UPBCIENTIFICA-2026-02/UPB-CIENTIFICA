package com.cluster.common;

/**
 * Prioridad de un trabajo (Contrato_HPC §3.1). Por defecto NORMAL; ALTA exige
 * el permiso "hpc:prioridad-alta", que en el directorio es el servicio
 * {@code hpcadmin} del mapa de servicios del perfil.
 *
 * ANTES: un entero de 1 a 10, sin ninguna regla sobre quién podía usar el 10.
 */
public enum Prioridad {
    BAJA(0), NORMAL(1), ALTA(2);

    /** Peso base en la cola; el envejecimiento le suma puntos con la espera. */
    private final int peso;

    Prioridad(int peso) {
        this.peso = peso;
    }

    public int peso() {
        return peso;
    }

    /** null o vacío = NORMAL; un valor desconocido es un error. */
    public static Prioridad desde(String valor) {
        if (valor == null || valor.isBlank()) {
            return NORMAL;
        }
        try {
            return valueOf(valor.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("prioridad debe ser BAJA, NORMAL o ALTA");
        }
    }
}
