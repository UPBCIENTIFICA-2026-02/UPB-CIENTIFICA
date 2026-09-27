#!/usr/bin/env bash
set -euo pipefail

# start-api.sh — Inicia la fachada HTTP job-api (Spring Boot), en el puerto 8082.
# Requiere que gestor-cluster ya esté corriendo (o toleremos que arranque antes:
# job-api resuelve el stub RMI de forma perezosa en cada request, así que puede
# iniciarse en cualquier orden, pero las peticiones fallarán con 503 hasta que
# gestor-cluster esté disponible).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
JAR_PATH="${PROJECT_ROOT}/job-api/target/job-api.jar"

if ! command -v java >/dev/null 2>&1; then
    echo "ERROR: no se encontró 'java' en el PATH. Instala OpenJDK 17." >&2
    exit 1
fi

if [ ! -f "${JAR_PATH}" ]; then
    echo "ERROR: no se encontró ${JAR_PATH}" >&2
    echo "Ejecuta primero: ./scripts/build.sh" >&2
    exit 1
fi

RMI_HOST="${RMI_GESTOR_HOST:-localhost}"
RMI_PORT="${RMI_GESTOR_REGISTRY_PORT:-2099}"

echo "=== Iniciando job-api (HTTP :8082) ==="
echo "JAR: ${JAR_PATH}"
echo "Apuntando a gestor-cluster en ${RMI_HOST}:${RMI_PORT}"

exec java \
    -Drmi.gestor.host="${RMI_HOST}" \
    -Drmi.gestor.registryPort="${RMI_PORT}" \
    -jar "${JAR_PATH}"
