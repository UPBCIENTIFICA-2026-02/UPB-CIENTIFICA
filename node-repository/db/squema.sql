-- Índice de metadatos del Distributed Storage Service.
-- Los BYTES de los archivos NO viven aquí: viven en RAIZ_ALMACENAMIENTO (/srv/home).
-- Esta base solo indexa qué existe, de quién es y en qué versión va.

CREATE TABLE IF NOT EXISTS nodos (
    id                        TEXT PRIMARY KEY,
    nombre                    TEXT NOT NULL,
    tipo                      TEXT NOT NULL CHECK (tipo IN ('archivo', 'directorio')),
    propietario               TEXT NOT NULL,
    grupo                     TEXT NOT NULL DEFAULT 'usuarios',
    -- Permisos estilo Unix de 9 caracteres: rwxr-x---
    permisos                  TEXT NOT NULL DEFAULT 'rwxr-----',
    tamano_bytes              INTEGER NOT NULL DEFAULT 0,
    version                   INTEGER NOT NULL DEFAULT 1,
    directorio_contenedor_id  TEXT,
    ruta_fisica               TEXT,
    creado_en                 TEXT NOT NULL,
    modificado_en             TEXT NOT NULL,
    FOREIGN KEY (directorio_contenedor_id) REFERENCES nodos(id) ON DELETE CASCADE
);

-- Historial de versiones: el contrato exige versionado transparente.
CREATE TABLE IF NOT EXISTS versiones (
    id            TEXT PRIMARY KEY,
    nodo_id       TEXT NOT NULL,
    version       INTEGER NOT NULL,
    tamano_bytes  INTEGER NOT NULL,
    ruta_fisica   TEXT NOT NULL,
    creado_en     TEXT NOT NULL,
    FOREIGN KEY (nodo_id) REFERENCES nodos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodos_contenedor  ON nodos(directorio_contenedor_id);
CREATE INDEX IF NOT EXISTS idx_nodos_propietario ON nodos(propietario);
CREATE INDEX IF NOT EXISTS idx_versiones_nodo    ON versiones(nodo_id);