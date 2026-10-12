-- Shared File Service: relaciones de compartición (Contrato_SharedFile §4,
-- RelacionCompartido). No hay bytes ni metadatos de archivos aquí: eso es de
-- Storage. Se aplica al arrancar el servicio; se puede ejecutar varias veces.

CREATE TABLE IF NOT EXISTS relaciones (
    id                 UUID PRIMARY KEY,
    elemento_id        UUID NOT NULL,                -- nodo de Storage (FK lógica)
    elemento_tipo      TEXT NOT NULL CHECK (elemento_tipo IN ('ARCHIVO', 'DIRECTORIO')),
    -- Copia del nombre al compartir: el listado lo refresca desde Storage.
    nombre_elemento    TEXT NOT NULL,
    -- "Quien comparte" (propietarioId en el contrato). Puede no ser el dueño
    -- del archivo si se le dio LECTURA_ESCRITURA_COMPARTIR.
    propietario_id     TEXT NOT NULL,
    duenio_elemento    TEXT NOT NULL,                -- propietario del nodo en Storage
    destinatario_tipo  TEXT NOT NULL CHECK (destinatario_tipo IN ('USUARIO', 'GRUPO')),
    destinatario_id    TEXT NOT NULL,
    nivel_permiso      TEXT NOT NULL CHECK (nivel_permiso IN
                         ('LECTURA', 'LECTURA_ESCRITURA', 'LECTURA_ESCRITURA_COMPARTIR')),
    estado_invitacion  TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado_invitacion IN
                         ('PENDIENTE', 'ACTIVO', 'RECHAZADO', 'REVOCADO')),
    fecha_creacion     TIMESTAMPTZ NOT NULL DEFAULT now(),   -- inmutable
    fecha_expiracion   TIMESTAMPTZ,
    fecha_revocacion   TIMESTAMPTZ
);

-- SHR-004: una sola relación vigente por elemento y destinatario.
CREATE UNIQUE INDEX IF NOT EXISTS idx_relacion_vigente
    ON relaciones(elemento_id, destinatario_tipo, destinatario_id)
    WHERE estado_invitacion IN ('PENDIENTE', 'ACTIVO');

CREATE INDEX IF NOT EXISTS idx_relaciones_destinatario
    ON relaciones(destinatario_tipo, destinatario_id) WHERE estado_invitacion = 'ACTIVO';
CREATE INDEX IF NOT EXISTS idx_relaciones_propietario
    ON relaciones(propietario_id) WHERE estado_invitacion = 'ACTIVO';
