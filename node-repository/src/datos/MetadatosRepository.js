const { v4: uuid } = require("uuid");

/**
 * Patrón Repository: encapsula el acceso al índice de metadatos.
 * El dominio trabaja con objetos, no con SQL.
 */
class MetadatosRepository {
    constructor(db) {
        this.db = db;
    }

    buscarPorId(id) {
        return this.db.prepare("SELECT * FROM nodos WHERE id = ?").get(id) || null;
    }

    listarHijos(directorioId) {
        return this.db
        .prepare(
            `SELECT * FROM nodos
            WHERE directorio_contenedor_id IS ?
            ORDER BY tipo DESC, nombre ASC`
        )
        .all(directorioId);
    }

    buscarPorNombreEnDirectorio(nombre, directorioId, propietario) {
        return this.db
        .prepare(
            `SELECT * FROM nodos
            WHERE nombre = ? AND directorio_contenedor_id IS ? AND propietario = ?`
        )
        .get(nombre, directorioId, propietario) || null;
    }

    crear({ nombre, tipo, propietario, grupo, permisos, tamanoBytes,
            directorioContenedorId, rutaFisica }) {
        const id = uuid();
        const ahora = new Date().toISOString();
        this.db
        .prepare(
            `INSERT INTO nodos
            (id, nombre, tipo, propietario, grupo, permisos, tamano_bytes,
            version, directorio_contenedor_id, ruta_fisica, creado_en, modificado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .run(id, nombre, tipo, propietario, grupo || "usuarios",
            permisos || "rw-r-----", tamanoBytes || 0,
            directorioContenedorId, rutaFisica, ahora, ahora);
        return this.buscarPorId(id);
    }

    /** Registra una nueva versión y devuelve el nodo actualizado. */
    nuevaVersion(nodoId, tamanoBytes, rutaFisica) {
        const ahora = new Date().toISOString();
        const tx = this.db.transaction(() => {
        const nodo = this.buscarPorId(nodoId);
        const nuevaV = nodo.version + 1;

        this.db
            .prepare(
            `INSERT INTO versiones (id, nodo_id, version, tamano_bytes, ruta_fisica, creado_en)
            VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(uuid(), nodoId, nodo.version, nodo.tamano_bytes, nodo.ruta_fisica, ahora);

        this.db
            .prepare(
            `UPDATE nodos SET version = ?, tamano_bytes = ?, ruta_fisica = ?, modificado_en = ?
            WHERE id = ?`
            )
            .run(nuevaV, tamanoBytes, rutaFisica, ahora, nodoId);
        });
        tx();
        return this.buscarPorId(nodoId);
    }

    eliminar(id) {
        return this.db.prepare("DELETE FROM nodos WHERE id = ?").run(id).changes > 0;
    }

    /** Suma el espacio ocupado por un usuario — base para el control de cuota (RF-04). */
    espacioUsado(propietario) {
        const fila = this.db
        .prepare(
            `SELECT COALESCE(SUM(tamano_bytes), 0) AS total
            FROM nodos WHERE propietario = ? AND tipo = 'archivo'`
        )
        .get(propietario);
        return fila.total;
    }
}

module.exports = MetadatosRepository;