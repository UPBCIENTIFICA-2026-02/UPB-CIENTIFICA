const { v4: uuid } = require("uuid");
const fsp = require("fs/promises");

/**
 * Predicado SQL equivalente a `puedeLeer()` de dominio/permisos.js.
 *
 * El CASE elige el mismo segmento que `segmentoAplicable`: propietario primero,
 * luego grupo, luego otros. Después comprueba el bit de lectura de ese segmento.
 *
 * Va en SQL y no en el dominio porque el filtro tiene que aplicarse ANTES del
 * LIMIT/OFFSET: si se filtrara en memoria después de paginar, las páginas
 * saldrían incompletas.
 *
 * SI CAMBIA dominio/permisos.js, HAY QUE CAMBIAR ESTO.
 *
 * @param pUid     número del parámetro con el uid    (p. ej. 1 para $1)
 * @param pGrupos  número del parámetro con el array de grupos
 */
function sqlPuedeLeer(pUid, pGrupos) {
  return `(CASE
             WHEN propietario = $${pUid}   THEN substring(permisos, 1, 1)
             WHEN grupo = ANY($${pGrupos}) THEN substring(permisos, 4, 1)
             ELSE                               substring(permisos, 7, 1)
           END) <> '-'`;
}

/** Los grupos siempre como arreglo, aunque el validador devuelva undefined. */
function gruposDe(usuario) {
  return Array.isArray(usuario.grupos) ? usuario.grupos : [];
}

/** Patrón Repository sobre el catálogo de medios. Todos los métodos son async. */
class CatalogoRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // --- medios ---

  /**
   * Un medio, si el usuario puede verlo.
   *
   * ANTES filtraba por `propietario = $2`, así que un medio compartido con el
   * grupo no era accesible aunque Storage sí lo permitiera.
   */
  async buscarPorId(id, usuario) {
    const { rows } = await this.pool.query(
      `SELECT * FROM medios
       WHERE id = $1 AND ${sqlPuedeLeer(2, 3)}`,
      [id, usuario.id, gruposDe(usuario)]
    );
    return rows[0] || null;
  }

  /**
   * Busca la fila ya indexada de un archivo de Storage.
   *
   * Aquí sí se filtra por propietario y no por permisos: es la clave del índice
   * (propietario, archivo_storage_id), no una consulta de visibilidad.
   */
  async buscarPorArchivoStorage(archivoStorageId, propietario) {
    const { rows } = await this.pool.query(
      "SELECT * FROM medios WHERE archivo_storage_id = $1 AND propietario = $2",
      [archivoStorageId, propietario]
    );
    return rows[0] || null;
  }

  async listarPorTipo(usuario, tipo, limite, desplazamiento) {
    const { rows } = await this.pool.query(
      `SELECT * FROM medios
       WHERE tipo = $1 AND ${sqlPuedeLeer(2, 3)}
       ORDER BY COALESCE(tomada_en, indexado_en) DESC
       LIMIT $4 OFFSET $5`,
      [tipo, usuario.id, gruposDe(usuario), limite, desplazamiento]
    );
    return rows;
  }

  async buscarPorTitulo(usuario, tipo, criterio) {
    const { rows } = await this.pool.query(
      `SELECT * FROM medios
       WHERE tipo = $1 AND lower(titulo) LIKE lower($4) AND ${sqlPuedeLeer(2, 3)}
       ORDER BY titulo ASC LIMIT 100`,
      [tipo, usuario.id, gruposDe(usuario), `%${criterio}%`]
    );
    return rows;
  }

  async registrar(datos) {
    const id = datos.id || uuid();
    const { rows } = await this.pool.query(
      `INSERT INTO medios
        (id, archivo_storage_id, propietario, grupo, permisos, titulo, tipo, mime,
         tamano_bytes, ancho, alto, duracion_segundos, tomada_en, miniatura_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (propietario, archivo_storage_id) DO UPDATE
         SET titulo = EXCLUDED.titulo,
             grupo = EXCLUDED.grupo,
             permisos = EXCLUDED.permisos,
             tamano_bytes = EXCLUDED.tamano_bytes,
             ancho = EXCLUDED.ancho,
             alto = EXCLUDED.alto,
             duracion_segundos = EXCLUDED.duracion_segundos,
             miniatura_path = EXCLUDED.miniatura_path,
             indexado_en = now()
       RETURNING *`,
      [id, datos.archivoStorageId, datos.propietario,
       datos.grupo || "usuarios", datos.permisos || "rw-------",
       datos.titulo, datos.tipo, datos.mime, datos.tamanoBytes,
       datos.ancho, datos.alto, datos.duracionSegundos,
       datos.tomadaEn, datos.miniaturaPath]
    );
    return rows[0];
  }

  /**
   * Quita un medio del catálogo y su miniatura de la caché local. Los álbumes
   * que lo contenían lo pierden solos (album_medios tiene ON DELETE CASCADE).
   */
  async eliminar(id) {
    const { rows } = await this.pool.query(
      "DELETE FROM medios WHERE id = $1 RETURNING miniatura_path", [id]
    );
    const miniatura = rows[0]?.miniatura_path;
    if (miniatura) await fsp.unlink(miniatura).catch(() => {});
  }

  /** Elimina del catálogo los medios cuyo archivo ya no existe en Storage. */
  async eliminarHuerfanos(propietario, idsVigentes) {
    if (idsVigentes.length === 0) {
      await this.pool.query("DELETE FROM medios WHERE propietario = $1", [propietario]);
      return;
    }
    await this.pool.query(
      "DELETE FROM medios WHERE propietario = $1 AND NOT (archivo_storage_id = ANY($2))",
      [propietario, idsVigentes]
    );
  }

  // --- álbumes ---

  async listarAlbumes(propietario) {
    const { rows } = await this.pool.query(
      `SELECT a.*, COUNT(am.medio_id)::INT AS total_fotos
       FROM albumes a
       LEFT JOIN album_medios am ON am.album_id = a.id
       WHERE a.propietario = $1
       GROUP BY a.id ORDER BY a.creado_en DESC`,
      [propietario]
    );
    return rows;
  }

  async crearAlbum(propietario, nombre, descripcion) {
    const { rows } = await this.pool.query(
      `INSERT INTO albumes (id, propietario, nombre, descripcion)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [uuid(), propietario, nombre, descripcion || null]
    );
    return rows[0];
  }

  async buscarAlbum(albumId, propietario) {
    const { rows } = await this.pool.query(
      "SELECT * FROM albumes WHERE id = $1 AND propietario = $2",
      [albumId, propietario]
    );
    return rows[0] || null;
  }

  /**
   * Fotos de un álbum que el usuario puede ver.
   *
   * Se vuelve a comprobar el permiso aunque al añadirlas ya se comprobó: si
   * después se revocó el acceso a un medio compartido, no debe seguir saliendo
   * en el álbum.
   */
  async listarMediosDeAlbum(albumId, usuario) {
    const { rows } = await this.pool.query(
      `SELECT m.*, am.orden FROM album_medios am
       JOIN medios m ON m.id = am.medio_id
       WHERE am.album_id = $1 AND ${sqlPuedeLeer(2, 3)}
       ORDER BY am.orden ASC`,
      [albumId, usuario.id, gruposDe(usuario)]
    );
    return rows;
  }

  async agregarAAlbum(albumId, medioId, orden) {
    await this.pool.query(
      `INSERT INTO album_medios (album_id, medio_id, orden)
       VALUES ($1,$2,$3)
       ON CONFLICT (album_id, medio_id) DO UPDATE SET orden = EXCLUDED.orden`,
      [albumId, medioId, orden]
    );
  }

  async quitarDeAlbum(albumId, medioId) {
    const { rowCount } = await this.pool.query(
      "DELETE FROM album_medios WHERE album_id = $1 AND medio_id = $2",
      [albumId, medioId]
    );
    return rowCount > 0;
  }

  async eliminarAlbum(albumId, propietario) {
    const { rowCount } = await this.pool.query(
      "DELETE FROM albumes WHERE id = $1 AND propietario = $2",
      [albumId, propietario]
    );
    return rowCount > 0;
  }
}

module.exports = CatalogoRepository;
