-- Índice de metadatos del Distributed Storage Service (PostgreSQL 15).
-- Los BYTES viven en RAIZ_ALMACENAMIENTO (/srv/home); aquí solo el índice.

CREATE TABLE IF NOT EXISTS nodos (
    id                        UUID PRIMARY KEY,
    nombre                    TEXT NOT NULL,
    tipo                      TEXT NOT NULL CHECK (tipo IN ('archivo', 'directorio')),
    propietario               TEXT NOT NULL,
    grupo                     TEXT NOT NULL DEFAULT 'usuarios',
    permisos                  CHAR(9) NOT NULL DEFAULT 'rw-r-----',
    tamano_bytes              BIGINT NOT NULL DEFAULT 0,
    version                   INTEGER NOT NULL DEFAULT 1,
    directorio_contenedor_id  UUID REFERENCES nodos(id) ON DELETE CASCADE,
    ruta_fisica               TEXT,
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    modificado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS versiones (
    id            UUID PRIMARY KEY,
    nodo_id       UUID NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    tamano_bytes  BIGINT NOT NULL,
    ruta_fisica   TEXT NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nodo_id, version)
);

CREATE INDEX IF NOT EXISTS idx_nodos_contenedor  ON nodos(directorio_contenedor_id);
CREATE INDEX IF NOT EXISTS idx_nodos_propietario ON nodos(propietario);
CREATE INDEX IF NOT EXISTS idx_versiones_nodo    ON versiones(nodo_id);

-- Evita nombres duplicados en el mismo directorio para el mismo propietario.
-- Índice parcial: en PostgreSQL, NULL no colisiona con NULL, así que hacen falta dos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nombre_unico_en_dir
    ON nodos(propietario, directorio_contenedor_id, nombre)
    WHERE directorio_contenedor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_nombre_unico_en_home
    ON nodos(propietario, nombre)
    WHERE directorio_contenedor_id IS NULL;