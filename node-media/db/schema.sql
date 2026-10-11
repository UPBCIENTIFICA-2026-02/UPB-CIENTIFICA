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

-- ---------------------------------------------------------------------------
-- Permisos replicados desde Storage.
--
-- `propietario`, `grupo` y `permisos` son una COPIA de lo que dice Storage en
-- el momento de indexar, y sirven para decidir qué medios se LISTAN aplicando
-- el mismo modelo Unix que node-repository (ver src/dominio/permisos.js).
-- Antes solo existía `propietario`, así que una foto compartida con el grupo
-- era invisible en el álbum aunque Storage sí la mostrara.
--
-- Los BYTES se siguen pidiendo a Storage con el token del usuario: la
-- autoridad sobre el contenido es Storage, no esta copia.
--
-- Se usa ALTER ... IF NOT EXISTS porque aplicarEsquema() ejecuta este archivo
-- en cada arranque y CREATE TABLE IF NOT EXISTS no añade columnas a una tabla
-- que ya existía.
-- ---------------------------------------------------------------------------
ALTER TABLE medios ADD COLUMN IF NOT EXISTS grupo    TEXT      NOT NULL DEFAULT 'usuarios';
ALTER TABLE medios ADD COLUMN IF NOT EXISTS permisos CHAR(9)   NOT NULL DEFAULT 'rw-------';

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
CREATE INDEX IF NOT EXISTS idx_medios_grupo       ON medios(grupo, tipo);
CREATE INDEX IF NOT EXISTS idx_album_medios_orden ON album_medios(album_id, orden);
