const { v4: uuid } = require("uuid");

/** Condición "vigente": activa y sin caducar. */
const VIGENTE = `estado_invitacion = 'ACTIVO'
                 AND (fecha_expiracion IS NULL OR fecha_expiracion > now())`;

/**
 * Patrón Repository sobre la tabla `relaciones`. Solo persistencia: las
 * reglas (quién puede compartir, qué se advierte...) están en el dominio.
 */
class ComparticionesRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Registra la relación y ejecuta `aplicar` (avisar a Storage) DENTRO de la
     * misma transacción: si Storage rechaza o no responde, la relación no
     * queda guardada. Así nunca hay una compartición registrada aquí que
     * Storage no esté aplicando.
     *
     * El índice único parcial convierte la carrera "dos peticiones comparten
     * lo mismo a la vez" en un error 23505 que el dominio traduce a SHR-004.
     */
    async registrar(relacion, aplicar) {
        const cliente = await this.pool.connect();
        try {
            await cliente.query("BEGIN");
            const { rows } = await cliente.query(
                `INSERT INTO relaciones
                    (id, elemento_id, elemento_tipo, nombre_elemento, propietario_id, duenio_elemento,
                     destinatario_tipo, destinatario_id, nivel_permiso, estado_invitacion, fecha_expiracion)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [uuid(), relacion.elementoId, relacion.elementoTipo, relacion.nombreElemento,
                 relacion.propietarioId, relacion.duenioElemento, relacion.destinatarioTipo,
                 relacion.destinatarioId, relacion.nivelPermiso, relacion.estadoInvitacion,
                 relacion.fechaExpiracion || null]
            );
            await aplicar();
            await cliente.query("COMMIT");
            return rows[0];
        } catch (error) {
            await cliente.query("ROLLBACK");
            throw error;
        } finally {
            cliente.release();
        }
    }

    async buscarPorId(id) {
        const { rows } = await this.pool.query("SELECT * FROM relaciones WHERE id = $1", [id]);
        return rows[0] || null;
    }

    async buscarVigente(elementoId, destinatarioTipo, destinatarioId) {
        const { rows } = await this.pool.query(
            `SELECT * FROM relaciones
             WHERE elemento_id = $1 AND destinatario_tipo = $2 AND destinatario_id = $3
               AND estado_invitacion IN ('PENDIENTE', 'ACTIVO')`,
            [elementoId, destinatarioTipo, destinatarioId]
        );
        return rows[0] || null;
    }

    /** ListarCompartidosConmigo: dirigidas al usuario o a uno de sus grupos. */
    async compartidasCon(usuarioId, grupos, limite, desplazamiento) {
        const { rows } = await this.pool.query(
            `SELECT * FROM relaciones
             WHERE ${VIGENTE}
               AND duenio_elemento <> $1
               AND ((destinatario_tipo = 'USUARIO' AND destinatario_id = $1)
                 OR (destinatario_tipo = 'GRUPO'   AND destinatario_id = ANY($2::text[])))
             ORDER BY fecha_creacion DESC
             LIMIT $3 OFFSET $4`,
            [usuarioId, grupos, limite, desplazamiento]
        );
        return rows;
    }

    /** ListarQueYoComparto. */
    async compartidasPor(usuarioId, limite, desplazamiento) {
        const { rows } = await this.pool.query(
            `SELECT * FROM relaciones
             WHERE ${VIGENTE} AND propietario_id = $1
             ORDER BY fecha_creacion DESC
             LIMIT $2 OFFSET $3`,
            [usuarioId, limite, desplazamiento]
        );
        return rows;
    }

    /** Relaciones vigentes sobre un elemento que le aplican a un usuario (para "fuentes"). */
    async queAplicanA(elementoId, usuarioId, grupos) {
        const { rows } = await this.pool.query(
            `SELECT * FROM relaciones
             WHERE ${VIGENTE} AND elemento_id = $1
               AND ((destinatario_tipo = 'USUARIO' AND destinatario_id = $2)
                 OR (destinatario_tipo = 'GRUPO'   AND destinatario_id = ANY($3::text[])))`,
            [elementoId, usuarioId, grupos]
        );
        return rows;
    }

    /** Cuántas veces volvió a compartir `usuarioId` el elemento (regla de SHR-201). */
    async contarSubcomparticiones(elementoId, usuarioId) {
        const { rows } = await this.pool.query(
            `SELECT count(*)::int AS n FROM relaciones
             WHERE ${VIGENTE} AND elemento_id = $1 AND propietario_id = $2`,
            [elementoId, usuarioId]
        );
        return rows[0].n;
    }

    async actualizarNivel(id, nivel) {
        const { rows } = await this.pool.query(
            "UPDATE relaciones SET nivel_permiso = $2 WHERE id = $1 RETURNING *", [id, nivel]
        );
        return rows[0];
    }

    async marcarRevocada(id) {
        await this.pool.query(
            `UPDATE relaciones SET estado_invitacion = 'REVOCADO', fecha_revocacion = now()
             WHERE id = $1`,
            [id]
        );
    }
}

module.exports = ComparticionesRepository;
