package com.cluster.common;

import org.junit.jupiter.api.Test;

import static com.cluster.common.EstadoTrabajo.*;
import static org.junit.jupiter.api.Assertions.*;

class TransicionesTrabajoTest {

    @Test
    void flujoNormalCompleto() {
        assertTrue(TransicionesTrabajo.esValida(PENDIENTE, EN_COLA));
        assertTrue(TransicionesTrabajo.esValida(EN_COLA, EJECUTANDO));
        assertTrue(TransicionesTrabajo.esValida(EJECUTANDO, COMPLETADO));
    }

    @Test
    void resultadoSinGuardarTodaviaPuedeCompletarse() {
        assertTrue(TransicionesTrabajo.esValida(EJECUTANDO, COMPLETADO_PENDIENTE_ALMACENAMIENTO));
        assertTrue(TransicionesTrabajo.esValida(COMPLETADO_PENDIENTE_ALMACENAMIENTO, COMPLETADO));
        assertFalse(TransicionesTrabajo.esTerminal(COMPLETADO_PENDIENTE_ALMACENAMIENTO));
    }

    @Test
    void nodoCaidoAntesDeArrancarDevuelveElTrabajoALaCola() {
        assertTrue(TransicionesTrabajo.esValida(EJECUTANDO, EN_COLA));
    }

    @Test
    void losTerminalesNoTienenSalida() {
        for (EstadoTrabajo terminal : new EstadoTrabajo[]{COMPLETADO, FALLIDO, FALLIDO_TIMEOUT, CANCELADO}) {
            assertTrue(TransicionesTrabajo.esTerminal(terminal), terminal.name());
            for (EstadoTrabajo destino : EstadoTrabajo.values()) {
                assertFalse(TransicionesTrabajo.esValida(terminal, destino), terminal + " -> " + destino);
            }
        }
    }

    @Test
    void soloSeCancelaLoQueNoHaTerminado() {
        assertTrue(TransicionesTrabajo.esCancelable(PENDIENTE));
        assertTrue(TransicionesTrabajo.esCancelable(EN_COLA));
        assertTrue(TransicionesTrabajo.esCancelable(EJECUTANDO));
        assertFalse(TransicionesTrabajo.esCancelable(COMPLETADO));
        assertFalse(TransicionesTrabajo.esCancelable(FALLIDO));
    }

    @Test
    void soloSeReintentaLoQueFallo() {
        assertTrue(TransicionesTrabajo.esReintentable(FALLIDO));
        assertTrue(TransicionesTrabajo.esReintentable(FALLIDO_TIMEOUT));
        assertFalse(TransicionesTrabajo.esReintentable(COMPLETADO));
        assertFalse(TransicionesTrabajo.esReintentable(CANCELADO));
        assertFalse(TransicionesTrabajo.esReintentable(EJECUTANDO));
    }

    @Test
    void nulosNoSonTransicionesValidas() {
        assertFalse(TransicionesTrabajo.esValida(null, EN_COLA));
        assertFalse(TransicionesTrabajo.esValida(EN_COLA, null));
    }
}
