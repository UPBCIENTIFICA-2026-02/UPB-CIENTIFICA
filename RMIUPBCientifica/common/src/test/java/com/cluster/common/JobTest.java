package com.cluster.common;

import org.junit.jupiter.api.Test;

import java.io.*;

import static org.junit.jupiter.api.Assertions.*;

class JobTest {

    @Test
    void unTrabajoNuevoEmpiezaEnEstadoQueued() {
        Job job = new Job("id-1", "prueba", "echo hola", 5);
        assertEquals(JobStatus.QUEUED, job.getEstado());
        assertNotNull(job.getFechaCreacion());
        assertNull(job.getFechaInicio());
        assertNull(job.getFechaFin());
    }

    @Test
    void jobEsSerializableParaViajarPorRmi() throws IOException, ClassNotFoundException {
        Job original = new Job("id-2", "job-serializable", "echo test", 3);
        original.setEstado(JobStatus.COMPLETED);
        original.setResultado("salida de prueba");

        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (ObjectOutputStream oos = new ObjectOutputStream(buffer)) {
            oos.writeObject(original);
        }

        Job reconstruido;
        try (ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(buffer.toByteArray()))) {
            reconstruido = (Job) ois.readObject();
        }

        assertEquals(original.getId(), reconstruido.getId());
        assertEquals(original.getEstado(), reconstruido.getEstado());
        assertEquals(original.getResultado(), reconstruido.getResultado());
        assertNotSame(original, reconstruido, "Tras (de)serializar debe ser una copia, no la misma referencia");
    }

    @Test
    void dosJobsConElMismoIdSonIguales() {
        Job a = new Job("mismo-id", "a", "echo a", 1);
        Job b = new Job("mismo-id", "b", "echo b", 2);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }
}
