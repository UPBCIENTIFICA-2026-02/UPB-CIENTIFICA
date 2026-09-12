#!/usr/bin/env bash
set -euo pipefail

# build.sh — Compila todo el proyecto multi-módulo (common, gestor-cluster, job-api)
# Debe ejecutarse desde cualquier ubicación; resuelve la raíz del proyecto de
# forma relativa a este script, sin depender de rutas absolutas de una máquina.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== rmi-system: build.sh ==="

if ! command -v java >/dev/null 2>&1; then
    echo "ERROR: no se encontró 'java' en el PATH. Instala OpenJDK 17 antes de continuar." >&2
    echo "  sudo apt update && sudo apt install -y openjdk-17-jdk" >&2
    exit 1
fi

JAVA_VERSION="$(java -version 2>&1 | head -n1 | grep -oE '"[0-9]+' | tr -d '"')"
if [ "${JAVA_VERSION}" -lt 17 ]; then
    echo "ERROR: se requiere Java 17 o superior. Versión detectada: ${JAVA_VERSION}" >&2
    exit 1
fi

if ! command -v mvn >/dev/null 2>&1; then
    echo "ERROR: no se encontró 'mvn' en el PATH. Instala Maven antes de continuar." >&2
    echo "  sudo apt update && sudo apt install -y maven" >&2
    exit 1
fi

echo "Java detectado: $(java -version 2>&1 | head -n1)"
echo "Maven detectado: $(mvn -version | head -n1)"
echo "Compilando desde: ${PROJECT_ROOT}"

cd "${PROJECT_ROOT}"
mvn clean package

echo ""
echo "=== Build finalizado correctamente ==="
echo "JAR del servidor:  gestor-cluster/target/gestor-cluster.jar"
echo "JAR de la API:     job-api/target/job-api.jar"
