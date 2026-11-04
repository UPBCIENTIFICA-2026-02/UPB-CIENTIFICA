/*
 * kmeans.c — K-means en paralelo con MPI (clúster HPC de UPB-CIENTÍFICA).
 *
 * Agrupa N puntos de D dimensiones en K grupos. Es el trabajo de prueba del
 * clúster: se puede lanzar a mano con mpirun o enviarlo desde el portal / las
 * apps (Cómputo HPC) como código fuente + dataset, igual que pi.c.
 *
 * ESTRATEGIA (lo que se explica en la sustentación)
 *   1. El rango 0 lee el dataset completo (o lo genera) y elige los K centroides
 *      iniciales con k-means++ (reproducible con "semilla").
 *   2. MPI_Bcast   reparte N, D y los centroides iniciales.
 *      MPI_Scatterv reparte los puntos: cada proceso se queda con ~N/P filas.
 *   3. En cada iteración, cada proceso, SOLO con sus puntos:
 *        - asigna cada punto al centroide más cercano (distancia euclidiana²),
 *        - acumula sumas por grupo, cuántos puntos tiene cada grupo y su SSE.
 *      MPI_Allreduce suma esos acumulados de todos los procesos; con eso TODOS
 *      calculan los mismos centroides nuevos (sin que nadie más los reparta).
 *   4. Se repite hasta que ningún centroide se mueva más de "tol" o se llegue a
 *      "iter" iteraciones.
 *   5. MPI_Gatherv junta en el rango 0 el grupo de cada punto (asignaciones.csv).
 *
 *   La parte paralela (paso 3) es O(N·K·D / P) por iteración; la comunicación
 *   es solo K·D + K + 1 números por iteración, sin importar N. Por eso escala.
 *
 * USO
 *   mpirun -np 8 --hostfile hostfile ./kmeans puntos.csv k=4 iter=100 tol=1e-6 semilla=42
 *   mpirun -np 8 --hostfile hostfile ./kmeans n=2000000 d=2 k=5        (sin dataset: lo genera)
 *
 *   El dataset va PRIMERO (así lo entrega job-runner) y después los parámetros
 *   clave=valor (los "parametrosEjecucion" del trabajo). Todos son opcionales:
 *     k=4            número de grupos
 *     iter=100       máximo de iteraciones
 *     tol=1e-6       umbral de convergencia (desplazamiento máximo de un centroide)
 *     semilla=42     semilla de k-means++ y del generador
 *     asignaciones=1 1 = escribir asignaciones.csv (0 para mediciones de tiempo)
 *     n=1000000      solo sin dataset: cuántos puntos generar
 *     d=2            solo sin dataset: dimensiones
 *
 *   Formato del dataset: CSV, una fila por punto, columnas numéricas separadas
 *   por coma, punto y coma, tabulador o espacio. Una primera línea de títulos
 *   (x,y,...) se ignora sola. Todas las filas deben tener las mismas columnas.
 *
 * SALIDA
 *   Por pantalla (salida.txt en el resultado del trabajo): una línea por rango
 *   con su nodo y cuántos puntos procesó, el resumen y los centroides.
 *   Archivos: centroides.csv y asignaciones.csv en el directorio de trabajo
 *   (job-runner los devuelve al Home, en "Resultados HPC/<nombre>-<id>/").
 *
 * COMPILAR
 *   mpicc -O2 -o kmeans kmeans.c -lm        (job-runner usa exactamente esto)
 */
#define _GNU_SOURCE
#include <mpi.h>
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
    int k;
    int max_iter;
    double tol;
    long semilla;
    int escribir_asignaciones;
    long n_generar;
    int d_generar;
    const char *dataset; /* NULL = generar */
} Parametros;

static void abortar(int rango, const char *mensaje) {
    if (rango == 0) fprintf(stderr, "kmeans: %s\n", mensaje);
    MPI_Abort(MPI_COMM_WORLD, 2);
}

static Parametros leer_parametros(int argc, char **argv) {
    Parametros p = {4, 100, 1e-6, 42, 1, 1000000, 2, NULL};
    for (int i = 1; i < argc; i++) {
        char *igual = strchr(argv[i], '=');
        if (!igual) {
            if (!p.dataset) p.dataset = argv[i];
            continue;
        }
        size_t largo = (size_t)(igual - argv[i]);
        const char *v = igual + 1;
        if (!strncmp(argv[i], "k", largo) && largo == 1) p.k = atoi(v);
        else if (!strncmp(argv[i], "iter", largo) && largo == 4) p.max_iter = atoi(v);
        else if (!strncmp(argv[i], "tol", largo) && largo == 3) p.tol = atof(v);
        else if (!strncmp(argv[i], "semilla", largo) && largo == 7) p.semilla = atol(v);
        else if (!strncmp(argv[i], "asignaciones", largo) && largo == 12) p.escribir_asignaciones = atoi(v);
        else if (!strncmp(argv[i], "n", largo) && largo == 1) p.n_generar = atol(v);
        else if (!strncmp(argv[i], "d", largo) && largo == 1) p.d_generar = atoi(v);
        /* parámetros desconocidos se ignoran: el portal puede mandar otros */
    }
    return p;
}

/* ---------------------------------------------------------------- lectura */

/* Cuenta columnas numéricas de una línea. Devuelve 0 si la línea no es numérica (títulos). */
static int columnas_numericas(char *linea, double *destino, int max) {
    int c = 0;
    char *p = linea;
    while (*p) {
        while (*p == ',' || *p == ';' || *p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
        if (!*p) break;
        char *fin;
        double v = strtod(p, &fin);
        if (fin == p) return 0; /* no es un número: línea de títulos o basura */
        if (destino && c < max) destino[c] = v;
        c++;
        p = fin;
    }
    return c;
}

/* Lee el CSV completo en memoria (solo el rango 0). */
static double *leer_csv(const char *ruta, long *n_salida, int *d_salida) {
    FILE *f = fopen(ruta, "r");
    if (!f) return NULL;
    size_t cap_linea = 1 << 16;
    char *linea = malloc(cap_linea);
    long n = 0, cap = 1 << 16;
    int d = 0;
    double *datos = NULL;
    double tmp[64];
    long numero_linea = 0;

    while (getline(&linea, &cap_linea, f) != -1) {
        numero_linea++;
        int c = columnas_numericas(linea, tmp, 64);
        if (c == 0) continue; /* títulos o línea vacía */
        if (d == 0) {
            if (c > 64) { fprintf(stderr, "kmeans: más de 64 columnas no soportadas\n"); exit(3); }
            d = c;
            datos = malloc((size_t)cap * d * sizeof(double));
        } else if (c != d) {
            fprintf(stderr, "kmeans: la línea %ld tiene %d columnas y se esperaban %d\n", numero_linea, c, d);
            exit(3);
        }
        if (n == cap) {
            cap *= 2;
            datos = realloc(datos, (size_t)cap * d * sizeof(double));
        }
        memcpy(datos + (size_t)n * d, tmp, (size_t)d * sizeof(double));
        n++;
    }
    free(linea);
    fclose(f);
    *n_salida = n;
    *d_salida = d;
    return datos;
}

/* Puntos alrededor de k centros aleatorios (para medir sin depender de un archivo). */
static double *generar_puntos(long n, int d, int k, long semilla) {
    srand48(semilla + 1000);
    double *centros = malloc((size_t)k * d * sizeof(double));
    for (int j = 0; j < k * d; j++) centros[j] = drand48() * 100.0;
    double *datos = malloc((size_t)n * d * sizeof(double));
    for (long i = 0; i < n; i++) {
        int g = (int)(i % k);
        for (int j = 0; j < d; j++) {
            /* Box-Muller: ruido normal con desviación 3 */
            double u1 = drand48(), u2 = drand48();
            if (u1 < 1e-12) u1 = 1e-12;
            double z = sqrt(-2.0 * log(u1)) * cos(2.0 * M_PI * u2);
            datos[(size_t)i * d + j] = centros[(size_t)g * d + j] + 3.0 * z;
        }
    }
    free(centros);
    return datos;
}

/* -------------------------------------------------------------- k-means++ */

static double distancia2(const double *a, const double *b, int d) {
    double s = 0;
    for (int j = 0; j < d; j++) {
        double t = a[j] - b[j];
        s += t * t;
    }
    return s;
}

/* Elige k centroides iniciales bien separados (Arthur y Vassilvitskii, 2007). */
static void kmeans_mas_mas(const double *datos, long n, int d, int k, long semilla, double *centroides) {
    srand48(semilla);
    double *dmin = malloc((size_t)n * sizeof(double));
    long primero = (long)(drand48() * n);
    memcpy(centroides, datos + (size_t)primero * d, (size_t)d * sizeof(double));
    for (long i = 0; i < n; i++) dmin[i] = distancia2(datos + (size_t)i * d, centroides, d);

    for (int c = 1; c < k; c++) {
        double total = 0;
        for (long i = 0; i < n; i++) total += dmin[i];
        double objetivo = drand48() * total, acumulado = 0;
        long elegido = n - 1;
        for (long i = 0; i < n; i++) {
            acumulado += dmin[i];
            if (acumulado >= objetivo) { elegido = i; break; }
        }
        memcpy(centroides + (size_t)c * d, datos + (size_t)elegido * d, (size_t)d * sizeof(double));
        for (long i = 0; i < n; i++) {
            double t = distancia2(datos + (size_t)i * d, centroides + (size_t)c * d, d);
            if (t < dmin[i]) dmin[i] = t;
        }
    }
    free(dmin);
}

/* ------------------------------------------------------------------ main */

int main(int argc, char **argv) {
    MPI_Init(&argc, &argv);
    int rango, total;
    MPI_Comm_rank(MPI_COMM_WORLD, &rango);
    MPI_Comm_size(MPI_COMM_WORLD, &total);

    double t_inicio = MPI_Wtime();
    Parametros prm = leer_parametros(argc, argv);
    if (prm.k < 1) abortar(rango, "k debe ser al menos 1");
    if (prm.max_iter < 1) abortar(rango, "iter debe ser al menos 1");

    /* ---- 1. El rango 0 obtiene los datos y los centroides iniciales ---- */
    long n = 0;
    int d = 0;
    double *todos = NULL;
    if (rango == 0) {
        if (prm.dataset) {
            todos = leer_csv(prm.dataset, &n, &d);
            if (!todos) {
                fprintf(stderr, "kmeans: no puedo abrir el dataset %s\n", prm.dataset);
                MPI_Abort(MPI_COMM_WORLD, 3);
            }
        } else {
            n = prm.n_generar;
            d = prm.d_generar;
            if (n < 1 || d < 1) abortar(rango, "n y d deben ser positivos");
            todos = generar_puntos(n, d, prm.k, prm.semilla);
        }
        if (n < prm.k) {
            fprintf(stderr, "kmeans: hay %ld puntos y se pidieron k=%d grupos\n", n, prm.k);
            MPI_Abort(MPI_COMM_WORLD, 3);
        }
    }

    /* ---- 2. Repartir tamaños, centroides iniciales y puntos ---- */
    long dims[2] = {n, d};
    MPI_Bcast(dims, 2, MPI_LONG, 0, MPI_COMM_WORLD);
    n = dims[0];
    d = (int)dims[1];
    int k = prm.k;

    double *centroides = malloc((size_t)k * d * sizeof(double));
    if (rango == 0) kmeans_mas_mas(todos, n, d, k, prm.semilla, centroides);
    MPI_Bcast(centroides, k * d, MPI_DOUBLE, 0, MPI_COMM_WORLD);

    /* Filas por proceso: las primeras N % P reciben una de más. */
    int *cuantos = malloc((size_t)total * sizeof(int));   /* en valores (filas·d) */
    int *desde = malloc((size_t)total * sizeof(int));
    int *filas = malloc((size_t)total * sizeof(int));
    int *filas_desde = malloc((size_t)total * sizeof(int));
    long base = n / total, sobra = n % total, acum = 0;
    for (int r = 0; r < total; r++) {
        long f = base + (r < sobra ? 1 : 0);
        if (f * d > 2147483647L) abortar(rango, "demasiados puntos por proceso: use más procesos");
        filas[r] = (int)f;
        filas_desde[r] = (int)acum;
        cuantos[r] = (int)(f * d);
        desde[r] = (int)(acum * d);
        acum += f;
    }
    int mis_filas = filas[rango];
    double *mios = malloc((size_t)(mis_filas > 0 ? mis_filas : 1) * d * sizeof(double));
    MPI_Scatterv(todos, cuantos, desde, MPI_DOUBLE, mios, cuantos[rango], MPI_DOUBLE, 0, MPI_COMM_WORLD);

    char nodo[256];
    gethostname(nodo, sizeof nodo);
    nodo[sizeof nodo - 1] = '\0';

    /* ---- 3. Iteraciones ---- */
    int *grupo = malloc((size_t)(mis_filas > 0 ? mis_filas : 1) * sizeof(int));
    double *sumas = malloc((size_t)k * d * sizeof(double));
    long *conteo = malloc((size_t)k * sizeof(long));
    double *buffer = malloc(((size_t)k * d + 1) * sizeof(double)); /* sumas + SSE en un solo Allreduce */
    long *conteo_global = malloc((size_t)k * sizeof(long));
    double sse = 0, desplazamiento = 0;
    int iteraciones = 0, convergio = 0;

    MPI_Barrier(MPI_COMM_WORLD);
    double t_calculo = MPI_Wtime();

    for (iteraciones = 1; iteraciones <= prm.max_iter; iteraciones++) {
        memset(sumas, 0, (size_t)k * d * sizeof(double));
        memset(conteo, 0, (size_t)k * sizeof(long));
        double sse_local = 0;

        for (int i = 0; i < mis_filas; i++) {
            const double *x = mios + (size_t)i * d;
            int mejor = 0;
            double dmejor = DBL_MAX;
            for (int c = 0; c < k; c++) {
                double t = distancia2(x, centroides + (size_t)c * d, d);
                if (t < dmejor) { dmejor = t; mejor = c; }
            }
            grupo[i] = mejor;
            conteo[mejor]++;
            sse_local += dmejor;
            double *s = sumas + (size_t)mejor * d;
            for (int j = 0; j < d; j++) s[j] += x[j];
        }

        memcpy(buffer, sumas, (size_t)k * d * sizeof(double));
        buffer[(size_t)k * d] = sse_local;
        MPI_Allreduce(MPI_IN_PLACE, buffer, k * d + 1, MPI_DOUBLE, MPI_SUM, MPI_COMM_WORLD);
        MPI_Allreduce(conteo, conteo_global, k, MPI_LONG, MPI_SUM, MPI_COMM_WORLD);
        sse = buffer[(size_t)k * d];

        /* Todos calculan los mismos centroides nuevos. Un grupo vacío conserva el anterior. */
        desplazamiento = 0;
        for (int c = 0; c < k; c++) {
            if (conteo_global[c] == 0) continue;
            double mov = 0;
            for (int j = 0; j < d; j++) {
                double nuevo = buffer[(size_t)c * d + j] / (double)conteo_global[c];
                double t = nuevo - centroides[(size_t)c * d + j];
                mov += t * t;
                centroides[(size_t)c * d + j] = nuevo;
            }
            if (mov > desplazamiento) desplazamiento = mov;
        }
        desplazamiento = sqrt(desplazamiento);
        if (desplazamiento <= prm.tol) { convergio = 1; break; }
    }
    if (iteraciones > prm.max_iter) iteraciones = prm.max_iter;

    double t_fin_calculo = MPI_Wtime();

    /* ---- 4. Quién hizo qué (evidencia de que corrió en todos los nodos) ---- */
    /* Se imprime por turnos para que las líneas no se mezclen. */
    for (int r = 0; r < total; r++) {
        if (r == rango) {
            printf("rango %d/%d en %s: %d puntos\n", rango, total, nodo, mis_filas);
            fflush(stdout);
        }
        MPI_Barrier(MPI_COMM_WORLD);
    }

    /* ---- 5. Asignaciones al rango 0 ---- */
    int *todas_asig = NULL;
    if (prm.escribir_asignaciones) {
        if (rango == 0) todas_asig = malloc((size_t)n * sizeof(int));
        MPI_Gatherv(grupo, mis_filas, MPI_INT, todas_asig, filas, filas_desde, MPI_INT, 0, MPI_COMM_WORLD);
    }

    double t_total = MPI_Wtime() - t_inicio;

    if (rango == 0) {
        printf("\n=== K-means (MPI) ===\n");
        printf("datos: %s\n", prm.dataset ? prm.dataset : "generados en el rango 0");
        printf("puntos=%ld dimensiones=%d k=%d procesos=%d\n", n, d, k, total);
        printf("iteraciones=%d convergio=%s desplazamiento_final=%.3e\n", iteraciones, convergio ? "si" : "no", desplazamiento);
        printf("sse=%.6f\n", sse);
        printf("tiempo_calculo=%.6f s\n", t_fin_calculo - t_calculo);
        printf("tiempo_total=%.6f s\n", t_total);
        printf("\ngrupo  puntos  centroide\n");
        for (int c = 0; c < k; c++) {
            printf("%5d  %6ld  (", c, conteo_global[c]);
            for (int j = 0; j < d; j++) printf("%s%.4f", j ? ", " : "", centroides[(size_t)c * d + j]);
            printf(")\n");
        }

        FILE *fc = fopen("centroides.csv", "w");
        if (fc) {
            fprintf(fc, "grupo,puntos");
            for (int j = 0; j < d; j++) fprintf(fc, ",x%d", j + 1);
            fprintf(fc, "\n");
            for (int c = 0; c < k; c++) {
                fprintf(fc, "%d,%ld", c, conteo_global[c]);
                for (int j = 0; j < d; j++) fprintf(fc, ",%.6f", centroides[(size_t)c * d + j]);
                fprintf(fc, "\n");
            }
            fclose(fc);
        }
        if (todas_asig) {
            FILE *fa = fopen("asignaciones.csv", "w");
            if (fa) {
                fprintf(fa, "punto,grupo\n");
                for (long i = 0; i < n; i++) fprintf(fa, "%ld,%d\n", i, todas_asig[i]);
                fclose(fa);
            }
        }
    }

    free(todas_asig);
    free(todos);
    free(mios);
    free(grupo);
    free(sumas);
    free(conteo);
    free(conteo_global);
    free(buffer);
    free(centroides);
    free(cuantos);
    free(desde);
    free(filas);
    free(filas_desde);
    MPI_Finalize();
    return 0;
}
