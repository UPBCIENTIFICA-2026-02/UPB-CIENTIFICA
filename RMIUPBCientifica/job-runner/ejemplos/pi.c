/*
 * Ejemplo de trabajo HPC: aproxima pi por integración numérica repartida entre
 * los procesos MPI y la reúne con MPI_Reduce.
 *
 * Subirlo al Home (p. ej. /Proyectos/pi.c) y enviarlo desde cualquier cliente
 * con N procesos. Parámetro opcional: pasos=<n> (por defecto 100000000).
 * job-runner lo compila con:  mpicc -O2 -o programa pi.c -lm
 */
#include <mpi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    MPI_Init(&argc, &argv);
    int rango, total, largo;
    char nodo[MPI_MAX_PROCESSOR_NAME];
    MPI_Comm_rank(MPI_COMM_WORLD, &rango);
    MPI_Comm_size(MPI_COMM_WORLD, &total);
    MPI_Get_processor_name(nodo, &largo);

    long pasos = 100000000;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "pasos=", 6) == 0) pasos = atol(argv[i] + 6);
    }

    double inicio = MPI_Wtime();
    double h = 1.0 / (double) pasos, suma = 0.0;
    for (long i = rango; i < pasos; i += total) {
        double x = h * ((double) i + 0.5);
        suma += 4.0 / (1.0 + x * x);
    }
    double parcial = h * suma, pi = 0.0;
    MPI_Reduce(&parcial, &pi, 1, MPI_DOUBLE, MPI_SUM, 0, MPI_COMM_WORLD);

    printf("rango %d/%d en %s: suma parcial %.12f\n", rango, total, nodo, parcial);
    if (rango == 0) {
        printf("pi ~= %.15f con %ld pasos en %.3f s\n", pi, pasos, MPI_Wtime() - inicio);
        FILE *f = fopen("resultado.txt", "w");
        if (f) {
            fprintf(f, "pi=%.15f\npasos=%ld\nprocesos=%d\n", pi, pasos, total);
            fclose(f);
        }
    }
    MPI_Finalize();
    return 0;
}
