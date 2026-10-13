package com.cluster.runner;

import com.cluster.common.EjecutorMpi;
import com.cluster.common.EstadoEjecucion;
import com.cluster.common.OrdenEjecucion;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Objeto remoto de job-runner ({@link EjecutorMpi}), el componente "Cluster
 * MPI" de Contrato_HPC: el gestor de node-rmi le entrega cada trabajo ya
 * planificado y él lo compila y ejecuta con mpirun en los nodos asignados.
 */
public final class EjecutorMpiImpl implements EjecutorMpi {

    private final Configuracion cfg;
    private final Map<String, Ejecucion> ejecuciones = new ConcurrentHashMap<>();
    private final ExecutorService hilos = Executors.newCachedThreadPool(r -> {
        Thread h = new Thread(r, "trabajo-mpi");
        h.setDaemon(true);
        return h;
    });

    public EjecutorMpiImpl(Configuracion cfg) {
        this.cfg = cfg;
    }

    @Override
    public void iniciar(OrdenEjecucion orden) {
        Ejecucion e = new Ejecucion(orden, cfg);
        if (ejecuciones.putIfAbsent(orden.trabajoId(), e) != null) {
            return; // ya iniciado: el gestor reintentó la llamada
        }
        System.out.println("[job-runner] " + orden.trabajoId() + ": " + orden.numeroProcesos()
                + " procesos en " + orden.hosts());
        hilos.submit(e);
    }

    @Override
    public EstadoEjecucion consultar(String trabajoId) {
        Ejecucion e = ejecuciones.get(trabajoId);
        return e == null
                ? new EstadoEjecucion(EstadoEjecucion.DESCONOCIDO, null, false, false, false, "job-runner no conoce el trabajo")
                : e.estado();
    }

    @Override
    public String logs(String trabajoId, int maxBytes) {
        Path dir = cfg.dirTrabajos().resolve(trabajoId);
        int mitad = Math.max(1024, maxBytes / 2);
        StringBuilder s = new StringBuilder();
        anexar(s, dir.resolve(Ejecucion.COMPILACION), "compilación", mitad);
        anexar(s, dir.resolve(Ejecucion.SALIDA), "salida estándar", mitad);
        anexar(s, dir.resolve(Ejecucion.ERRORES), "salida de error", mitad);
        return s.toString();
    }

    /**
     * Lo producido en el directorio del trabajo, sin el código, el binario, el
     * hostfile ni el dataset. Funciona aunque job-runner se haya reiniciado
     * (lee el directorio, no la memoria).
     */
    @Override
    public Map<String, byte[]> resultados(String trabajoId) {
        Path dir = cfg.dirTrabajos().resolve(trabajoId);
        Ejecucion e = ejecuciones.get(trabajoId);
        Set<String> excluir = new java.util.HashSet<>(List.of(Ejecucion.PROGRAMA, Ejecucion.HOSTFILE));
        if (e != null) {
            excluir.add(e.archivoCodigo);
            if (e.archivoDataset != null) excluir.add(e.archivoDataset);
        }
        Map<String, byte[]> archivos = new LinkedHashMap<>();
        List<String> omitidos = new ArrayList<>();
        long total = 0;
        if (!Files.isDirectory(dir)) return archivos;
        try (Stream<Path> lista = Files.list(dir)) {
            for (Path p : lista.filter(Files::isRegularFile).sorted(Comparator.comparing(Path::toString)).toList()) {
                String nombre = p.getFileName().toString();
                if (excluir.contains(nombre)) continue;
                long tam = Files.size(p);
                if (total + tam > cfg.maxResultadosBytes()) {
                    omitidos.add(nombre + " (" + tam + " bytes)");
                    continue;
                }
                archivos.put(nombre, Files.readAllBytes(p));
                total += tam;
            }
        } catch (IOException ex) {
            throw new IllegalStateException("No se pudieron leer los resultados: " + ex.getMessage(), ex);
        }
        if (!omitidos.isEmpty()) {
            archivos.put("OMITIDOS.txt", ("Superan el tope de resultados (" + cfg.maxResultadosBytes()
                    + " bytes) y quedaron solo en el clúster:\n" + String.join("\n", omitidos) + "\n")
                    .getBytes(StandardCharsets.UTF_8));
        }
        return archivos;
    }

    @Override
    public void cancelar(String trabajoId) {
        Ejecucion e = ejecuciones.get(trabajoId);
        if (e != null) e.cancelar();
    }

    @Override
    public void limpiar(String trabajoId) {
        Ejecucion e = ejecuciones.get(trabajoId);
        if (e != null && !e.estado().terminado()) return; // nunca se borra algo en ejecución
        ejecuciones.remove(trabajoId);
        Path dir = cfg.dirTrabajos().resolve(trabajoId).normalize();
        if (!dir.startsWith(cfg.dirTrabajos().normalize()) || !Files.isDirectory(dir)) return;
        try (Stream<Path> todo = Files.walk(dir)) {
            todo.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignorado) {
            // un directorio sin borrar no afecta a nadie
        }
    }

    /** Comprueba por SSH (en paralelo) los nodos que no son esta máquina. */
    @Override
    public List<String> nodosSinRespuesta(List<String> hosts) {
        Map<String, Future<Boolean>> pruebas = new LinkedHashMap<>();
        for (String h : hosts) {
            if (cfg.nodosLocales().contains(h)) continue;
            pruebas.put(h, hilos.submit(() -> responde(h)));
        }
        List<String> caidos = new ArrayList<>();
        pruebas.forEach((h, f) -> {
            try {
                if (!f.get(10, TimeUnit.SECONDS)) caidos.add(h);
            } catch (Exception e) {
                caidos.add(h);
            }
        });
        return caidos;
    }

    private boolean responde(String host) {
        List<String> cmd = new ArrayList<>(cfg.ssh());
        cmd.addAll(List.of("-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=accept-new",
                host, "true"));
        try {
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!p.waitFor(8, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return false;
            }
            return p.exitValue() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static void anexar(StringBuilder s, Path archivo, String titulo, int maxBytes) {
        if (!Files.exists(archivo)) return;
        try (RandomAccessFile f = new RandomAccessFile(archivo.toFile(), "r")) {
            long largo = f.length();
            if (largo == 0) return;
            long desde = Math.max(0, largo - maxBytes);
            byte[] buf = new byte[(int) (largo - desde)];
            f.seek(desde);
            f.readFully(buf);
            s.append("=== ").append(titulo).append(desde > 0 ? " (últimos " + buf.length + " bytes)" : "")
                    .append(" ===\n").append(new String(buf, StandardCharsets.UTF_8));
            if (s.charAt(s.length() - 1) != '\n') s.append('\n');
        } catch (IOException ignorado) {
            // se omite esa sección
        }
    }
}
