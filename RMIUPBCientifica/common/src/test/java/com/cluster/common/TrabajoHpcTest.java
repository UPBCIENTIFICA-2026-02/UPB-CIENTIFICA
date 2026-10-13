package com.cluster.common;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class TrabajoHpcTest {

    private static SolicitudTrabajo solicitud() {
        return new SolicitudTrabajo("pi", "/Proyectos/pi.c", "", 4, 120,
                null, Map.of("iteraciones", "1000"));
    }

    @Test
    void unTrabajoNuevoEstaPendienteYConPrioridadNormal() {
        TrabajoHpc t = new TrabajoHpc("id-1", "investigador", solicitud(), null);
        assertEquals(EstadoTrabajo.PENDIENTE, t.getEstado());
        assertEquals(Prioridad.NORMAL, t.getPrioridad());
        assertNull(t.getRutaDataset(), "un dataset vacío es 'sin dataset'");
        assertNotNull(t.getFechaEnvio());
        assertTrue(t.esDe("investigador"));
        assertFalse(t.esDe("estudiante"));
    }

    @Test
    void laCopiaNoComparteEstadoConElOriginal() {
        TrabajoHpc t = new TrabajoHpc("id-1", "investigador", solicitud(), null);
        t.setNodosAsignados(List.of("hpc-worker1"));
        TrabajoHpc copia = t.copia();
        t.setEstado(EstadoTrabajo.EJECUTANDO);
        t.setNodosAsignados(List.of("hpc-worker2"));
        assertEquals(EstadoTrabajo.PENDIENTE, copia.getEstado());
        assertEquals(List.of("hpc-worker1"), copia.getNodosAsignados());
    }

    @Test
    void viajaPorRmiSerializado() throws Exception {
        TrabajoHpc original = new TrabajoHpc("id-2", "investigador", solicitud(), "id-1");
        original.setEstado(EstadoTrabajo.COMPLETADO);
        original.setRutaResultado("/Resultados HPC/pi-id-2");

        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (ObjectOutputStream oos = new ObjectOutputStream(buffer)) {
            oos.writeObject(original);
        }
        TrabajoHpc leido;
        try (ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(buffer.toByteArray()))) {
            leido = (TrabajoHpc) ois.readObject();
        }
        assertEquals(original, leido);
        assertEquals(EstadoTrabajo.COMPLETADO, leido.getEstado());
        assertEquals("/Resultados HPC/pi-id-2", leido.getRutaResultado());
        assertEquals("id-1", leido.getTrabajoOriginalId());
        assertEquals(Map.of("iteraciones", "1000"), leido.getParametrosEjecucion());
    }

    @Test
    void elReintentoConservaLaSolicitud() {
        SolicitudTrabajo s = new TrabajoHpc("id-1", "investigador", solicitud(), null).comoSolicitud();
        assertEquals("/Proyectos/pi.c", s.getRutaCodigo());
        assertEquals(4, s.getNumeroProcesos());
        assertEquals(120, s.getTiempoMaximoEjecucion());
    }

    @Test
    void prioridadDesdeTexto() {
        assertEquals(Prioridad.NORMAL, Prioridad.desde(null));
        assertEquals(Prioridad.ALTA, Prioridad.desde(" alta "));
        assertThrows(IllegalArgumentException.class, () -> Prioridad.desde("URGENTE"));
    }
}
