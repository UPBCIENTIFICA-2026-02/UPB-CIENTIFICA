package com.cluster.gestor;

import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.JobService;
import com.cluster.common.JobStatus;
import com.cluster.common.JobStatusTransition;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.rmi.RemoteException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * DECISIONES DE CONCURRENCIA (ver justificación completa en el README):
 *      {@link ConcurrentHashMap} para el registro {@code id -> Job}: múltiples
 *       hilos RMI (uno por invocación entrante) leen/escriben por distintas
 *       claves de forma segura sin bloquear todo el mapa.
 *      {@link PriorityBlockingQueue} para la cola de pendientes: es thread-safe
 *       por diseño y permite a los workers bloquearse eficientemente en
 *       {@code take()} sin hacer polling activo cuando no hay trabajos.
 *      {@link ExecutorService} con un pool fijo de workers: desacopla la
 *       recepción de la invocación RMI (que debe retornar rápido) de la
 *       ejecución real del comando, que puede tardar.
 *      {@code synchronized(job)} puntual: la transición de estado de UN
 *       trabajo individual (leer estado, validar, escribir) debe ser atómica
 *       frente a operaciones concurrentes sobre ESE MISMO trabajo (por
 *       ejemplo, un worker marcándolo RUNNING justo cuando llega un
 *       cancelJob). Sincronizar sobre la instancia del Job, y no sobre todo
 *       el servicio, permite que operaciones sobre trabajos distintos avancen
 *       en paralelo sin contención.
 *
 */
public class JobServiceImpl implements JobService {

    private static final int NUM_WORKERS = 3;

    private final ConcurrentHashMap<String, Job> jobs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Process> procesosActivos = new ConcurrentHashMap<>();
    private final PriorityBlockingQueue<Job> cola = new PriorityBlockingQueue<>(
            64,
            (a, b) -> {
                int porPrioridad = Integer.compare(b.getPrioridad(), a.getPrioridad());
                if (porPrioridad != 0) {
                    return porPrioridad;
                }
                return a.getFechaCreacion().compareTo(b.getFechaCreacion());
            }
    );
    private final ExecutorService workers = Executors.newFixedThreadPool(NUM_WORKERS);
    private volatile boolean detenido = false;

    public JobServiceImpl() {
        for (int i = 0; i < NUM_WORKERS; i++) {
            workers.submit(this::bucleWorker);
        }
    }

    @Override
    public String submitJob(String nombre, String comando, int prioridad) throws RemoteException {
        if (nombre == null || nombre.isBlank()) {
            throw new IllegalArgumentException("El nombre del trabajo no puede estar vacío");
        }
        if (comando == null || comando.isBlank()) {
            throw new IllegalArgumentException("El comando del trabajo no puede estar vacío");
        }
        if (prioridad < 1 || prioridad > 10) {
            throw new IllegalArgumentException("La prioridad debe estar entre 1 y 10");
        }

        String id = UUID.randomUUID().toString();
        Job job = new Job(id, nombre, comando, prioridad);
        jobs.put(id, job);
        cola.put(job);
        return id;
    }

    @Override
    public JobStatus getJobStatus(String jobId) throws RemoteException, JobNoEncontradoException {
        Job job = buscarOFallar(jobId);
        return job.getEstado();
    }

    @Override
    public Job getJob(String jobId) throws RemoteException, JobNoEncontradoException {
        return buscarOFallar(jobId);
    }

    @Override
    public List<Job> listJobs() throws RemoteException {
        return new ArrayList<>(jobs.values());
    }

    @Override
    public boolean cancelJob(String jobId) throws RemoteException, JobNoEncontradoException, EstadoInvalidoException {
        Job job = buscarOFallar(jobId);

        synchronized (job) {
            JobStatus actual = job.getEstado();

            if (!JobStatusTransition.esValida(actual, JobStatus.CANCELLED)) {
                throw new EstadoInvalidoException(jobId, actual);
            }

            if (actual == JobStatus.QUEUED) {
                cola.remove(job);
            } else if (actual == JobStatus.RUNNING) {
                Process proceso = procesosActivos.get(jobId);
                if (proceso != null) {
                    proceso.destroyForcibly();
                }
            }

            job.setEstado(JobStatus.CANCELLED);
            job.setFechaFin(Instant.now());
            return true;
        }
    }

    private Job buscarOFallar(String jobId) throws JobNoEncontradoException {
        if (jobId == null || jobId.isBlank()) {
            throw new IllegalArgumentException("El id del trabajo no puede estar vacío");
        }
        Job job = jobs.get(jobId);
        if (job == null) {
            throw new JobNoEncontradoException(jobId);
        }
        return job;
    }

    /**
     * Bucle ejecutado por cada hilo worker: toma trabajos de la cola y los
     * ejecuta uno a uno. Un fallo al procesar un trabajo NUNCA debe tumbar el
     * hilo worker completo (y con él, la disponibilidad del servidor RMI para
     * los demás trabajos), por lo que cualquier excepción inesperada se
     * captura y registra sin interrumpir el bucle.
     */
    private void bucleWorker() {
        while (!detenido && !Thread.currentThread().isInterrupted()) {
            try {
                Job job = cola.take();

                boolean debeEjecutar;
                synchronized (job) {
                    if (job.getEstado() == JobStatus.QUEUED) {
                        job.setEstado(JobStatus.RUNNING);
                        job.setFechaInicio(Instant.now());
                        debeEjecutar = true;
                    } else {
                        debeEjecutar = false;
                    }
                }

                if (debeEjecutar) {
                    ejecutarComando(job);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                System.err.println("[gestor-cluster] Error inesperado en worker: " + e.getMessage());
            }
        }
    }

    private void ejecutarComando(Job job) {
        Process proceso = null;
        try {
            ProcessBuilder pb = new ProcessBuilder("bash", "-c", job.getComando());
            pb.redirectErrorStream(true);
            proceso = pb.start();
            procesosActivos.put(job.getId(), proceso);

            String salida = leerSalida(proceso);
            int codigoSalida = proceso.waitFor();

            synchronized (job) {
                if (job.getEstado() == JobStatus.CANCELLED) {
                    return;
                }
                if (codigoSalida == 0) {
                    job.setEstado(JobStatus.COMPLETED);
                    job.setResultado(salida);
                } else {
                    job.setEstado(JobStatus.FAILED);
                    job.setMensajeError("Código de salida " + codigoSalida + ": " + salida);
                }
                job.setFechaFin(Instant.now());
            }
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            synchronized (job) {
                if (job.getEstado() != JobStatus.CANCELLED) {
                    job.setEstado(JobStatus.FAILED);
                    job.setMensajeError("Error al ejecutar el comando: " + e.getMessage());
                    job.setFechaFin(Instant.now());
                }
            }
        } finally {
            procesosActivos.remove(job.getId());
        }
    }

    private String leerSalida(Process proceso) throws IOException {
        StringBuilder salida = new StringBuilder();
        try (BufferedReader lector = new BufferedReader(
                new InputStreamReader(proceso.getInputStream(), StandardCharsets.UTF_8))) {
            String linea;
            while ((linea = lector.readLine()) != null) {
                salida.append(linea).append(System.lineSeparator());
            }
        }
        return salida.toString().trim();
    }

    /**
     * Libera los recursos internos (workers y procesos activos). Debe
     * invocarse desde el shutdown hook de {@link Main} antes de que la JVM
     * termine.
     */
    public void shutdown() {
        detenido = true;
        workers.shutdownNow();
        try {
            workers.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        procesosActivos.values().forEach(Process::destroyForcibly);
    }
}
