const { v4: uuid } = require("uuid");

/**
 * Patrón Repository sobre PostgreSQL. Todos los métodos son async.
 *
 * Frente a la versión SQLite se ganan dos cosas importantes:
 *  - SELECT ... FOR UPDATE en el versionado, que evita condiciones de carrera
 *    cuando dos clientes suben el mismo archivo a la vez (riesgo que el roadmap
 *    identificó explícitamente para Storage).
 *  - La comprobación de cuota se hace dentro de una transacción.
 */
class MetadatosRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async buscarPorId(id) {
        const { rows } = await this.pool.query("SELECT * FROM nodos WHERE id = $1", [id]);
        return rows[0] || null;
    }

    async listarHijos(directorioId) {
        const sql = directorioId
        ? `SELECT * FROM nodos WHERE directorio_contenedor_id = $1
            ORDER BY tipo DESC, nombre ASC`
        : `SELECT * FROM nodos WHERE directorio_contenedor_id IS NULL
            ORDER BY tipo DESC, nombre ASC`;
        const params = directorioId ? [directorioId] : [];
        const { rows } = await this.pool.query(sql, params);
        return rows;
    }

    /**
     * Nodos en la raíz del Home de UN usuario.
     *
     * La raíz es por propietario: el índice único de la tabla ya lo asume
     * (idx_nombre_unico_en_home es (propietario, nombre)). Usar listarHijos(null)
     * para la raíz devolvía los nodos de todos los usuarios, que es lo que hacía
     * que el indexador de node-media registrara archivos ajenos como propios.
     */
    async listarHijosRaiz(propietario) {
        const { rows } = await this.pool.query(
        `SELECT * FROM nodos
        WHERE directorio_contenedor_id IS NULL AND propietario = $1
        ORDER BY tipo DESC, nombre ASC`,
        [propietario]
        );
        return rows;
    }

    async buscarPorNombreEnDirectorio(nombre, directorioId, propietario) {
        const sql = directorioId
        ? `SELECT * FROM nodos
            WHERE nombre = $1 AND directorio_contenedor_id = $2 AND propietario = $3`
        : `SELECT * FROM nodos
            WHERE nombre = $1 AND directorio_contenedor_id IS NULL AND propietario = $2`;
        const params = directorioId
        ? [nombre, directorioId, propietario]
        : [nombre, propietario];
        const { rows } = await this.pool.query(sql, params);
        return rows[0] || null;
    }

    async crear({ nombre, tipo, propietario, grupo, permisos, tamanoBytes,
                    directorioContenedorId, rutaFisica }) {
        const id = uuid();
        const { rows } = await this.pool.query(
        `INSERT INTO nodos
            (id, nombre, tipo, propietario, grupo, permisos, tamano_bytes,
            version, directorio_contenedor_id, ruta_fisica)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)
        RETURNING *`,
        [id, nombre, tipo, propietario, grupo || "usuarios",
        permisos || "rw-r-----", tamanoBytes || 0,
        directorioContenedorId, rutaFisica]
        );
        return rows[0];
    }

    /** Fija contenido y ruta de un nodo recién creado (v1), sin tocar el historial. */
    async fijarContenido(nodoId, tamanoBytes, rutaFisica) {
        const { rows } = await this.pool.query(
        `UPDATE nodos SET tamano_bytes = $1, ruta_fisica = $2, modificado_en = now()
        WHERE id = $3 RETURNING *`,
        [tamanoBytes, rutaFisica, nodoId]
        );
        return rows[0];
    }

    /**
     * Archiva la versión actual y registra una nueva.
     * FOR UPDATE bloquea la fila: si dos subidas llegan a la vez, la segunda espera
     * en lugar de generar dos veces el mismo número de versión.
     */
    async nuevaVersion(nodoId, tamanoBytes, rutaFisica) {
        const client = await this.pool.connect();
        try {
        await client.query("BEGIN");

        const { rows } = await client.query(
            "SELECT * FROM nodos WHERE id = $1 FOR UPDATE", [nodoId]
        );
        const nodo = rows[0];
        if (!nodo) throw new Error(`Nodo ${nodoId} no existe`);

        await client.query(
            `INSERT INTO versiones (id, nodo_id, version, tamano_bytes, ruta_fisica)
            VALUES ($1, $2, $3, $4, $5)`,
            [uuid(), nodoId, nodo.version, nodo.tamano_bytes, nodo.ruta_fisica]
        );

        const { rows: actualizado } = await client.query(
            `UPDATE nodos
            SET version = version + 1, tamano_bytes = $1, ruta_fisica = $2, modificado_en = now()
            WHERE id = $3 RETURNING *`,
            [tamanoBytes, rutaFisica, nodoId]
        );

        await client.query("COMMIT");
        return actualizado[0];
        } catch (error) {
        await client.query("ROLLBACK");
        throw error;
        } finally {
        client.release();
        }
    }

    async eliminar(id) {
        const { rowCount } = await this.pool.query("DELETE FROM nodos WHERE id = $1", [id]);
        return rowCount > 0;
    }

    async espacioUsado(propietario) {
        const { rows } = await this.pool.query(
        `SELECT COALESCE(SUM(tamano_bytes), 0)::BIGINT AS total
        FROM nodos WHERE propietario = $1 AND tipo = 'archivo'`,
        [propietario]
        );
        return Number(rows[0].total);
    }

    async listarVersiones(nodoId) {
        const { rows } = await this.pool.query(
        "SELECT * FROM versiones WHERE nodo_id = $1 ORDER BY version DESC",
        [nodoId]
        );
        return rows;
    }
}

module.exports = MetadatosRepository;