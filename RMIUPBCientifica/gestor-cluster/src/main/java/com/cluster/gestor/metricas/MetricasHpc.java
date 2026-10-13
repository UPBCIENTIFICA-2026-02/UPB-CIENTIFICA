package com.cluster.gestor.metricas;

import com.cluster.common.Job;
import com.cluster.common.JobStatus;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collection;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * Métricas del servicio HPC para Prometheus (módulo de monitoreo, M1).
 *
 * El requisito pide "carga de trabajos" y "tiempos de ejecución". Se miden
 * aquí, en el gestor, porque es quien tiene la cola y los trabajos; job-api
 * solo los consulta por RMI y, por usuario, no vería la carga global.
 *
 * Se sirven con el HttpServer del propio JDK en formato de texto de Prometheus:
 * sin dependencias nuevas y sin tocar el contrato RMI (common).
 *
 *   hpc_trabajos{estado}                 trabajos por estado (gauge)
 *   hpc_cola_longitud                    trabajos esperando worker (gauge)
 *   hpc_workers                          workers del gestor (gauge)
 *   hpc_trabajos_enviados_total          trabajos recibidos desde el arranque
 *   hpc_trabajo_duracion_segundos        tiempo de ejecución (histograma)
 *   hpc_trabajo_espera_segundos          tiempo en cola hasta empezar (histograma)
 *   hpc_trabajos_terminados_total{resultado}  completados / fallidos
 */
public final class MetricasHpc {

    /** Cubos pensados para trabajos HPC: de segundos a horas. */
    private static final double[] CUBOS = {1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200};

    private final Supplier<Collection<Job>> trabajos;
    private final IntSupplier longitudCola;
    private final int workers;
    private final Histograma duracion = new Histograma(CUBOS);
    private final Histograma espera = new Histograma(CUBOS);
    private final Map<JobStatus, Long> terminados = new EnumMap<>(JobStatus.class);

    public MetricasHpc(Supplier<Collection<Job>> trabajos, IntSupplier longitudCola, int workers) {
        this.trabajos = trabajos;
        this.longitudCola = longitudCola;
        this.workers = workers;
    }

    /** Lo llama el gestor cuando un trabajo termina (completado o fallido). */
    public synchronized void trabajoTerminado(Job job) {
        if (job.getFechaInicio() != null && job.getFechaFin() != null) {
            duracion.observar(Duration.between(job.getFechaInicio(), job.getFechaFin()).toMillis() / 1000.0);
        }
        if (job.getFechaInicio() != null) {
            espera.observar(Duration.between(job.getFechaCreacion(), job.getFechaInicio()).toMillis() / 1000.0);
        }
        terminados.merge(job.getEstado(), 1L, Long::sum);
    }

    public synchronized String texto() {
        Map<JobStatus, Integer> porEstado = new EnumMap<>(JobStatus.class);
        for (JobStatus e : JobStatus.values()) {
            porEstado.put(e, 0);
        }
        Collection<Job> todos = trabajos.get();
        for (Job j : todos) {
            porEstado.merge(j.getEstado(), 1, Integer::sum);
        }

        StringBuilder s = new StringBuilder();
        s.append("# HELP hpc_trabajos Trabajos HPC por estado.\n# TYPE hpc_trabajos gauge\n");
        porEstado.forEach((e, n) -> s.append("hpc_trabajos{estado=\"").append(e.name()).append("\"} ").append(n).append('\n'));
        s.append("# HELP hpc_cola_longitud Trabajos en cola esperando un worker.\n# TYPE hpc_cola_longitud gauge\n")
                .append("hpc_cola_longitud ").append(longitudCola.getAsInt()).append('\n');
        s.append("# HELP hpc_workers Workers del gestor que ejecutan trabajos.\n# TYPE hpc_workers gauge\n")
                .append("hpc_workers ").append(workers).append('\n');
        s.append("# HELP hpc_trabajos_enviados_total Trabajos recibidos desde el arranque del gestor.\n")
                .append("# TYPE hpc_trabajos_enviados_total counter\n")
                .append("hpc_trabajos_enviados_total ").append(todos.size()).append('\n');
        s.append("# HELP hpc_trabajos_terminados_total Trabajos terminados por resultado.\n")
                .append("# TYPE hpc_trabajos_terminados_total counter\n");
        for (JobStatus e : new JobStatus[]{JobStatus.COMPLETED, JobStatus.FAILED}) {
            s.append("hpc_trabajos_terminados_total{resultado=\"").append(e.name()).append("\"} ")
                    .append(terminados.getOrDefault(e, 0L)).append('\n');
        }
        duracion.escribir(s, "hpc_trabajo_duracion_segundos", "Tiempo de ejecución de los trabajos HPC.");
        espera.escribir(s, "hpc_trabajo_espera_segundos", "Tiempo en cola hasta que un worker toma el trabajo.");
        return s.toString();
    }

    /** Arranca GET /metrics en el puerto indicado (por defecto 9102). */
    public HttpServer servir(int puerto) throws IOException {
        HttpServer servidor = HttpServer.create(new InetSocketAddress(puerto), 0);
        servidor.createContext("/metrics", intercambio -> {
            byte[] cuerpo = texto().getBytes(StandardCharsets.UTF_8);
            intercambio.getResponseHeaders().set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            intercambio.sendResponseHeaders(200, cuerpo.length);
            try (OutputStream salida = intercambio.getResponseBody()) {
                salida.write(cuerpo);
            }
        });
        servidor.start();
        return servidor;
    }

    /** Histograma acumulativo en formato Prometheus. */
    private static final class Histograma {
        private final double[] cubos;
        private final long[] cuentas;
        private double suma;
        private long total;

        Histograma(double[] cubos) {
            this.cubos = cubos;
            this.cuentas = new long[cubos.length];
        }

        void observar(double valor) {
            for (int i = 0; i < cubos.length; i++) {
                if (valor <= cubos[i]) {
                    cuentas[i]++;
                }
            }
            suma += valor;
            total++;
        }

        void escribir(StringBuilder s, String nombre, String ayuda) {
            s.append("# HELP ").append(nombre).append(' ').append(ayuda).append('\n')
                    .append("# TYPE ").append(nombre).append(" histogram\n");
            for (int i = 0; i < cubos.length; i++) {
                s.append(nombre).append("_bucket{le=\"").append(formato(cubos[i])).append("\"} ").append(cuentas[i]).append('\n');
            }
            s.append(nombre).append("_bucket{le=\"+Inf\"} ").append(total).append('\n')
                    .append(nombre).append("_sum ").append(formato(suma)).append('\n')
                    .append(nombre).append("_count ").append(total).append('\n');
        }

        private static String formato(double v) {
            return String.format(Locale.ROOT, "%s", v);
        }
    }
}
