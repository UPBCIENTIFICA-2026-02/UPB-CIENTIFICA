package com.cluster.runner;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Hace de "programa del usuario" en las pruebas: recibe el código (ignorado),
 * el dataset y los parámetros, como los pasa job-runner.
 */
public final class ProgramaPrueba {

    private ProgramaPrueba() {
    }

    public static void main(String[] args) throws Exception {
        String rango = System.getenv().getOrDefault("OMPI_COMM_WORLD_RANK", "?");
        String tamano = System.getenv().getOrDefault("OMPI_COMM_WORLD_SIZE", "?");
        String dataset = args.length > 1 && Files.exists(Path.of(args[1])) ? Files.readString(Path.of(args[1])).trim() : "-";
        System.out.println("rango " + rango + " de " + tamano + " dataset=" + dataset);
        Files.writeString(Path.of("parcial-" + rango + ".txt"), "rango " + rango + "\n");
        for (String a : args) {
            if (a.equals("modo=fallar")) System.exit(3);
            if (a.equals("modo=dormir")) Thread.sleep(60_000);
        }
    }
}
