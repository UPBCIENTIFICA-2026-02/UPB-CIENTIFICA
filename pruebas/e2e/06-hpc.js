/**
 * 06 — Servicio HPC: job-api (REST 8082) → gestor-cluster (RMI) → job-runner (MPI).
 *
 * Contrato: docs/contratos/Contrato HPC.pdf. Recorrido completo: el código y
 * el dataset se suben a Storage, el gestor los descarga, job-runner compila y
 * lanza mpirun, y el resultado vuelve al Home ("Resultados HPC/").
 *
 * En el PC (-HpcLocal) mpirun es SIMULADO y solo ejecuta .py; con OpenMPI real
 * usa --hpc-lenguaje c para validar compilación con mpicc.
 *
 * Programa de prueba: lib/datos.js (PROGRAMA_PY / PROGRAMA_C).
 */
const { pedir } = require("../lib/http");
const { programaMpi, DATASET } = require("../lib/datos");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const TERMINALES = new Set(["COMPLETADO", "COMPLETADO_PENDIENTE_ALMACENAMIENTO", "FALLIDO", "FALLIDO_TIMEOUT", "CANCELADO"]);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarFin(hpc, id, segundos) {
    const limite = Date.now() + segundos * 1000;
    let ultimo;
    while (Date.now() < limite) {
        const r = await hpc.consultar(id);
        if (r.estado !== 200) throw new Error(`GET /jobs/${id} → ${r.estado}`);
        ultimo = r.json;
        if (TERMINALES.has(ultimo.estado)) return ultimo;
        await esperar(2000);
    }
    throw new Error(`el trabajo ${id} no terminó en ${segundos} s (último estado: ${ultimo?.estado})`);
}

async function esperarEstado(hpc, id, estados, segundos = 30) {
    const limite = Date.now() + segundos * 1000;
    while (Date.now() < limite) {
        const r = await hpc.consultar(id);
        if (estados.includes(r.json?.estado)) return r.json;
        await esperar(1000);
    }
    return (await hpc.consultar(id)).json;
}

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const yo = await ctx.como("principal");
    const otro = await ctx.como("otro");
    const hpc = yo.hpc;

    const { extension, codigo } = programaMpi(cfg.hpcLenguaje);
    let codigoId, datasetId, trabajo, final;

    const solicitud = (extra = {}) => ({
        nombreTrabajo: ctx.nombre("hpc"), rutaCodigo: codigoId, rutaDataset: datasetId,
        numeroProcesos: 2, tiempoMaximoEjecucion: 120, ...extra,
    });

    informe.seccion("Autenticación y estado del clúster");
    await informe.prueba("GET /jobs sin token → 401", async () => {
        estado(await pedir(`${cfg.hpc.api}/jobs`), 401);
    });
    await informe.prueba("GET /cluster/estado → nodos del clúster", async () => {
        const r = await hpc.cluster();
        estado(r, 200);
        verificar(typeof r.json.nodosTotales === "number", `forma inesperada: ${r.texto}`);
        verificar(r.json.nodosTotales > 0, "el gestor no tiene nodos registrados");
    });
    await informe.prueba("GET /jobs → arreglo (solo los del token)", async () => {
        const r = await hpc.listar();
        estado(r, 200);
        verificar(Array.isArray(r.json), "no es un arreglo");
    });

    informe.seccion("Preparación: código y dataset en Storage");
    await informe.prueba(`subir programa .${extension} y dataset`, async () => {
        const a = await yo.storage.subir(ctx.nombre(`programa.${extension}`), codigo);
        estado(a, 201, "programa");
        codigoId = a.json.id;
        ctx.alFinal("programa HPC", () => yo.storage.eliminar(codigoId));
        const b = await yo.storage.subir(ctx.nombre("datos.csv"), DATASET);
        estado(b, 201, "dataset");
        datasetId = b.json.id;
        ctx.alFinal("dataset HPC", () => yo.storage.eliminar(datasetId));
    });

    informe.seccion("Validaciones de EnviarTrabajo (Contrato_HPC §3.1)");
    const casos = [
        ["sin nombreTrabajo → 400", { nombreTrabajo: "" }, 400],
        ["numeroProcesos 0 → 400", { numeroProcesos: 0 }, 400],
        ["prioridad desconocida → 400", { prioridad: "URGENTE" }, 400],
        ["numeroProcesos excesivo → 422 HPC-003", { numeroProcesos: 100000 }, 422, "HPC-003"],
        ["tiempo excesivo → 422 HPC-005", { tiempoMaximoEjecucion: 100000000 }, 422, "HPC-005"],
        ["código inexistente → 404 HPC-001", { rutaCodigo: "/no-existe-e2e.c" }, 404, "HPC-001"],
        ["dataset inexistente → 404 HPC-002", { rutaDataset: "/no-existe-e2e.csv" }, 404, "HPC-002"],
    ];
    for (const [nombre, extra, esperado, codigoError] of casos) {
        await informe.prueba(nombre, async () => {
            requiere(codigoId, "no se subió el programa");
            const r = await hpc.enviar(solicitud(extra));
            estado(r, esperado);
            if (codigoError) igual(r.json?.codigo, codigoError, "código");
        });
    }
    await informe.prueba("extensión no soportada (.txt) → 422 HPC-004", async () => {
        requiere(datasetId, "no se subió el dataset");
        const r = await hpc.enviar(solicitud({ rutaCodigo: datasetId, rutaDataset: null }));
        estado(r, 422);
        igual(r.json?.codigo, "HPC-004", "código");
    });
    await informe.prueba("rutaCodigo de OTRO usuario → 404 (no lee archivos ajenos)", async () => {
        requiere(codigoId, "no se subió el programa");
        const r = await otro.hpc.enviar(solicitud());
        if (r.estado === 403) requiere(false, `${otro.uid} no tiene 'hpc' en su perfil`);
        estado(r, 404);
    });

    informe.seccion("Trabajo correcto, de punta a punta");
    await informe.prueba("POST /jobs → 201 con trabajoId", async () => {
        requiere(codigoId, "no se subió el programa");
        const r = await hpc.enviar(solicitud());
        estado(r, 201);
        trabajo = r.json;
        verificar(trabajo.trabajoId, "falta trabajoId");
        verificar(["PENDIENTE", "EN_COLA", "EJECUTANDO"].includes(trabajo.estadoInicial), `estadoInicial ${trabajo.estadoInicial}`);
    });
    await informe.prueba("aparece en GET /jobs y en /jobs/{id}/estado", async () => {
        requiere(trabajo, "no se envió");
        const l = await hpc.listar();
        verificar(l.json.some((t) => t.id === trabajo.trabajoId), "no está en la lista");
        estado(await hpc.estado(trabajo.trabajoId), 200);
    });
    await informe.prueba("otro usuario no ve el trabajo", async () => {
        requiere(trabajo, "no se envió");
        const r = await otro.hpc.consultar(trabajo.trabajoId);
        estado(r, [403, 404]);
    });
    await informe.prueba(`termina COMPLETADO (espera máx. ${cfg.hpcEsperaSeg} s)`, async () => {
        requiere(trabajo, "no se envió");
        final = await esperarFin(hpc, trabajo.trabajoId, cfg.hpcEsperaSeg);
        igual(final.estado, "COMPLETADO", `estado final (${final.mensajeError || "sin mensaje"})`);
        igual(final.codigoSalida, 0, "codigoSalida");
        verificar(final.nodosAsignados?.length > 0, "sin nodosAsignados");
    });
    await informe.prueba("los logs muestran la salida del programa (suma y dataset)", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no completó");
        const r = await hpc.logs(trabajo.trabajoId);
        estado(r, 200);
        const logs = r.json.logsEjecucion || "";
        verificar(logs.includes("E2E-OK"), "no aparece E2E-OK en los logs", logs.slice(0, 400));
        verificar(logs.includes("suma=500500"), "la suma 0..1000 no es 500500 (¿falló el reduce?)", logs.slice(0, 400));
        verificar(logs.includes("lineas=10"), "el programa no recibió el dataset", logs.slice(0, 400));
    });
    await informe.prueba("GET /jobs/{id}/resultado → carpeta en 'Resultados HPC'", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no completó");
        const r = await hpc.resultado(trabajo.trabajoId);
        estado(r, 200);
        verificar(r.json.rutaResultado?.includes("Resultados HPC"), `rutaResultado=${r.json.rutaResultado}`);
    });
    await informe.prueba("el resultado está de verdad en Storage (Home del usuario)", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no completó");
        const carpetaRes = await yo.storage.buscar("root", "Resultados HPC");
        verificar(carpetaRes, "no existe 'Resultados HPC' en el Home");
        const l = await yo.storage.listar(carpetaRes.id);
        const sub = l.json.find((n) => n.tipo === "directorio" && n.nombre.includes(ctx.id));
        verificar(sub, "no está la carpeta de este trabajo");
        const archivos = (await yo.storage.listar(sub.id)).json.filter((n) => n.tipo === "archivo");
        verificar(archivos.length > 0, "la carpeta del resultado está vacía");
        let encontrado = false;
        for (const a of archivos) {
            ctx.alFinal(`resultado ${a.nombre}`, () => yo.storage.eliminar(a.id));
            if ((await yo.storage.descargar(a.id)).bytes.toString().includes("E2E-OK")) encontrado = true;
        }
        verificar(encontrado, `ningún archivo del resultado contiene la salida (${archivos.map((a) => a.nombre)})`);
    });
    await informe.prueba("un trabajo COMPLETADO no se puede cancelar → 409 HPC-105", async () => {
        requiere(final?.estado === "COMPLETADO", "el trabajo no completó");
        const r = await hpc.cancelar(trabajo.trabajoId);
        estado(r, 409);
        igual(r.json?.codigo, "HPC-105", "código");
    });

    informe.seccion("Fallos controlados");
    let fallido;
    await informe.prueba("programa que sale con código 3 → FALLIDO con codigoSalida 3", async () => {
        requiere(codigoId, "no se subió el programa");
        const r = await hpc.enviar(solicitud({ nombreTrabajo: ctx.nombre("hpc-falla"), parametrosEjecucion: { salida: "3" } }));
        estado(r, 201);
        const f = await esperarFin(hpc, r.json.trabajoId, cfg.hpcEsperaSeg);
        igual(f.estado, "FALLIDO", "estado");
        verificar(f.codigoSalida !== 0, `codigoSalida=${f.codigoSalida}`);
        fallido = f.id;
    });
    await informe.prueba("reintentar el FALLIDO → 201 con un trabajo nuevo que apunta al original", async () => {
        requiere(fallido, "no hubo trabajo fallido");
        const r = await hpc.reintentar(fallido);
        estado(r, 201);
        verificar(r.json.trabajoId && r.json.trabajoId !== fallido, "no creó un trabajo nuevo");
        const nuevo = (await hpc.consultar(r.json.trabajoId)).json;
        igual(nuevo.trabajoOriginalId, fallido, "trabajoOriginalId");
        await esperarFin(hpc, r.json.trabajoId, cfg.hpcEsperaSeg); // vuelve a fallar: mismo programa
    });
    await informe.prueba("programa que excede tiempoMaximoEjecucion → FALLIDO_TIMEOUT", async () => {
        requiere(codigoId, "no se subió el programa");
        const r = await hpc.enviar(solicitud({
            nombreTrabajo: ctx.nombre("hpc-timeout"), tiempoMaximoEjecucion: 5, parametrosEjecucion: { espera: "60" },
        }));
        estado(r, 201);
        const f = await esperarFin(hpc, r.json.trabajoId, cfg.hpcEsperaSeg);
        igual(f.estado, "FALLIDO_TIMEOUT", "estado");
    });

    informe.seccion("Cancelar, prioridad y reintento");
    let largo;
    await informe.prueba("cancelar un trabajo en curso → CANCELADO", async () => {
        requiere(codigoId, "no se subió el programa");
        const r = await hpc.enviar(solicitud({ nombreTrabajo: ctx.nombre("hpc-cancelar"), parametrosEjecucion: { espera: "90" } }));
        estado(r, 201);
        largo = r.json.trabajoId;
        // Si en 20 s sigue en cola, la prueba sirve igual: se cancela en cola.
        await esperarEstado(hpc, largo, ["EJECUTANDO"], 20);
        const c = await hpc.cancelar(largo);
        estado(c, 200);
        igual(c.json.estadoFinal, "CANCELADO", "estadoFinal");
        igual((await hpc.consultar(largo)).json.estado, "CANCELADO", "estado consultado");
    });
    await informe.prueba("cambiar prioridad de un trabajo terminado → 409 HPC-108", async () => {
        requiere(largo, "no hubo trabajo cancelado");
        const r = await hpc.prioridad(largo, "BAJA");
        estado(r, 409);
        igual(r.json?.codigo, "HPC-108", "código");
    });
    await informe.prueba("reintentar un CANCELADO → 409 HPC-107 (solo FALLIDO y FALLIDO_TIMEOUT)", async () => {
        requiere(largo, "no hubo trabajo cancelado");
        const r = await hpc.reintentar(largo);
        estado(r, 409);
        igual(r.json?.codigo, "HPC-107", "código");
    });
    await informe.prueba("cambiar prioridad de un trabajo EN_COLA → 200", async () => {
        requiere(codigoId, "no se subió el programa");
        // Se llenan los procesos del clúster para que el siguiente quede en cola.
        const capacidad = Math.max(1, (await hpc.cluster()).json.procesosTotales || 8);
        const relleno = await hpc.enviar(solicitud({
            nombreTrabajo: ctx.nombre("hpc-relleno"), numeroProcesos: Math.min(capacidad, 8),
            parametrosEjecucion: { espera: "60" },
        }));
        const enCola = await hpc.enviar(solicitud({ nombreTrabajo: ctx.nombre("hpc-cola"), parametrosEjecucion: { espera: "60" } }));
        try {
            estado(enCola, 201);
            const e = (await esperarEstado(hpc, enCola.json.trabajoId, ["EN_COLA", "EJECUTANDO"], 10)).estado;
            requiere(e === "EN_COLA", `el trabajo no quedó en cola (estado ${e}); el clúster tiene hueco libre`);
            const r = await hpc.prioridad(enCola.json.trabajoId, "BAJA");
            estado(r, 200);
            igual(r.json.prioridad, "BAJA", "prioridad");
        } finally {
            if (enCola.json?.trabajoId) await hpc.cancelar(enCola.json.trabajoId);
            if (relleno.json?.trabajoId) await hpc.cancelar(relleno.json.trabajoId);
        }
    });
    await informe.prueba("filtro GET /jobs?estado=CANCELADO", async () => {
        requiere(largo, "no hubo trabajo cancelado");
        const r = await hpc.listar("CANCELADO");
        estado(r, 200);
        verificar(r.json.every((t) => t.estado === "CANCELADO"), "el filtro deja pasar otros estados");
        verificar(r.json.some((t) => t.id === largo), "no aparece el cancelado");
    });
}

module.exports = { nombre: "06 Servicio HPC (job-api → gestor → MPI)", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
