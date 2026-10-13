package com.cluster.runner;

import java.util.ArrayList;
import java.util.List;

/**
 * SOLO PARA DESARROLLO (Windows sin OpenMPI): imita la línea de mpirun que
 * arma job-runner y lanza N copias del programa con las variables que pone
 * OpenMPI (OMPI_COMM_WORLD_RANK, OMPI_COMM_WORLD_SIZE). No hay comunicación
 * entre procesos: un programa que use MPI_Send/MPI_Reduce necesita el mpirun
 * real del clúster.
 *
 *   MPIRUN="java -cp job-runner.jar com.cluster.runner.MpirunSimulado"
 *
 * Uso: MpirunSimulado [--hostfile H] [-np N] programa [args...]
 */
public final class MpirunSimulado {

    private MpirunSimulado() {
    }

    public static void main(String[] args) throws Exception {
        int np = 1;
        int i = 0;
        while (i < args.length && args[i].startsWith("-")) {
            switch (args[i]) {
                case "-np", "-n" -> np = Integer.parseInt(args[++i]);
                case "--hostfile", "-hostfile", "--mca" -> i += args[i].equals("--mca") ? 2 : 1;
                default -> { }
            }
            i++;
        }
        List<String> programa = List.of(args).subList(i, args.length);
        if (programa.isEmpty()) {
            System.err.println("mpirun-simulado: falta el programa");
            System.exit(2);
        }
        List<Process> procesos = new ArrayList<>();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> procesos.forEach(Process::destroyForcibly)));
        for (int rango = 0; rango < np; rango++) {
            ProcessBuilder pb = new ProcessBuilder(programa).inheritIO();
            pb.environment().put("OMPI_COMM_WORLD_RANK", String.valueOf(rango));
            pb.environment().put("OMPI_COMM_WORLD_SIZE", String.valueOf(np));
            procesos.add(pb.start());
        }
        int codigo = 0;
        for (Process p : procesos) {
            codigo = Math.max(codigo, p.waitFor());
        }
        System.exit(codigo);
    }
}
