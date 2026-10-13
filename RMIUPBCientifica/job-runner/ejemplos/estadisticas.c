/*
 * Ejemplo de trabajo HPC con DATASET: media, mínimo y máximo de una columna de
 * números (un valor por línea o separados por comas), repartida entre procesos.
 *
 * El dataset llega como primer argumento (job-runner lo deja en el directorio
 * del trabajo, visible por NFS en todos los nodos). Ejemplo: ejemplos/numeros.csv
 */
#include <mpi.h>
#include <stdio.h>
#include <stdlib.h>
#include <float.h>

int main(int argc, char **argv) {
    MPI_Init(&argc, &argv);
    int rango, total;
    MPI_Comm_rank(MPI_COMM_WORLD, &rango);
    MPI_Comm_size(MPI_COMM_WORLD, &total);
    if (argc < 2) {
        if (rango == 0) fprintf(stderr, "Falta el dataset (rutaDataset)\n");
        MPI_Abort(MPI_COMM_WORLD, 2);
    }

    /* Cada proceso lee el archivo y se queda con los valores i % total == rango. */
    FILE *f = fopen(argv[1], "r");
    if (!f) {
        fprintf(stderr, "rango %d: no puedo abrir %s\n", rango, argv[1]);
        MPI_Abort(MPI_COMM_WORLD, 3);
    }
    double v, suma = 0, minimo = DBL_MAX, maximo = -DBL_MAX;
    long i = 0, mios = 0;
    while (fscanf(f, " %lf%*[,;\n ]", &v) == 1) {
        if (i++ % total == rango) {
            suma += v;
            mios++;
            if (v < minimo) minimo = v;
            if (v > maximo) maximo = v;
        }
    }
    fclose(f);

    double sumaT, minT, maxT;
    long n;
    MPI_Reduce(&suma, &sumaT, 1, MPI_DOUBLE, MPI_SUM, 0, MPI_COMM_WORLD);
    MPI_Reduce(&mios, &n, 1, MPI_LONG, MPI_SUM, 0, MPI_COMM_WORLD);
    MPI_Reduce(&minimo, &minT, 1, MPI_DOUBLE, MPI_MIN, 0, MPI_COMM_WORLD);
    MPI_Reduce(&maximo, &maxT, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);
    printf("rango %d/%d: %ld valores\n", rango, total, mios);
    if (rango == 0 && n > 0) {
        printf("n=%ld media=%.6f min=%.6f max=%.6f\n", n, sumaT / n, minT, maxT);
    }
    MPI_Finalize();
    return 0;
}
