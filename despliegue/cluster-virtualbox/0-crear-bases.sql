-- =============================================================================
-- Bases de datos de node-repository, node-media y node-shared-file (entorno local).
--
--   . .\cargar-env.ps1                      # claves desde .env (fuera de Git)
--   psql -U postgres -h 127.0.0.1 -f 0-crear-bases.sql
--
-- Se puede ejecutar varias veces: solo crea lo que falta. Las claves salen de
-- UPBC_BD_CLAVE_STORAGE, UPBC_BD_CLAVE_MEDIA y UPBC_BD_CLAVE_SHARED, y deben
-- coincidir con el DATABASE_URL del .env de cada servicio. Antes estaban
-- escritas aquí; \getenv necesita psql 15 o posterior.
--
-- Las TABLAS no se crean aquí: cada servicio aplica su db/schema.sql al arrancar.
-- =============================================================================

\getenv clave_storage UPBC_BD_CLAVE_STORAGE
\getenv clave_media UPBC_BD_CLAVE_MEDIA
\getenv clave_shared UPBC_BD_CLAVE_SHARED

\if :{?clave_storage}
\else
  \echo 'Falta UPBC_BD_CLAVE_STORAGE: carga el .env con . .\\cargar-env.ps1'
  \quit
\endif
\if :{?clave_media}
\else
  \echo 'Falta UPBC_BD_CLAVE_MEDIA: carga el .env con . .\\cargar-env.ps1'
  \quit
\endif
\if :{?clave_shared}
\else
  \echo 'Falta UPBC_BD_CLAVE_SHARED: carga el .env con . .\\cargar-env.ps1'
  \quit
\endif

SELECT format('CREATE ROLE storage_svc LOGIN PASSWORD %L', :'clave_storage')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'storage_svc')\gexec

SELECT 'CREATE DATABASE metadatos_storage OWNER storage_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metadatos_storage')\gexec

SELECT format('CREATE ROLE media_svc LOGIN PASSWORD %L', :'clave_media')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'media_svc')\gexec

SELECT 'CREATE DATABASE catalogo_medios OWNER media_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'catalogo_medios')\gexec

-- Shared File Service: solo relaciones de compartición (va en la VM node-repository).
SELECT format('CREATE ROLE shared_svc LOGIN PASSWORD %L', :'clave_shared')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shared_svc')\gexec

SELECT 'CREATE DATABASE comparticiones OWNER shared_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'comparticiones')\gexec

\echo
\echo 'Bases listas:'
SELECT datname AS base, pg_get_userbyid(datdba) AS propietario
FROM pg_database
WHERE datname IN ('metadatos_storage', 'catalogo_medios', 'comparticiones')
ORDER BY datname;
