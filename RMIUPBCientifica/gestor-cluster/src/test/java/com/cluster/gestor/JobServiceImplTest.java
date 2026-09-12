package com.cluster.gestor;

import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.JobStatus;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pruebas directas sobre JobServiceImpl (sin pasar por RMI): validan la
 * lógica de negocio, la máquina de estados y la concurrencia de forma
 * rápida y aislada. La comunicación RMI en sí se prueba por separado en
 * job-api mediante RmiClientIntegrationTest.
 */
class JobServiceImplTest {

    private JobServiceImpl servicio;

    @BeforeEach
    void iniciar() {
        servicio = new JobServiceImpl();
    }

    @AfterEach
    void detener() {
        servicio.shutdown();
    }

    @Test
    void submitJobCreaUnTrabajoEnEstadoQueuedOMasAvanzado() throws Exception {
        String id = servicio.submitJob("prueba-basica", "echo hola", 5);
        assertNotNull(id);
        // Puede haber avanzado ya a RUNNING/COMPLETED por la velocidad del worker.
        assertNotNull(servicio.getJobStatus(id));
    }

    @Test
    void submitJobRechazaNombreVacio() {
        assertThrows(IllegalArgumentException.class,
                () -> servicio.submitJob("", "echo hola", 5));
    }

    @Test
    void submitJobRechazaComandoVacio() {
        assertThrows(IllegalArgumentException.class,
                () -> servicio.submitJob("nombre", "", 5));
    }

    @Test
    void submitJobRechazaPrioridadFueraDeRango() {
        assertThrows(IllegalArgumentException.class,
                () -> servicio.submitJob("nombre", "echo hola", 99));
    }

    @Test
    void getJobStatusLanzaJobNoEncontradoExceptionParaIdInexistente() {
        assertThrows(JobNoEncontradoException.class,
                () -> servicio.getJobStatus("id-que-no-existe"));
    }

    @Test
    @Timeout(10)
    void unTrabajoExitosoTerminaEnCompleted() throws Exception {
        String id = servicio.submitJob("ok", "echo funciona", 5);
        Job job = esperarEstadoFinal(id);

        assertEquals(JobStatus.COMPLETED, job.getEstado());
        assertTrue(job.getResultado().contains("funciona"));
        assertNotNull(job.getFechaInicio());
        assertNotNull(job.getFechaFin());
    }

    @Test
    @Timeout(10)
    void unComandoQueFallaTerminaEnFailed() throws Exception {
        String id = servicio.submitJob("falla", "exit 1", 5);
        Job job = esperarEstadoFinal(id);

        assertEquals(JobStatus.FAILED, job.getEstado());
        assertNotNull(job.getMensajeError());
    }

    @Test
    void cancelJobSobreTrabajoEnColaLoMarcaCancelled() throws Exception {
        // Prioridad baja y comando lento para maximizar la probabilidad de
        // que siga QUEUED al momento de cancelar.
        String id = servicio.submitJob("lento", "sleep 5", 1);
        boolean cancelado = servicio.cancelJob(id);
        assertTrue(cancelado);
        JobStatus estado = servicio.getJobStatus(id);
        assertEquals(JobStatus.CANCELLED, estado);
    }

    @Test
    void cancelJobSobreTrabajoInexistenteLanzaExcepcion() {
        assertThrows(JobNoEncontradoException.class, () -> servicio.cancelJob("no-existe"));
    }

    @Test
    @Timeout(10)
    void cancelJobSobreTrabajoTerminadoLanzaEstadoInvalidoException() throws Exception {
        String id = servicio.submitJob("rapido", "echo listo", 5);
        esperarEstadoFinal(id);
        assertThrows(EstadoInvalidoException.class, () -> servicio.cancelJob(id));
    }

    @Test
    void listJobsDevuelveTodosLosTrabajosCreados() throws Exception {
        servicio.submitJob("a", "echo a", 1);
        servicio.submitJob("b", "echo b", 2);
        servicio.submitJob("c", "echo c", 3);

        List<Job> todos = servicio.listJobs();
        assertEquals(3, todos.size());
    }

    @Test
    @Timeout(15)
    void multiplesClientesConcurrentesPuedenEnviarTrabajosSinErrores() throws Exception {
        int numeroClientes = 20;
        ExecutorService clientes = Executors.newFixedThreadPool(numeroClientes);
        CountDownLatch listos = new CountDownLatch(numeroClientes);
        AtomicInteger errores = new AtomicInteger(0);

        for (int i = 0; i < numeroClientes; i++) {
            final int indice = i;
            clientes.submit(() -> {
                try {
                    servicio.submitJob("concurrente-" + indice, "echo " + indice, (indice % 10) + 1);
                } catch (Exception e) {
                    errores.incrementAndGet();
                } finally {
                    listos.countDown();
                }
            });
        }

        listos.await();
        clientes.shutdown();

        assertEquals(0, errores.get(), "Ninguna invocación concurrente debería fallar");
        assertEquals(numeroClientes, servicio.listJobs().size());
    }

    private Job esperarEstadoFinal(String id) throws Exception {
        long limite = System.currentTimeMillis() + 8000;
        while (System.currentTimeMillis() < limite) {
            JobStatus estado = servicio.getJobStatus(id);
            if (estado == JobStatus.COMPLETED || estado == JobStatus.FAILED || estado == JobStatus.CANCELLED) {
                return servicio.getJob(id);
            }
            Thread.sleep(100);
        }
        throw new AssertionError("El trabajo " + id + " no alcanzó un estado final a tiempo");
    }
}
