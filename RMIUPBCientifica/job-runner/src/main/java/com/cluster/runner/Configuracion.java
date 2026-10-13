package com.cluster.runner;

import java.net.InetAddress;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * Configuración de job-runner, leída de variables de entorno en el composition
 * root ({@link Main}).
 *
 *   DIR_TRABAJOS        directorio COMPARTIDO por NFS con todos los nodos
 *                       (/srv/home/.hpc-trabajos): mpirun lanza el binario en
 *                       cada nodo y todos tienen que verlo en la misma ruta
 *   MPICC / MPICXX      compiladores MPI (mpicc / mpicxx)
 *   MPIRUN              lanzador (mpirun)
 *   MPIRUN_OPCIONES     opciones extra, p. ej. "--mca btl_tcp_if_include 192.168.56.0/24"
 *   PYTHON              intérprete para programas mpi4py (python3)
 *   SSH                 cliente SSH para comprobar los nodos (ssh)
 *   NODOS_LOCALES       nombres que son esta misma máquina (no se comprueban por SSH)
 *   MAX_RESULTADOS_MB   tope de lo que se devuelve como resultado (200)
 *
 * Cada comando puede llevar argumentos ("py -3 C:\...\mpirun-simulado.py"): se
 * separa por espacios y se lanza SIN shell.
 */
public record Configuracion(Path dirTrabajos, List<String> mpicc, List<String> mpicxx, List<String> mpirun,
                            List<String> opcionesMpirun, List<String> python, List<String> ssh,
                            Set<String> nodosLocales, long maxResultadosBytes) {

    public static Configuracion desdeEntorno() {
        Set<String> locales = new TreeSet<>(List.of("localhost", "127.0.0.1"));
        try {
            locales.add(InetAddress.getLocalHost().getHostName());
        } catch (Exception ignorado) {
            // sin nombre de host resoluble: quedan localhost y 127.0.0.1
        }
        locales.addAll(lista(env("NODOS_LOCALES", "")));
        return new Configuracion(
                Path.of(env("DIR_TRABAJOS", "/srv/home/.hpc-trabajos")),
                lista(env("MPICC", "mpicc")),
                lista(env("MPICXX", "mpicxx")),
                lista(env("MPIRUN", "mpirun")),
                lista(env("MPIRUN_OPCIONES", "")),
                lista(env("PYTHON", "python3")),
                lista(env("SSH", "ssh")),
                locales,
                Long.parseLong(env("MAX_RESULTADOS_MB", "200")) * 1024 * 1024);
    }

    static List<String> lista(String texto) {
        List<String> partes = new ArrayList<>();
        Arrays.stream(texto.trim().split("[\\s,]+")).filter(p -> !p.isBlank()).forEach(partes::add);
        return partes;
    }

    private static String env(String clave, String porDefecto) {
        String v = System.getenv(clave);
        return v == null || v.isBlank() ? porDefecto : v;
    }
}
