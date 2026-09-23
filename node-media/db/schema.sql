-- Catálogo de medios de node-media (PostgreSQL 15).
--
-- IMPORTANTE: aquí NO se almacenan archivos. Las fotos y videos viven en
-- Distributed Storage (/srv/home). Esta base solo indexa qué medios existen,
-- sus metadatos técnicos y cómo el usuario los organiza en álbumes.
-- Es un índice regenerable: si se pierde, se reconstruye reindexando.

CREATE TABLE IF NOT EXISTS medios (
    id                  UUID PRIMARY KEY,
    -- id del archivo en Distributed Storage (clave de correlación)
    archivo_storage_id  TEXT NOT NULL,
    propietario         TEXT NOT NULL,
    titulo              TEXT NOT NULL,
    tipo                TEXT NOT NULL CHECK (tipo IN ('foto', 'video')),
    mime                TEXT,
    tamano_bytes        BIGINT NOT NULL DEFAULT 0,
    ancho               INTEGER,
    alto                INTEGER,
    duracion_segundos   INTEGER,          -- solo video
    tomada_en           TIMESTAMPTZ,      -- fecha de captura si está disponible
    miniatura_path      TEXT,             -- ruta local de la miniatura generada
    indexado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (propietario, archivo_storage_id)
);

CREATE TABLE IF NOT EXISTS albumes (
    id           UUID PRIMARY KEY,
    propietario  TEXT NOT NULL,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (propietario, nombre)
);

CREATE TABLE IF NOT EXISTS album_medios (
    album_id  UUID NOT NULL REFERENCES albumes(id) ON DELETE CASCADE,
    medio_id  UUID NOT NULL REFERENCES medios(id)  ON DELETE CASCADE,
    orden     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, medio_id)
);

CREATE INDEX IF NOT EXISTS idx_medios_propietario ON medios(propietario, tipo);
CREATE INDEX IF NOT EXISTS idx_medios_titulo      ON medios(propietario, lower(titulo));
CREATE INDEX IF NOT EXISTS idx_album_medios_orden ON album_medios(album_id, orden);