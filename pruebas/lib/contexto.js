/**
 * Contexto que reciben las suites: configuración, informe, sesiones de los
 * usuarios de prueba, clientes ya autenticados y limpieza al final.
 *
 * Todo lo que crean las pruebas lleva el prefijo "e2e-<id>-" para reconocerlo
 * en el Home y no confundirlo con datos reales.
 */
const { Informe, colores } = require("./informe");
const { cargarConfig } = require("./config");
const { iniciarSesion, cerrarSesion } = require("./auth");
const clientes = require("./clientes");

const ID_EJECUCION = new Date().toISOString().replace(/\D/g, "").slice(2, 14);

/** Sesiones compartidas por todas las suites de una ejecución (uid -> sesión). */
const sesiones = new Map();

class Contexto {
    constructor(cfg, informe) {
        this.cfg = cfg;
        this.informe = informe;
        this.id = ID_EJECUCION;
        this.limpiezas = [];
    }

    nombre(sufijo) {
        return `e2e-${this.id}-${sufijo}`;
    }

    /** Sesión de un rol de entornos.json: principal, otro o restringido. */
    async sesion(rol) {
        const usuario = this.cfg.usuarios[rol];
        if (!usuario) throw new Error(`Rol de usuario desconocido: ${rol}`);
        if (!sesiones.has(usuario.uid)) sesiones.set(usuario.uid, await iniciarSesion(this.cfg, usuario));
        return sesiones.get(usuario.uid);
    }

    /** Clientes de todos los servicios con el token del rol. */
    async como(rol) {
        const { token, uid } = await this.sesion(rol);
        return {
            uid, token,
            storage: clientes.storage(this.cfg, token),
            compartidos: clientes.compartidos(this.cfg, token),
            medios: clientes.medios(this.cfg, token),
            hpc: clientes.hpc(this.cfg, token),
        };
    }

    /**
     * node-soap entrega el MISMO token a todos los inicios de sesión de un
     * usuario: cerrar una sesión de prueba cierra también la guardada aquí.
     * Las pruebas de logout llaman a esto para que lo siguiente inicie sesión de nuevo.
     */
    olvidarSesiones() {
        sesiones.clear();
    }

    get modoSoap() {
        return this.cfg.auth.modo === "soap";
    }

    /** Registra algo que deshacer al terminar la suite (en orden inverso). */
    alFinal(descripcion, fn) {
        this.limpiezas.push({ descripcion, fn });
    }

    async limpiar() {
        if (!this.cfg.limpiar) {
            if (this.limpiezas.length) console.log(colores.gris(`\n  (--sin-limpiar: quedan ${this.limpiezas.length} elementos de prueba)`));
            return;
        }
        for (const { descripcion, fn } of this.limpiezas.reverse()) {
            try { await fn(); } catch (e) {
                console.log(colores.amarillo(`  aviso: no se pudo limpiar ${descripcion}: ${e.message}`));
            }
        }
        this.limpiezas = [];
    }
}

async function cerrarSesiones(cfg) {
    for (const s of sesiones.values()) await cerrarSesion(cfg, s.token);
    sesiones.clear();
}

/** Ejecuta una suite como script independiente: node e2e/03-storage.js --entorno local */
async function ejecutarSolo(suite) {
    const cfg = cargarConfig();
    const informe = new Informe(suite.nombre, { detalle: cfg.detalle });
    const ctx = new Contexto(cfg, informe);
    console.log(`\n▶ ${suite.nombre}  (entorno ${cfg.nombre}, auth ${cfg.auth.modo}, id ${ctx.id})`);
    try {
        await suite.ejecutar(ctx);
    } catch (e) {
        console.log(colores.rojo(`\n  La suite se detuvo: ${e.message}`));
        informe.resultados.push({ suite: suite.nombre, nombre: "(suite)", resultado: "FALLA", motivo: e.message });
    } finally {
        await ctx.limpiar();
        await cerrarSesiones(cfg);
    }
    const c = informe.contar();
    console.log(`\n  ${c.OK} OK · ${c.FALLA} fallas · ${c.OMITIDA} omitidas`);
    // exitCode y no exit(): en Windows, salir con sockets de fetch abiertos aborta Node.
    process.exitCode = c.FALLA === 0 ? 0 : 1;
}

module.exports = { Contexto, ejecutarSolo, cerrarSesiones, ID_EJECUCION };
