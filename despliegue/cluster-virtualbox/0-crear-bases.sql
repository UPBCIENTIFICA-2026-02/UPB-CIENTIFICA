-- =============================================================================
-- Bases de datos de node-repository, node-media y node-shared-file (entorno local).
--
--   psql -U postgres -h 127.0.0.1 -f 0-crear-bases.sql
--
-- Se puede ejecutar varias veces: solo crea lo que falta. Los usuarios y claves
-- son los que ya traen los .env de cada servicio.
--
-- Las TABLAS no se crean aquí: cada servicio aplica su db/schema.sql al arrancar.
-- =============================================================================

SELECT 'CREATE ROLE storage_svc LOGIN PASSWORD ''storage_dev_2026'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'storage_svc')\gexec

SELECT 'CREATE DATABASE metadatos_storage OWNER storage_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metadatos_storage')\gexec

SELECT 'CREATE ROLE media_svc LOGIN PASSWORD ''cambiar_clave'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'media_svc')\gexec

SELECT 'CREATE DATABASE catalogo_medios OWNER media_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'catalogo_medios')\gexec

-- Shared File Service: solo relaciones de compartición (va en la VM node-repository).
SELECT 'CREATE ROLE shared_svc LOGIN PASSWORD ''shared_dev_2026'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shared_svc')\gexec

SELECT 'CREATE DATABASE comparticiones OWNER shared_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'comparticiones')\gexec

\echo
\echo 'Bases listas:'
SELECT datname AS base, pg_get_userbyid(datdba) AS propietario
FROM pg_database
WHERE datname IN ('metadatos_storage', 'catalogo_medios', 'comparticiones')
ORDER BY datname;
