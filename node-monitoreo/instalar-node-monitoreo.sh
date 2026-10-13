#!/usr/bin/env bash
# Instala el módulo de monitoreo en la VM node-monitoreo (Debian 12), según el
# diagrama de despliegue: prometheus + grafana-server, Grafana en el 3000.
#
#   sudo ./node-monitoreo/instalar-node-monitoreo.sh        (desde la raíz del monorepo)
#
# Luego, en CADA VM monitoreada: sudo ./node-monitoreo/instalar-exportador.sh
set -euo pipefail
RAIZ="${RAIZ:-$(cd "$(dirname "$0")/.." && pwd)}"
M="$RAIZ/node-monitoreo"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root (sudo)."; exit 1; }
paso() { printf '\n==> %s\n' "$1"; }

paso "Prometheus, blackbox_exporter y node_exporter (paquetes de Debian)"
apt-get update -q
apt-get install -y -q prometheus prometheus-blackbox-exporter prometheus-node-exporter curl gpg

paso "Grafana (repositorio oficial de Grafana Labs)"
install -d -m 755 /etc/apt/keyrings
curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
apt-get update -q && apt-get install -y -q grafana

paso "Configuración de Prometheus (objetivos, reglas y alertas)"
install -d /etc/prometheus/reglas
install -m 644 "$M/prometheus/prometheus.yml" /etc/prometheus/prometheus.yml
install -m 644 "$M"/prometheus/reglas/*.yml /etc/prometheus/reglas/
install -m 644 "$M/blackbox/blackbox.yml" /etc/prometheus/blackbox.yml
# Histórico de 30 días (reportes históricos) y recarga de reglas sin reiniciar.
sed -i 's|^ARGS=.*|ARGS="--storage.tsdb.retention.time=30d --web.enable-lifecycle"|' /etc/default/prometheus
sed -i 's|^ARGS=.*|ARGS="--config.file=/etc/prometheus/blackbox.yml"|' /etc/default/prometheus-blackbox-exporter
promtool check config /etc/prometheus/prometheus.yml

paso "Grafana: fuente de datos y tablero aprovisionados"
install -d /etc/grafana/provisioning/datasources /etc/grafana/provisioning/dashboards /var/lib/grafana/tableros
install -m 644 "$M/grafana/provisioning/datasources/prometheus.yml" /etc/grafana/provisioning/datasources/upbc.yml
install -m 644 "$M/grafana/provisioning/dashboards/upbc.yml" /etc/grafana/provisioning/dashboards/upbc.yml
install -m 644 "$M"/grafana/tableros/*.json /var/lib/grafana/tableros/
# Variables que leen los archivos de aprovisionamiento.
install -d /etc/systemd/system/grafana-server.service.d
cat > /etc/systemd/system/grafana-server.service.d/upbc.conf <<'EOF'
[Service]
Environment=PROMETHEUS_URL=http://localhost:9090
Environment=UPBC_TABLEROS=/var/lib/grafana/tableros
# El portal (node-web) reenvía /monitoreo/ a este Grafana.
Environment=GF_SERVER_ROOT_URL=https://node-web.cca.upb.edu.co/monitoreo/
Environment=GF_SERVER_SERVE_FROM_SUB_PATH=true
Environment=GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/tableros/upbc-estado.json
Environment=GF_ANALYTICS_REPORTING_ENABLED=false
EOF
chown -R grafana:grafana /var/lib/grafana/tableros

paso "Arrancar"
systemctl daemon-reload
systemctl enable --now prometheus prometheus-blackbox-exporter prometheus-node-exporter grafana-server
systemctl restart prometheus prometheus-blackbox-exporter grafana-server
sleep 5
curl -s localhost:9090/-/healthy && echo
echo "Grafana: http://<node-monitoreo>:3000/monitoreo/  (admin / admin la primera vez: cámbiala)"
