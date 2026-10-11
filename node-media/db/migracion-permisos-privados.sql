-- Migración: misma corrección que node-repository/db/migracion-permisos-privados.sql
-- sobre la copia de permisos que guarda el catálogo. Sin esto las fotos y
-- videos ya indexados seguirían listándose a todo el grupo "usuarios" hasta
-- volver a indexar.
-- Ejecutar una vez:  psql -U media_svc -d catalogo_medios -f db/migracion-permisos-privados.sql
UPDATE medios
   SET permisos = substr(permisos, 1, 3) || '------'
 WHERE substr(permisos, 4, 6) <> '------';
