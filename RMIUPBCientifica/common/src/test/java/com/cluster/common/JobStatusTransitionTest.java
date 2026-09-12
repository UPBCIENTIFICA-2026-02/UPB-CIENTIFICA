package com.cluster.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JobStatusTransitionTest {

    @Test
    void transicionesPermitidasDesdeQueued() {
        assertTrue(JobStatusTransition.esValida(JobStatus.QUEUED, JobStatus.RUNNING));
        assertTrue(JobStatusTransition.esValida(JobStatus.QUEUED, JobStatus.CANCELLED));
    }

    @Test
    void transicionesPermitidasDesdeRunning() {
        assertTrue(JobStatusTransition.esValida(JobStatus.RUNNING, JobStatus.COMPLETED));
        assertTrue(JobStatusTransition.esValida(JobStatus.RUNNING, JobStatus.FAILED));
        assertTrue(JobStatusTransition.esValida(JobStatus.RUNNING, JobStatus.CANCELLED));
    }

    @Test
    void estadosTerminalesNoAdmitenNingunaTransicionSaliente() {
        for (JobStatus destino : JobStatus.values()) {
            assertFalse(JobStatusTransition.esValida(JobStatus.COMPLETED, destino));
            assertFalse(JobStatusTransition.esValida(JobStatus.FAILED, destino));
            assertFalse(JobStatusTransition.esValida(JobStatus.CANCELLED, destino));
        }
    }

    @Test
    void noSePuedeVolverDeCancelledARunning() {
        assertFalse(JobStatusTransition.esValida(JobStatus.CANCELLED, JobStatus.RUNNING));
    }

    @Test
    void losEstadosTerminalesSeReconocenComoTales() {
        assertTrue(JobStatusTransition.esTerminal(JobStatus.COMPLETED));
        assertTrue(JobStatusTransition.esTerminal(JobStatus.FAILED));
        assertTrue(JobStatusTransition.esTerminal(JobStatus.CANCELLED));
        assertFalse(JobStatusTransition.esTerminal(JobStatus.QUEUED));
        assertFalse(JobStatusTransition.esTerminal(JobStatus.RUNNING));
    }
}
