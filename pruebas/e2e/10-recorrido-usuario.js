/**
 * 10 — Recorrido completo de un usuario, como lo vive en el portal web.
 *
 * Es LA prueba de punta a punta: todo pasa por node-web (/api/*), igual que
 * el navegador, y cruza Authentication, Storage, Shared File, Media y HPC en
 * una sola historia. Si las suites anteriores pasan y esta falla, el problema
 * está en cómo encajan los servicios, no en uno de ellos.
 *
 *  1. Ana (principal) y Beto (otro) inician sesión en el portal.
 *  2. Ana sube una foto, un programa MPI y su dataset.
 *  3. Ana comparte la foto con Beto; Beto la ve en su álbum y la abre.
 *  4. Ana lanza el programa en el clúster y el resultado vuelve a su Home.
 *  5. Ana deja de compartir: Beto pierde el acceso.
 *  6. Ana borra todo y los dos cierran sesión: sus tokens dejan de valer.
 */
const { pedir, formularioArchivo } = require("../lib/http");
const { generarPng, programaMpi, DATASET } = require("../lib/datos");
const { iniciarSesion } = require("../lib/auth");
const { verificar, igual, estado, requiere } = require("../lib/informe");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINALES = ["COMPLETADO", "COMPLETADO_PENDIENTE_ALMACENAMIENTO", "FALLIDO", "FALLIDO_TIMEOUT", "CANCELADO"];

async function ejecutar(ctx) {
    const { cfg, informe } = ctx;
    const web = cfg.web.api;
    const sesion = {};
    const como = (quien) => (ruta, opciones = {}) => pedir(`${web}/api${ruta}`, { token: sesion[quien]?.token, ...opciones });
    const ana = como("ana");
    const beto = como("beto");
    const png = generarPng(32, 32, 99);
    const { extension, codigo } = programaMpi(cfg.hpcLenguaje);
    const creados = {};

    const subir = async (nombre, contenido, tipo) => {
        const r = await ana("/storage/archivos?directorioDestino=root", {
            metodo: "POST", formulario: formularioArchivo(nombre, contenido, tipo),
        });
        estado(r, 201, `subida de ${nombre}`);
        // Limpieza con la sesión del contexto: la de Ana se cierra al final.
        ctx.alFinal(nombre, async () => (await ctx.como("principal")).storage.eliminar(r.json.id));
        return r.json;
    };

    informe.seccion("1. Inicio de sesión en el portal");
    for (const [quien, rol] of [["ana", "principal"], ["beto", "otro"]]) {
        const u = cfg.usuarios[rol];
        await informe.prueba(`${quien} (${u.uid}) entra por POST /api/sesion`, async () => {
            if (!ctx.modoSoap) {
                sesion[quien] = await iniciarSesion(cfg, u); // modo simulado: token fabricado
                return;
            }
            const r = await pedir(`${web}/api/sesion`, { metodo: "POST", json: { usuario: u.uid, contrasena: u.clave, origenCliente: "web" } });
            estado(r, 200);
            sesion[quien] = { token: r.json.token, uid: u.uid };
        });
    }
    if (!sesion.ana || !sesion.beto) {
        await informe.omitir("resto del recorrido", "sin las dos sesiones no se puede seguir");
        return;
    }

    informe.seccion("2. Ana sube sus archivos");
    await informe.prueba("foto, programa y dataset quedan en su Home", async () => {
        creados.foto = await subir(ctx.nombre("recorrido.png"), png, "image/png");
        creados.codigo = await subir(ctx.nombre(`recorrido.${extension}`), codigo, "text/plain");
        creados.dataset = await subir(ctx.nombre("recorrido.csv"), DATASET, "text/csv");
        const l = await ana("/storage/directorios/root");
        for (const a of Object.values(creados)) verificar(l.json.some((n) => n.id === a.id), `${a.nombre} no está en el Home`);
    });

    informe.seccion("3. Compartir la foto");
    await informe.prueba("Ana comparte la foto con Beto (LECTURA)", async () => {
        requiere(creados.foto, "no hay foto");
        const r = await ana("/shared-file/compartir", {
            metodo: "POST",
            json: { archivoId: creados.foto.id, destinatarioTipo: "USUARIO", destinatarioId: sesion.beto.uid, nivelPermiso: "LECTURA" },
        });
        estado(r, 201);
        creados.comparticion = r.json.compartidoId;
        ctx.alFinal("compartición del recorrido", async () => (await ctx.como("principal")).compartidos.revocar(creados.comparticion));
    });
    await informe.prueba("Beto la ve en 'Compartidos conmigo' y en su álbum, y la abre", async () => {
        requiere(creados.comparticion, "no se compartió");
        const c = await beto("/shared-file/compartidos-conmigo");
        verificar(c.json.some((f) => f.elementoId === creados.foto.id), "no está en compartidos-conmigo");
        await beto("/album/indexar", { metodo: "POST", tiempoMs: 120000 });
        const fotos = await beto("/album/fotos?pagina=0", { tiempoMs: 120000 });
        const vista = fotos.json.find((f) => f.titulo?.includes(ctx.id));
        verificar(vista, "no aparece en su álbum");
        igual(vista.compartido, true, "compartido");
        creados.medioBeto = vista.id;
        const contenido = await beto(`/album/fotos/${vista.id}/contenido`);
        estado(contenido, 200);
        verificar(contenido.bytes.equals(png), "la foto llegó distinta");
    });

    informe.seccion("4. Cómputo en el clúster");
    await informe.prueba(`Ana lanza el programa y termina COMPLETADO (máx. ${cfg.hpcEsperaSeg} s)`, async () => {
        requiere(creados.codigo, "no hay programa");
        const r = await ana("/jobs", {
            metodo: "POST",
            json: { nombreTrabajo: ctx.nombre("recorrido"), rutaCodigo: creados.codigo.id, rutaDataset: creados.dataset.id, numeroProcesos: 2, tiempoMaximoEjecucion: 120 },
        });
        estado(r, 201);
        creados.trabajo = r.json.trabajoId;
        const limite = Date.now() + cfg.hpcEsperaSeg * 1000;
        let t;
        do {
            await esperar(2000);
            t = (await ana(`/jobs/${creados.trabajo}`)).json; // lo mismo que hace la web cada 3 s
        } while (!TERMINALES.includes(t?.estado) && Date.now() < limite);
        igual(t?.estado, "COMPLETADO", `estado final (${t?.mensajeError || "sin mensaje"})`);
    });
    await informe.prueba("el resultado aparece en 'Resultados HPC' de su Home", async () => {
        requiere(creados.trabajo, "no hubo trabajo");
        const res = await ana(`/jobs/${creados.trabajo}/resultado`);
        estado(res, 200);
        const raiz = (await ana("/storage/directorios/root")).json.find((n) => n.nombre === "Resultados HPC");
        verificar(raiz, "no existe 'Resultados HPC'");
        const carpeta = (await ana(`/storage/directorios/${raiz.id}`)).json.find((n) => n.nombre.includes(ctx.id));
        verificar(carpeta, "no está la carpeta del trabajo");
        const archivos = (await ana(`/storage/directorios/${carpeta.id}`)).json.filter((n) => n.tipo === "archivo");
        let salida = "";
        for (const a of archivos) {
            ctx.alFinal(`resultado ${a.nombre}`, async () => (await ctx.como("principal")).storage.eliminar(a.id));
            salida += (await ana(`/storage/archivos/${a.id}/descargar`)).bytes.toString();
        }
        verificar(salida.includes("suma=500500"), "la salida del programa no está en el resultado", salida.slice(0, 300));
    });

    informe.seccion("5. Dejar de compartir");
    await informe.prueba("Ana revoca y Beto pierde el acceso al instante", async () => {
        requiere(creados.comparticion, "no se compartió");
        estado(await ana(`/shared-file/compartir/${creados.comparticion}`, { metodo: "DELETE" }), 204);
        estado(await beto(`/storage/archivos/${creados.foto.id}/descargar`), 404, "descarga directa");
        if (creados.medioBeto) estado(await beto(`/album/fotos/${creados.medioBeto}/contenido`), [403, 404], "desde el álbum");
    });

    informe.seccion("6. Limpieza y cierre de sesión");
    await informe.prueba("Ana borra sus archivos", async () => {
        for (const a of [creados.foto, creados.codigo, creados.dataset].filter(Boolean)) {
            estado(await ana(`/storage/archivos/${a.id}`, { metodo: "DELETE" }), 204, a.nombre);
        }
    });
    await informe.prueba("ambos cierran sesión y sus tokens dejan de valer", async () => {
        requiere(ctx.modoSoap, "modo simulado: los tokens no se revocan");
        for (const quien of ["ana", "beto"]) estado(await como(quien)("/sesion", { metodo: "DELETE" }), 204, quien);
        ctx.olvidarSesiones(); // mismo token por usuario: la limpieza tiene que iniciar sesión de nuevo
        await esperar(6000);
        for (const quien of ["ana", "beto"]) estado(await como(quien)("/storage/cuota"), 401, quien);
    });
}

module.exports = { nombre: "10 Recorrido completo de usuario (portal)", ejecutar };
if (require.main === module) require("../lib/contexto").ejecutarSolo(module.exports);
