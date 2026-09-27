#!/usr/bin/env bash
set -euo pipefail

# start-gestor.sh — Inicia el servidor RMI gestor-cluster.
#
# NOTA DE ARQUITECTURA: no existe un script `start-registry.sh` separado.
# El RMI Registry se levanta EMBEBIDO dentro del propio proceso de
# gestor-cluster (ver Main.java: LocateRegistry.createRegistry(2099)),
# por lo que un script independiente para el registry sería redundante y
# podría dejarlo huérfano si gestor-cluster termina. Ver README, sección
# "Estrategia de Registry", para la justificación completa.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
JAR_PATH="${PROJECT_ROOT}/gestor-cluster/target/gestor-cluster.jar"

if ! command -v java >/dev/null 2>&1; then
    echo "ERROR: no se encontró 'java' en el PATH. Instala OpenJDK 17." >&2
    exit 1
fi

if [ ! -f "${JAR_PATH}" ]; then
    echo "ERROR: no se encontró ${JAR_PATH}" >&2
    echo "Ejecuta primero: ./scripts/build.sh" >&2
    exit 1
fi

echo "=== Iniciando gestor-cluster (RMI Registry :2099 + JobService :2100) ==="
echo "JAR: ${JAR_PATH}"

# Para activar el .policy documentado en config/seguridad-rmi.policy (opcional,
# ver justificación en README sobre por qué no está activado por defecto):
#   java -Djava.security.manager \
#        -Djava.security.policy="${PROJECT_ROOT}/config/seguridad-rmi.policy" \
#        -jar "${JAR_PATH}"

exec java -jar "${JAR_PATH}"
