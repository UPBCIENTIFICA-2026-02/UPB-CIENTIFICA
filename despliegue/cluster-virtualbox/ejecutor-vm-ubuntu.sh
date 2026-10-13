#!/usr/bin/env bash
# =============================================================================
# job-runner con OpenMPI REAL en una VM Ubuntu de desarrollo (p. ej. la misma
# UbuntuServer1 que corre node-sync), para probar el servicio HPC sin montar el
# clúster de 5 nodos. Es un clúster de UN nodo: mpirun reparte los procesos
# entre los núcleos de la VM (--oversubscribe si se piden más que núcleos).
#
#   (Windows)  scp -P 2223 RMIUPBCientifica\job-runner\target\job-runner.jar ^
#                  despliegue\cluster-virtualbox\ejecutor-vm-ubuntu.sh <usuario>@127.0.0.1:
#   (VM)       sudo bash ejecutor-vm-ubuntu.sh
#   (Windows)  VirtualBox reenvía 127.0.0.1:2299 y :2300 a la VM; el gestor se
#              apunta ahí:  .\7-iniciar-servicios-windows.ps1 -HpcLocal -EjecutorHpc 127.0.0.1:2299
#
# Puertos 2299/2300 (y no 2099/2100) porque en el PC el 2099/2100 ya son del
# gestor y el 2199 del job-runner simulado.
# =============================================================================
set -euo pipefail

ok()    { printf '  \033[1;32mOK\033[0m  %s\n' "$*"; }
falla() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falla "ejecútalo con sudo"
USUARIO="${SUDO_USER:?ejecútalo con sudo desde tu usuario, no como root}"
HOGAR="$(getent passwd "$USUARIO" | cut -d: -f6)"
[ -f "$HOGAR/job-runner.jar" ] || falla "falta $HOGAR/job-runner.jar (cópialo desde Windows, ver la cabecera)"

echo "==> Paquetes: OpenMPI, compiladores, mpi4py y Java"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends openmpi-bin libopenmpi-dev build-essential \
    python3-mpi4py openjdk-17-jre-headless >/dev/null
ok "$(mpirun --version | head -1)"

echo "==> job-runner como servicio (usuario $USUARIO: OpenMPI no corre como root)"
install -d -m 755 /opt/upbc
install -m 644 "$HOGAR/job-runner.jar" /opt/upbc/
install -d -m 750 -o "$USUARIO" "$HOGAR/hpc-trabajos"
cat > /etc/systemd/system/upbc-job-runner.service <<EOF
[Unit]
Description=UPB-CIENTIFICA job-runner (OpenMPI real, RMI 2299/2300)
After=network-online.target

[Service]
User=${USUARIO}
Environment=RUNNER_PUERTO_REGISTRY=2299
Environment=RUNNER_PUERTO_OBJETO=2300
Environment=DIR_TRABAJOS=${HOGAR}/hpc-trabajos
Environment=NODOS_LOCALES=localhost
Environment=MPIRUN_OPCIONES=--oversubscribe
# El gestor llega por la NAT de VirtualBox a 127.0.0.1 del PC.
ExecStart=/usr/bin/java -Xmx192m -Djava.rmi.server.hostname=127.0.0.1 -jar /opt/upbc/job-runner.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now upbc-job-runner.service >/dev/null
systemctl restart upbc-job-runner.service
for i in $(seq 1 30); do ss -ltn 'sport = :2299' | grep -q LISTEN && break; sleep 1; done
ss -ltn 'sport = :2299' | grep -q LISTEN || { journalctl -u upbc-job-runner -n 30 --no-pager; falla "job-runner no abrió el 2299"; }
ok "job-runner escuchando en 2299/2300 ($(nproc) núcleos)"

echo "==> Prueba local de MPI (sin el gestor)"
dir="$(mktemp -d)"
cat > "$dir/hola.c" <<'C'
#include <mpi.h>
#include <stdio.h>
int main(int c, char **v) { int r, n; MPI_Init(&c, &v); MPI_Comm_rank(MPI_COMM_WORLD, &r);
  MPI_Comm_size(MPI_COMM_WORLD, &n); int s = 0; MPI_Reduce(&r, &s, 1, MPI_INT, MPI_SUM, 0, MPI_COMM_WORLD);
  if (!r) printf("MPI_Reduce de %d procesos: %d\n", n, s); MPI_Finalize(); return 0; }
C
chown -R "$USUARIO" "$dir"
sudo -u "$USUARIO" mpicc -o "$dir/hola" "$dir/hola.c"
sudo -u "$USUARIO" mpirun --oversubscribe -np 4 "$dir/hola"
rm -rf "$dir"
ok "OpenMPI funciona. En Windows: .\\7-iniciar-servicios-windows.ps1 -HpcLocal -EjecutorHpc 127.0.0.1:2299"
