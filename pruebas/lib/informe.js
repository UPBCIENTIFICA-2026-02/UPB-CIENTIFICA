/**
 * Registro de resultados de las pruebas.
 *
 * Cada prueba es una función async. Dentro se usa verificar()/igual(): si
 * fallan lanzan un error y la prueba queda como FALLA, pero la suite sigue
 * (un fallo en Storage no debe impedir ver qué pasa en Media). requiere()
 * marca la prueba como OMITIDA cuando falta algo que dejó una prueba anterior.
 */

class FalloVerificacion extends Error {}
class Omision extends Error {}

function verificar(condicion, mensaje, detalle) {
    if (!condicion) {
        const e = new FalloVerificacion(mensaje);
        e.detalle = detalle;
        throw e;
    }
}

function igual(obtenido, esperado, mensaje) {
    verificar(obtenido === esperado, `${mensaje}: se esperaba ${JSON.stringify(esperado)} y llegó ${JSON.stringify(obtenido)}`);
}

/** Comprueba el estado HTTP y, si no cuadra, muestra el cuerpo para depurar. */
function estado(respuesta, esperado, mensaje = "estado HTTP") {
    const lista = Array.isArray(esperado) ? esperado : [esperado];
    verificar(lista.includes(respuesta.estado),
        `${mensaje}: se esperaba ${lista.join(" o ")} y llegó ${respuesta.estado}`,
        respuesta.texto?.slice(0, 400));
}

function requiere(valor, motivo) {
    if (valor === undefined || valor === null || valor === false) throw new Omision(motivo);
    return valor;
}

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo, t) => (COLOR ? `\x1b[${codigo}m${t}\x1b[0m` : t);
const verde = (t) => pintar(32, t);
const rojo = (t) => pintar(31, t);
const amarillo = (t) => pintar(33, t);
const gris = (t) => pintar(90, t);

class Informe {
    constructor(suite, { detalle = false } = {}) {
        this.suite = suite;
        this.detalle = detalle;
        this.resultados = [];
        this.seccionActual = "";
    }

    seccion(titulo) {
        this.seccionActual = titulo;
        console.log(`\n  ── ${titulo}`);
    }

    async prueba(nombre, fn) {
        let inicio = Date.now();
        const registro = { suite: this.suite, seccion: this.seccionActual, nombre };
        try {
            // Una prueba ejecutada en otro proceso puede devolver su propia duración.
            const devuelto = await fn();
            if (Number.isFinite(devuelto?.duracionMs)) inicio -= devuelto.duracionMs;
            registro.resultado = "OK";
            console.log(`    ${verde("OK     ")} ${nombre} ${gris(`(${Date.now() - inicio} ms)`)}`);
        } catch (e) {
            if (e instanceof Omision) {
                registro.resultado = "OMITIDA";
                registro.motivo = e.message;
                console.log(`    ${amarillo("OMITIDA")} ${nombre}\n            ${gris(e.message)}`);
            } else {
                registro.resultado = "FALLA";
                registro.motivo = e instanceof FalloVerificacion ? e.message : `${e.name}: ${e.message}`;
                console.log(`    ${rojo("FALLA  ")} ${nombre}\n            ${registro.motivo}`);
                if (e.detalle && this.detalle) console.log(gris(`            cuerpo: ${e.detalle}`));
                if (!(e instanceof FalloVerificacion) && this.detalle) console.log(gris(e.stack));
            }
        }
        registro.duracionMs = Date.now() - inicio;
        this.resultados.push(registro);
        return registro.resultado === "OK";
    }

    omitir(nombre, motivo) {
        return this.prueba(nombre, () => { throw new Omision(motivo); });
    }

    contar() {
        const c = { OK: 0, FALLA: 0, OMITIDA: 0 };
        for (const r of this.resultados) c[r.resultado]++;
        return c;
    }
}

module.exports = {
    Informe, verificar, igual, estado, requiere, Omision, FalloVerificacion,
    colores: { verde, rojo, amarillo, gris },
};
