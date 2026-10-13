package com.cluster.runner;

import com.cluster.common.EstadoEjecucion;
import com.cluster.common.OrdenEjecucion;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Un trabajo en hpc-master: prepara su directorio compartido, compila y lanza
 * mpirun, y vigila el tiempo máximo. Corre en su propio hilo.
 *
 * Seguridad: no hay shell en ningún punto. El código del usuario se compila y
 * se ejecuta como el usuario del servicio (mpiuser, sin privilegios) y solo en
 * el clúster; los nombres de archivo se sanean y los parámetros llegan como
 * argumentos sueltos de argv. ANTES el gestor hacía {@code bash -c <comando>}
 * en node-rmi con lo que mandara el usuario (V-11).
 */
final class Ejecucion implements Runnable {

    static final String SALIDA = "salida.txt";
    static final String ERRORES = "errores.txt";
    static final String COMPILACION = "compilacion.txt";
    static final String PROGRAMA = "programa";
    static final String HOSTFILE = "hostfile";

    private final OrdenEjecucion orden;
    private final Configuracion cfg;
    final Path dir;
    final String archivoCodigo;
    final String archivoDataset;

    private volatile String fase = EstadoEjecucion.PREPARANDO;
    private volatile Integer codigoSalida;
    private volatile boolean errorCompilacion;
    private volatile boolean tiempoAgotado;
    private volatile boolean cancelado;
    private volatile String mensaje;
    private volatile Process proceso;

    Ejecucion(OrdenEjecucion orden, Configuracion cfg) {
        this.orden = orden;
        this.cfg = cfg;
        this.dir = cfg.dirTrabajos().resolve(orden.trabajoId());
        this.archivoCodigo = nombreSeguro(orden.nombreCodigo(), "codigo");
        String ds = orden.nombreDataset() == null ? null : nombreSeguro(orden.nombreDataset(), "dataset");
        this.archivoDataset = ds != null && ds.equals(archivoCodigo) ? "datos_" + ds : ds;
    }

    EstadoEjecucion estado() {
        return new EstadoEjecucion(fase, codigoSalida, errorCompilacion, tiempoAgotado, cancelado, mensaje);
    }

    @Override
    public void run() {
        try {
            preparar();
            List<String> programa = compilar();
            if (programa != null && !cancelado) {
                ejecutar(programa);
            }
        } catch (Exception e) {
            if (codigoSalida == null) codigoSalida = -1;
            mensaje = e.getMessage();
        } finally {
            fase = EstadoEjecucion.TERMINADO;
        }
    }

    void cancelar() {
        cancelado = true;
        terminarProceso();
    }

    private void preparar() throws IOException {
        Files.createDirectories(dir);
        Files.write(dir.resolve(archivoCodigo), orden.codigo());
        if (archivoDataset != null && orden.dataset() != null) {
            Files.write(dir.resolve(archivoDataset), orden.dataset());
        }
        StringBuilder hf = new StringBuilder();
        orden.hosts().forEach((host, procesos) -> hf.append(host).append(" slots=").append(procesos).append('\n'));
        Files.writeString(dir.resolve(HOSTFILE), hf.toString(), StandardCharsets.UTF_8);
    }

    /** @return el comando que ejecuta cada proceso MPI, o null si no compiló. */
    private List<String> compilar() throws Exception {
        String n = archivoCodigo.toLowerCase(Locale.ROOT);
        if (n.endsWith(".py")) {
            List<String> cmd = new ArrayList<>(cfg.python());
            cmd.add(dir.resolve(archivoCodigo).toString());
            return cmd;
        }
        List<String> compilador = new ArrayList<>(n.endsWith(".c") ? cfg.mpicc() : cfg.mpicxx());
        compilador.addAll(List.of("-O2", "-o", PROGRAMA, archivoCodigo));
        if (n.endsWith(".c")) compilador.add("-lm");

        fase = EstadoEjecucion.COMPILANDO;
        ProcessBuilder pb = new ProcessBuilder(compilador).directory(dir.toFile()).redirectErrorStream(true)
                .redirectOutput(dir.resolve(COMPILACION).toFile());
        Process p;
        try {
            p = pb.start();
        } catch (IOException e) {
            errorCompilacion = true;
            codigoSalida = 127;
            mensaje = "No se encontró el compilador MPI (" + compilador.get(0) + ") en hpc-master";
            Files.writeString(dir.resolve(COMPILACION), mensaje + "\n", StandardCharsets.UTF_8);
            return null;
        }
        proceso = p;
        if (!p.waitFor(120, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            errorCompilacion = true;
            codigoSalida = 124;
            mensaje = "La compilación tardó más de 120 s";
            return null;
        }
        if (p.exitValue() != 0) {
            errorCompilacion = true;
            codigoSalida = p.exitValue();
            return null;
        }
        return List.of(dir.resolve(PROGRAMA).toString());
    }

    private void ejecutar(List<String> programa) throws Exception {
        List<String> cmd = new ArrayList<>(cfg.mpirun());
        cmd.addAll(cfg.opcionesMpirun());
        cmd.addAll(List.of("--hostfile", dir.resolve(HOSTFILE).toString(),
                "-np", String.valueOf(orden.numeroProcesos())));
        cmd.addAll(programa);
        if (archivoDataset != null) cmd.add(dir.resolve(archivoDataset).toString());
        cmd.addAll(orden.argumentos());

        File salida = dir.resolve(SALIDA).toFile();
        File errores = dir.resolve(ERRORES).toFile();
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(dir.toFile())
                .redirectOutput(salida).redirectError(errores);
        Map<String, String> ambiente = pb.environment();
        ambiente.put("UPBC_TRABAJO", orden.trabajoId());
        fase = EstadoEjecucion.EJECUTANDO;
        Process p;
        try {
            p = pb.start();
        } catch (IOException e) {
            codigoSalida = 127;
            mensaje = "No se encontró mpirun (" + cmd.get(0) + ") en hpc-master";
            Files.writeString(errores.toPath(), mensaje + "\n", StandardCharsets.UTF_8);
            return;
        }
        proceso = p;
        if (cancelado) terminarProceso();
        if (!p.waitFor(orden.tiempoMaximoSegundos(), TimeUnit.SECONDS)) {
            tiempoAgotado = true;
            terminarProceso();
            p.waitFor(10, TimeUnit.SECONDS);
        }
        codigoSalida = p.isAlive() ? 137 : p.exitValue();
    }

    /** SIGTERM a mpirun (que reenvía a los procesos remotos) y, si no cede, SIGKILL. */
    private void terminarProceso() {
        Process p = proceso;
        if (p == null || !p.isAlive()) return;
        p.descendants().forEach(ProcessHandle::destroy);
        p.destroy();
        try {
            if (!p.waitFor(5, TimeUnit.SECONDS)) {
                p.descendants().forEach(ProcessHandle::destroyForcibly);
                p.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** "../../etc/passwd" -> "passwd"; solo letras, dígitos, punto, guion y subrayado. */
    static String nombreSeguro(String nombre, String porDefecto) {
        String base = nombre == null ? "" : nombre.replace('\\', '/');
        base = java.text.Normalizer.normalize(base.substring(base.lastIndexOf('/') + 1), java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("^\\.+", "");
        if (base.isEmpty() || base.equals(PROGRAMA) || base.equals(HOSTFILE)) return porDefecto + "_" + base;
        return base;
    }
}
