package com.cluster.gestor.metricas;

import com.cluster.common.EstadoCluster;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NodoCluster;
import com.cluster.common.TrabajoHpc;
import com.cluster.gestor.dominio.GestorTrabajos;
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
import java.util.function.Supplier;

/**
 * Métricas del servicio HPC para Prometheus (módulo de monitoreo).
 *
 * El requisito pide "carga de trabajos", "tiempos de ejecución" y seguimiento
 * del servicio HPC. Se miden aquí porque el gestor tiene la cola, los trabajos
 * y el registro de nodos de la malla. HttpServer del JDK, formato de texto de
 * Prometheus, sin dependencias.
 *
 *   hpc_trabajos{estado}                      trabajos por estado (gauge)
 *   hpc_cola_longitud                         trabajos EN_COLA (gauge)
 *   hpc_nodos{estado,origen}                  nodos de la malla (gauge)
 *   hpc_procesos_total / hpc_procesos_en_uso  capacidad y ocupación (gauge)
 *   hpc_ejecutor_conectado                    1 si job-runner responde
 *   hpc_trabajos_enviados_total               counter
 *   hpc_trabajos_terminados_total{resultado}  counter por estado final
 *   hpc_nodos_en_falla_total                  eventos NodoEnFalla (counter)
 *   hpc_trabajo_duracion_segundos             tiempo de ejecución (histograma)
 *   hpc_trabajo_espera_segundos               tiempo en cola (histograma)
 *
 * ANTES los estados eran QUEUED/RUNNING/... y había un "hpc_workers" fijo (3
 * hilos locales): no había nodos que medir.
 */
public final class MetricasHpc implements GestorTrabajos.Observador {

    private static final double[] CUBOS = {1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200};

    private final Supplier<Collection<TrabajoHpc>> trabajos;
    private final Supplier<EstadoCluster> cluster;
    private final Histograma duracion = new Histograma(CUBOS);
    private final Histograma espera = new Histograma(CUBOS);
    private final Map<EstadoTrabajo, Long> terminados = new EnumMap<>(EstadoTrabajo.class);
    private long enviados;
    private long nodosEnFalla;

    public MetricasHpc(Supplier<Collection<TrabajoHpc>> trabajos, Supplier<EstadoCluster> cluster) {
        this.trabajos = trabajos;
        this.cluster = cluster;
    }

    @Override
    public synchronized void trabajoEnviado(TrabajoHpc t) {
        enviados++;
    }

    @Override
    public synchronized void trabajoTerminado(TrabajoHpc t) {
        if (t.getFechaInicio() != null && t.getFechaFin() != null) {
            duracion.observar(Duration.between(t.getFechaInicio(), t.getFechaFin()).toMillis() / 1000.0);
            espera.observar(Duration.between(t.getFechaEnvio(), t.getFechaInicio()).toMillis() / 1000.0);
        }
        EstadoTrabajo e = t.getEstado() == EstadoTrabajo.COMPLETADO_PENDIENTE_ALMACENAMIENTO
                ? EstadoTrabajo.COMPLETADO : t.getEstado();
        terminados.merge(e, 1L, Long::sum);
    }

    @Override
    public synchronized void nodoEnFalla(String nodo) {
        nodosEnFalla++;
    }

    public synchronized String texto() {
        Map<EstadoTrabajo, Integer> porEstado = new EnumMap<>(EstadoTrabajo.class);
        for (EstadoTrabajo e : EstadoTrabajo.values()) {
            porEstado.put(e, 0);
        }
        for (TrabajoHpc t : trabajos.get()) {
            porEstado.merge(t.getEstado(), 1, Integer::sum);
        }
        EstadoCluster c = cluster.get();

        StringBuilder s = new StringBuilder();
        s.append("# HELP hpc_trabajos Trabajos HPC por estado.\n# TYPE hpc_trabajos gauge\n");
        porEstado.forEach((e, n) -> s.append("hpc_trabajos{estado=\"").append(e.name()).append("\"} ").append(n).append('\n'));
        s.append("# HELP hpc_cola_longitud Trabajos en cola esperando nodos.\n# TYPE hpc_cola_longitud gauge\n")
                .append("hpc_cola_longitud ").append(c.trabajosEnCola()).append('\n');

        s.append("# HELP hpc_nodos Nodos de la malla por estado y origen.\n# TYPE hpc_nodos gauge\n");
        for (NodoCluster.Estado e : NodoCluster.Estado.values()) {
            for (NodoCluster.Origen o : NodoCluster.Origen.values()) {
                long n = c.nodos().stream().filter(x -> x.estado() == e && x.origen() == o).count();
                s.append("hpc_nodos{estado=\"").append(e.name()).append("\",origen=\"").append(o.name())
                        .append("\"} ").append(n).append('\n');
            }
        }
        s.append("# HELP hpc_procesos_total Procesos MPI que admite la malla (sin nodos en falla).\n")
                .append("# TYPE hpc_procesos_total gauge\nhpc_procesos_total ").append(c.procesosTotales()).append('\n');
        s.append("# HELP hpc_procesos_en_uso Procesos MPI asignados a trabajos en ejecución.\n")
                .append("# TYPE hpc_procesos_en_uso gauge\nhpc_procesos_en_uso ").append(c.procesosEnUso()).append('\n');
        s.append("# HELP hpc_ejecutor_conectado 1 si job-runner (hpc-master) responde.\n")
                .append("# TYPE hpc_ejecutor_conectado gauge\nhpc_ejecutor_conectado ")
                .append(c.ejecutorConectado() ? 1 : 0).append('\n');

        s.append("# HELP hpc_trabajos_enviados_total Trabajos recibidos desde el arranque del gestor.\n")
                .append("# TYPE hpc_trabajos_enviados_total counter\nhpc_trabajos_enviados_total ")
                .append(enviados).append('\n');
        s.append("# HELP hpc_trabajos_terminados_total Trabajos terminados por estado final.\n")
                .append("# TYPE hpc_trabajos_terminados_total counter\n");
        for (EstadoTrabajo e : new EstadoTrabajo[]{EstadoTrabajo.COMPLETADO, EstadoTrabajo.FALLIDO,
                EstadoTrabajo.FALLIDO_TIMEOUT, EstadoTrabajo.CANCELADO}) {
            s.append("hpc_trabajos_terminados_total{resultado=\"").append(e.name()).append("\"} ")
                    .append(terminados.getOrDefault(e, 0L)).append('\n');
        }
        s.append("# HELP hpc_nodos_en_falla_total Eventos NodoEnFalla desde el arranque.\n")
                .append("# TYPE hpc_nodos_en_falla_total counter\nhpc_nodos_en_falla_total ")
                .append(nodosEnFalla).append('\n');
        duracion.escribir(s, "hpc_trabajo_duracion_segundos", "Tiempo de ejecución de los trabajos HPC.");
        espera.escribir(s, "hpc_trabajo_espera_segundos", "Tiempo en cola hasta que se asignan nodos.");
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
