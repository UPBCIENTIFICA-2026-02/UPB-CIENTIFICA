#!/usr/bin/env bash
# node_exporter (9100) en una VM monitoreada: CPU, memoria, disco y red.
# Diagrama de despliegue: "Todas las VMs -> node-monitoreo, HTTP 9100, exporters".
#
#   sudo ./instalar-exportador.sh [ip-de-node-monitoreo]
#
# Con la IP, el cortafuegos (ufw) solo deja leer el 9100 a node-monitoreo.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root (sudo)."; exit 1; }
apt-get install -y -q prometheus-node-exporter
systemctl enable --now prometheus-node-exporter
if [ -n "${1:-}" ] && command -v ufw >/dev/null; then
    ufw allow from "$1" to any port 9100 proto tcp
    echo "9100 abierto solo para $1"
fi
curl -s localhost:9100/metrics | grep -m1 '^node_cpu_seconds_total' >/dev/null && echo "node_exporter OK en :9100"
