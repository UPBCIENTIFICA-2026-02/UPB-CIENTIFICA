/**
 * 11 — Ejecución DISTRIBUIDA de un trabajo MPI en el clúster real.
 *
 * Objetivo: comprobar que un trabajo enviado por la API no solo termina, sino
 * que de verdad se reparte entre varias máquinas y que sus procesos se
 * comunican. El programa (C, compilado con mpicc en hpc-master):
 *
 *   1. Cada proceso averigua en qué máquina corre (MPI_Get_processor_name) y
 *      el proceso 0 los reúne con MPI_Gather → se sabe cuántos nodos distintos
 *      participaron.
 *   2. Un ANILLO de MPI_Send/MPI_Recv: un testigo pasa por todos los procesos
 *      y cada uno le suma su rango. Si llega a 0 con 0+1+…+(n-1), hubo
 *      comunicación real entre procesos (y entre máquinas).
 *   3. Cada proceso lee el MISMO dataset (lo dejó job-runner en /srv/home,
 *      compartido por NFS) y suma solo sus líneas; MPI_Reduce junta las sumas
 *      parciales. El total debe ser la suma exacta del dataset.
 *
 * Requiere el clúster encendido: si el gestor no ve al ejecutor, la primera
 * prueba FALLA y el resto se OMITE (no se mezcla "clúster apagado" con "bug").
 *
 *   node e2e/11-mpi-distribuido.js --entorno vps --ca ...   [--mpi-procesos 8]
 */
const { verificar, igual, estado, requiere } = require("../lib/informe");
const { leerArgumentos } = require("../lib/config");

const PROGRAMA = `#include <mpi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    int rango, total, largo;
    char host[MPI_MAX_PROCESSOR_NAME];
    MPI_Init(&argc, &argv);
    MPI_Comm_rank(MPI_COMM_WORLD, &rango);
    MPI_Comm_size(MPI_COMM_WORLD, &total);
    memset(host, 0, sizeof host);
    MPI_Get_processor_name(host, &largo);
    double t0 = MPI_Wtime();

    /* 1. Dónde corre cada proceso */
    char *hosts = NULL;
    if (rango == 0) hosts = calloc((size_t)total, MPI_MAX_PROCESSOR_NAME);
    MPI_Gather(host, MPI_MAX_PROCESSOR_NAME, MPI_CHAR, hosts, MPI_MAX_PROCESSOR_NAME, MPI_CHAR, 0, MPI_COMM_WORLD);

    /* 2. Anillo: el testigo recorre todos los procesos */
    long testigo = 0;
    if (total > 1) {
        if (rango == 0) {
            MPI_Send(&testigo, 1, MPI_LONG, 1, 7, MPI_COMM_WORLD);
            MPI_Recv(&testigo, 1, MPI_LONG, total - 1, 7, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
        } else {
            MPI_Recv(&testigo, 1, MPI_LONG, rango - 1, 7, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
            testigo += rango;
            MPI_Send(&testigo, 1, MPI_LONG, (rango + 1) % total, 7, MPI_COMM_WORLD);
        }
    }

    /* 3. Suma repartida del dataset compartido */
    long long parcial = 0, suma = 0;
    long mias = 0, lineas = 0;
    for (int i = 1; i < argc; i++) {
        FILE *f = fopen(argv[i], "r");
        if (!f) continue;
        char linea[64];
        long n = 0;
        while (fgets(linea, sizeof linea, f)) {
            if (n % total == rango) { parcial += atoll(linea); mias++; }
            n++;
        }
        lineas = n;
        fclose(f);
    }
    MPI_Reduce(&parcial, &suma, 1, MPI_LONG_LONG, MPI_SUM, 0, MPI_COMM_WORLD);
    long totalMias = 0;
    MPI_Reduce(&mias, &totalMias, 1, MPI_LONG, MPI_SUM, 0, MPI_COMM_WORLD);
    double t1 = MPI_Wtime();

    if (rango == 0) {
        for (int r = 0; r < total; r++) printf("NODO rango=%d host=%s\\n", r, hosts + (size_t)r * MPI_MAX_PROCESSOR_NAME);
        printf("ANILLO testigo=%ld\\n", testigo);
        printf("RESULTADO procesos=%d lineas=%ld repartidas=%ld suma=%lld segundos=%.3f\\n",
               total, lineas, totalMias, suma, t1 - t0);
        fflush(stdout);
        free(hosts);
    }
    MPI_Finalize();
    return 0;
}
`;

const LINEAS_DATASET = 100000;
const DATASET = Array.from({ length: LINEAS_DATASET }, (_, i) => String(i + 1)).join("\n") + "\n";
const SUMA_ESPERADA = (LINEAS_DATASET * (LINEAS_DATASET + 1)) / 2; // 5 000 050 000

const TERMINALES = new Set(["COMPLETADO", "COMPLETADO_PENDIENTE_ALMACENAMIENTO", "FALLIDO", "FALLIDO_TIMEOUT", "CANCELADO"]);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const yo = await ctx.como("principal");
    const procesosPedidos = Number(leerArgumentos()["mpi-procesos"] || 8);
    let cluster, codigoId, datasetId, trabajo, final, salida = "";

    informe.seccion("Estado del clúster visto por el gestor");
    await informe.prueba("el gestor está conectado al ejecutor MPI (job-runner en hpc-master)", async () => {
        const r = await yo.hpc.cluster();
        estado(r, 200);
        cluster = r.json;
        console.log(`            nodos: ${cluster.nodosTotales} (disponibles ${cluster.nodosDisponibles}, ` +
            `en falla ${cluster.nodosEnFalla}) · procesos: ${cluster.procesosTotales}`);
        for (const n of cluster.nodos || []) {
            console.log(`              - ${String(n.id).padEnd(12)} ${String(n.estado).padEnd(11)} ${n.capacidadProcesos} procesos (${n.origen})`);
        }
        verificar(cluster.ejecutorConectado === true,
            "el gestor no ve a job-runner: enciende las 4 VMs del clúster y comprueba el servicio job-runner en hpc-master");
    });
    await informe.prueba("hay al menos 2 nodos de cómputo disponibles", async () => {
        requiere(cluster?.ejecutorConectado, "clúster no conectado");
        verificar(cluster.nodosDisponibles >= 2, `solo ${cluster.nodosDisponibles} nodo(s) disponible(s)`);
    });
    const listo = () => requiere(cluster?.ejecutorConectado && cluster.nodosDisponibles >= 2, "clúster no disponible");

    informe.seccion("Envío del trabajo distribuido");
    await informe.prueba("subir el programa MPI en C y un dataset de 100 000 números", async () => {
        listo();
        const a = await yo.storage.subir(ctx.nombre("distribuido.c"), PROGRAMA);
        estado(a, 201, "programa");
        codigoId = a.json.id;
        ctx.alFinal("programa MPI", () => yo.storage.eliminar(codigoId));
        const b = await yo.storage.subir(ctx.nombre("numeros.txt"), DATASET);
        estado(b, 201, "dataset");
        datasetId = b.json.id;
        ctx.alFinal("dataset MPI", () => yo.storage.eliminar(datasetId));
    });
    const procesos = Math.min(procesosPedidos, cluster?.procesosTotales || procesosPedidos);
    await informe.prueba(`POST /jobs con ${procesos} procesos → 201`, async () => {
        requiere(datasetId, "no se subieron los archivos");
        const r = await yo.hpc.enviar({
            nombreTrabajo: ctx.nombre("mpi-distribuido"), rutaCodigo: codigoId, rutaDataset: datasetId,
            numeroProcesos: procesos, tiempoMaximoEjecucion: 300, prioridad: "ALTA",
        });
        estado(r, 201);
        trabajo = r.json;
    });
    await informe.prueba(`termina COMPLETADO (máx. ${cfg.hpcEsperaSeg} s)`, async () => {
        requiere(trabajo, "no se envió");
        const limite = Date.now() + cfg.hpcEsperaSeg * 1000;
        let visto = "";
        while (Date.now() < limite) {
            final = (await yo.hpc.consultar(trabajo.trabajoId)).json;
            if (final?.estado !== visto) { visto = final?.estado; console.log(`            estado: ${visto}`); }
            if (TERMINALES.has(final?.estado)) break;
            await esperar(2000);
        }
        igual(final?.estado, "COMPLETADO", `estado final (${final?.mensajeError || "sin mensaje"})`);
        salida = (await yo.hpc.logs(trabajo.trabajoId)).json?.logsEjecucion || "";
    });

    informe.seccion("Comprobaciones de la ejecución distribuida");
    const nodos = () => [...salida.matchAll(/^NODO rango=(\d+) host=(\S+)/gm)].map((m) => ({ rango: +m[1], host: m[2] }));
    await informe.prueba(`corrieron los ${procesos} procesos pedidos (un rango cada uno)`, async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no terminó");
        const n = nodos();
        igual(n.length, procesos, "procesos que reportaron");
        igual(new Set(n.map((x) => x.rango)).size, procesos, "rangos distintos");
    });
    await informe.prueba("los procesos se repartieron en VARIAS máquinas", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no terminó");
        const porHost = {};
        for (const { host } of nodos()) porHost[host] = (porHost[host] || 0) + 1;
        for (const [h, c] of Object.entries(porHost)) console.log(`              ${h.padEnd(14)} ${c} proceso(s)`);
        verificar(Object.keys(porHost).length >= 2, `todos los procesos corrieron en ${Object.keys(porHost).join(", ")}`);
    });
    await informe.prueba("comunicación entre procesos: el testigo dio la vuelta al anillo", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no terminó");
        const m = salida.match(/^ANILLO testigo=(\d+)/m);
        verificar(m, "el programa no imprimió el anillo");
        igual(Number(m[1]), (procesos * (procesos - 1)) / 2, "testigo (0+1+…+n-1)");
    });
    await informe.prueba("todos leyeron el mismo dataset (NFS) y la suma repartida es exacta", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no terminó");
        const m = salida.match(/^RESULTADO procesos=(\d+) lineas=(\d+) repartidas=(\d+) suma=(\d+) segundos=([\d.]+)/m);
        verificar(m, "el programa no imprimió el resultado");
        igual(Number(m[2]), LINEAS_DATASET, "líneas del dataset");
        igual(Number(m[3]), LINEAS_DATASET, "líneas repartidas entre procesos");
        igual(Number(m[4]), SUMA_ESPERADA, "suma");
        console.log(`            suma=${m[4]} en ${m[5]} s de cómputo MPI`);
    });
    await informe.prueba("el resultado quedó en 'Resultados HPC' del Home", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no terminó");
        const r = await yo.hpc.resultado(trabajo.trabajoId);
        estado(r, 200);
        verificar(JSON.stringify(r.json).includes("Resultados HPC"), `resultado: ${r.texto.slice(0, 200)}`);
    });
}

module.exports = { nombre: "11 Ejecución distribuida MPI en el clúster", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
