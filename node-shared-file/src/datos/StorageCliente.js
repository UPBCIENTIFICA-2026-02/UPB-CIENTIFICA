const { StorageNoDisponible, RechazoDeStorage, SolicitudInvalida } = require("../dominio/errores");

/**
 * Cliente de Distributed Storage (IAlmacenamiento en el diagrama de componentes).
 *
 * Todas las llamadas van CON EL TOKEN DEL USUARIO: Storage vuelve a comprobar
 * sus permisos en cada una, así que Shared File no puede dar más acceso del
 * que el propio usuario tiene. Es el mismo criterio que sigue node-media.
 *
 * Devuelve `null` cuando Storage responde 404 (el elemento no existe o el
 * usuario no tiene acceso: Storage no distingue a propósito). Qué significa
 * eso en cada operación lo decide el dominio.
 */
class StorageCliente {
    constructor(urlBase) {
        this.urlBase = urlBase.replace(/\/$/, "");
    }

    async #pedir(ruta, token, { metodo = "GET", cuerpo } = {}) {
        let res;
        try {
            res = await fetch(`${this.urlBase}${ruta}`, {
                method: metodo,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(cuerpo ? { "Content-Type": "application/json" } : {}),
                },
                body: cuerpo ? JSON.stringify(cuerpo) : undefined,
                signal: AbortSignal.timeout(10000),
            });
        } catch (e) {
            throw new StorageNoDisponible(e.message);
        }
        if (res.status === 404) return null;
        if (res.status === 204) return true;

        const datos = await res.json().catch(() => ({}));
        if (res.ok) return datos;
        if (res.status === 400) throw new SolicitudInvalida(datos.mensaje || "Storage rechazó la solicitud");
        if (res.status === 401 || res.status === 403) throw new RechazoDeStorage(datos.mensaje || `HTTP ${res.status}`);
        throw new StorageNoDisponible(`respondió ${res.status}`);
    }

    /** ObtenerMetadatos: nodo + nivelEfectivo del usuario, o null. */
    obtenerNodo(nodoId, token) {
        return this.#pedir(`/storage/nodos/${encodeURIComponent(nodoId)}`, token);
    }

    /** Aplica el permiso en las validaciones de Storage (paso 6 del contrato). */
    async otorgarAcceso(nodoId, acceso, token) {
        const r = await this.#pedir(`/storage/nodos/${encodeURIComponent(nodoId)}/accesos`, token, {
            metodo: "PUT", cuerpo: acceso,
        });
        if (r === null) throw new RechazoDeStorage("el elemento ya no existe en Storage");
        return r;
    }

    /** Retira el permiso. Si Storage ya no lo tenía (404) no es un error: el objetivo se cumple. */
    async revocarAcceso(nodoId, destinatarioTipo, destinatarioId, token) {
        await this.#pedir(
            `/storage/nodos/${encodeURIComponent(nodoId)}/accesos/${destinatarioTipo}/${encodeURIComponent(destinatarioId)}`,
            token, { metodo: "DELETE" }
        );
    }

    /** ListarArchivos sobre la raíz del Home. */
    async listarHome(token) {
        return (await this.#pedir("/storage/directorios/root", token)) || [];
    }

    /** ObtenerCuotaUsuario. */
    cuota(token) {
        return this.#pedir("/storage/cuota", token);
    }
}

module.exports = StorageCliente;
