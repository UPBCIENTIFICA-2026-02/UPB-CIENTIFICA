-- Migración: todo lo existente pasa a ser SOLO del propietario.
--
-- Antes los archivos nacían "rw-r-----" y los directorios "rwxr-----": el grupo
-- podía leer, y como todos los usuarios comparten el grupo "usuarios", cualquiera
-- veía las fotos y videos de los demás (node-media) y podía descargar un archivo
-- ajeno conociendo su id. El código ya crea "rw-------" / "rwx------"
-- (src/dominio/permisos.js); esto corrige lo que se creó antes.
--
-- Conserva los permisos del propietario y quita los de grupo y otros.
-- Ejecutar una vez:  psql -U storage_svc -d metadatos_storage -f db/migracion-permisos-privados.sql
UPDATE nodos
   SET permisos = substr(permisos, 1, 3) || '------'
 WHERE substr(permisos, 4, 6) <> '------';
