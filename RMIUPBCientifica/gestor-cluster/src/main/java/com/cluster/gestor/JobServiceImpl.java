package com.cluster.gestor;

import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.JobService;
import com.cluster.common.JobStatus;
import com.cluster.common.JobStatusTransition;
import com.cluster.common.NoAutorizadoException;
import com.cluster.gestor.auth.AuthNoDisponibleException;
import com.cluster.gestor.auth.Usuario;
import com.cluster.gestor.metricas.MetricasHpc;
import com.cluster.gestor.auth.ValidadorSimulado;
import com.cluster.gestor.auth.ValidadorToken;

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
 * AUTENTICACIÓN: cada método valida el token antes de hacer nada, y el uid del
 * usuario sale de ahí. Antes no había validación de ningún tipo: cualquiera con
 * acceso al puerto podía enviar trabajos, listar los de todos y cancelarlos.
 *
 * PENDIENTE CONOCIDO (no se toca en este cambio): {@link #ejecutarComando}
 * sigue lanzando el comando con {@code bash -c}. Con la autenticación puesta ya
 * no lo puede hacer cualquiera, pero un usuario autenticado sigue ejecutando
 * shell arbitrario con los permisos del servicio, en una VM que monta
 * /srv/home. Restringirlo a invocaciones de mpirun depende del diseño de
 * job-runner.jar, que todavía no existe, y de que el equipo acuerde qué se
 * puede enviar: código fuente y datasets según Contrato_HPC, no comandos.
 */
public class JobServiceImpl implements JobService {

    private static final int NUM_WORKERS = 3;

    /**
     * Intérprete con el que se lanza cada comando. En hpc-master es "bash".
     * En Windows (pruebas locales) "bash" resuelve a C:WindowsSystem32ash.exe,
     * el de WSL, que sin una distribución Linux instalada deja los trabajos
     * colgados o fallidos; allí se define SHELL_TRABAJOS con la ruta de Git Bash.
     */
    private static final String SHELL = System.getenv().getOrDefault("SHELL_TRABAJOS", "bash");

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

    /** Carga y tiempos de ejecución para el monitoreo (Prometheus, M1). */
    private final MetricasHpc metricas = new MetricasHpc(
            () -> java.util.List.copyOf(jobs.values()), cola::size, NUM_WORKERS);
    private final ValidadorToken validador;
    private volatile boolean detenido = false;

    public JobServiceImpl(ValidadorToken validador) {
        this.validador = validador;
        for (int i = 0; i < NUM_WORKERS; i++) {
            workers.submit(this::bucleWorker);
        }
    }

    public MetricasHpc metricas() {
        return metricas;
    }

    /** Constructor de conveniencia para pruebas: usa el validador simulado. */
    public JobServiceImpl() {
        this(new ValidadorSimulado());
    }

    /**
     * Valida el token y devuelve el usuario.
     *
     * Un fallo de Auth se envuelve en RemoteException para no ampliar el
     * contrato con una excepción más: job-api ya traduce RemoteException a 503,
     * que es exactamente lo que corresponde cuando Auth no responde.
     */
    private Usuario autenticar(String token) throws RemoteException, NoAutorizadoException {
        Usuario usuario;
        try {
            usuario = validador.validar(token);
        } catch (AuthNoDisponibleException e) {
            throw new RemoteException(e.getMessage(), e);
        }
        if (usuario == null) {
            throw NoAutorizadoException.tokenInvalido();
        }
        // D2: el perfil tiene que tener "hpc" en su mapa de servicios autorizados.
        // sinIdentidad=false: hay identidad pero no alcanza, job-api responde 403.
        try {
            if (!validador.autorizarServicio(usuario, SERVICIO)) {
                throw new NoAutorizadoException(
                        "Tu perfil no tiene acceso al servicio \"" + SERVICIO + "\"", false);
            }
        } catch (AuthNoDisponibleException e) {
            throw new RemoteException(e.getMessage(), e);
        }
        return usuario;
    }

    /** Nombre de este servicio en el mapa de servicios autorizados del directorio. */
    private static final String SERVICIO = "hpc";

    @Override
    public String submitJob(String token, String nombre, String comando, int prioridad)
            throws RemoteException, NoAutorizadoException {
        Usuario usuario = autenticar(token);

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
        Job job = new Job(id, nombre, comando, prioridad, usuario.uid());
        jobs.put(id, job);
        cola.put(job);
        return id;
    }

    @Override
    public JobStatus getJobStatus(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, NoAutorizadoException {
        return buscarPropioOFallar(autenticar(token), jobId).getEstado();
    }

    @Override
    public Job getJob(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, NoAutorizadoException {
        return buscarPropioOFallar(autenticar(token), jobId);
    }

    /**
     * Trabajos del usuario del token.
     *
     * Antes devolvía {@code jobs.values()} completo, es decir los trabajos de
     * todos los usuarios del sistema.
     */
    @Override
    public List<Job> listJobs(String token) throws RemoteException, NoAutorizadoException {
        Usuario usuario = autenticar(token);
        List<Job> propios = new ArrayList<>();
        for (Job job : jobs.values()) {
            if (job.esDe(usuario.uid())) {
                propios.add(job);
            }
        }
        return propios;
    }

    @Override
    public boolean cancelJob(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, EstadoInvalidoException,
            NoAutorizadoException {
        Job job = buscarPropioOFallar(autenticar(token), jobId);

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

    /**
     * Busca un trabajo y comprueba que sea del usuario.
     *
     * Se responde 404 (JobNoEncontradoException) y no 403 cuando el trabajo
     * existe pero es de otro: así no se revela qué identificadores existen.
     */
    private Job buscarPropioOFallar(Usuario usuario, String jobId)
            throws JobNoEncontradoException {
        if (jobId == null || jobId.isBlank()) {
            throw new IllegalArgumentException("El id del trabajo no puede estar vacío");
        }
        Job job = jobs.get(jobId);
        if (job == null || !job.esDe(usuario.uid())) {
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
            ProcessBuilder pb = new ProcessBuilder(SHELL, "-c", job.getComando());
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
                metricas.trabajoTerminado(job);
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
                    metricas.trabajoTerminado(job);
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
