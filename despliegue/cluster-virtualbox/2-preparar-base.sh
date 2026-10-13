#!/usr/bin/env bash
# =============================================================================
# Paso 2 — Prepara la plantilla hpc-base. Se ejecuta UNA vez, antes de clonar.
#
#   scp 2-preparar-base.sh "$env:USERPROFILE\.ssh\id_ed25519.pub" hpc-base:
#   ssh -t hpc-base "sudo bash 2-preparar-base.sh"
#
# El -t es imprescindible SOLO aquí: todavía no hay sudo sin contraseña (lo
# configura este mismo script), y sin terminal sudo no puede pedirla.
#
# Todo lo que se hace aquí lo heredan las tres clonaciones. Por eso es el sitio
# para lo que TIENE que ser idéntico en todos los nodos:
#   - misma versión de OpenMPI (si difiere, errores de protocolo entre nodos)
#   - mpiuser con UID/GID 5000 (NFS identifica usuarios por número)
#   - la configuración que obliga a MPI a usar solo la red host-only
#
# Sigue las convenciones de docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md.
# =============================================================================
set -euo pipefail

RED_CLUSTER="192.168.56.0/24"

paso() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
falla() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falla "ejecútalo con sudo:  sudo bash $0"
. /etc/os-release
[ "${VERSION_ID:-}" = "12" ] || falla "se esperaba Debian 12 y esto es: ${PRETTY_NAME:-desconocido}"

ADMIN="${SUDO_USER:-upbc}"
HOME_ADMIN="$(getent passwd "$ADMIN" | cut -d: -f6)"

# -----------------------------------------------------------------------------
paso "Instalando paquetes (OpenMPI, NFS, Java 17, compiladores)"
# -----------------------------------------------------------------------------
# openjdk-17-jre-headless y no el JDK: en las VMs solo se EJECUTAN los .jar, que
# se compilan en Windows. nfs-kernel-server se instala en todos para que las
# imágenes sean idénticas, pero solo hpc-master lo enciende (paso 4).
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    openmpi-bin openmpi-common libopenmpi-dev build-essential python3-mpi4py \
    nfs-common nfs-kernel-server \
    openjdk-17-jre-headless \
    openssh-server sudo curl rsync ca-certificates

systemctl disable --now nfs-server >/dev/null 2>&1 || true

echo "OpenMPI: $(mpirun --version 2>/dev/null | head -n1)"
echo "Java:    $(java -version 2>&1 | head -n1)"

# -----------------------------------------------------------------------------
paso "Usuario mpiuser con UID/GID 5000"
# -----------------------------------------------------------------------------
getent group mpigroup >/dev/null || groupadd -g 5000 mpigroup
id mpiuser >/dev/null 2>&1 || useradd -m -u 5000 -g 5000 -s /bin/bash mpiuser
id mpiuser

# -----------------------------------------------------------------------------
paso "Llave SSH compartida de mpiuser"
# -----------------------------------------------------------------------------
# mpirun arranca procesos remotos por SSH y se cuelga si pide contraseña.
#
# En vez de generar una llave en el maestro y copiarla con ssh-copy-id a cada
# worker (lo que hace la guía del laboratorio), se genera aquí, en la plantilla,
# y se autoriza a sí misma. Como los tres nodos son clones, todos tienen la misma
# llave y todos la aceptan: SSH entre nodos funciona desde el primer arranque.
#
# Compartir una llave entre nodos es habitual en clústeres de laboratorio con
# /home común; NO es lo que se haría en una red expuesta.
SSH_DIR=/home/mpiuser/.ssh
install -d -m 700 -o mpiuser -g mpigroup "$SSH_DIR"
if [ ! -f "$SSH_DIR/id_ed25519" ]; then
    sudo -u mpiuser ssh-keygen -q -t ed25519 -N "" -C "mpiuser@cluster-upbc" -f "$SSH_DIR/id_ed25519"
fi
cp "$SSH_DIR/id_ed25519.pub" "$SSH_DIR/authorized_keys"

# accept-new: acepta la llave de host la primera vez sin preguntar (mpirun no
# puede responder "yes"), pero sigue avisando si después cambia.
cat > "$SSH_DIR/config" <<'EOF'
Host hpc-master hpc-worker1 hpc-worker2 192.168.56.*
    StrictHostKeyChecking accept-new
    LogLevel ERROR
EOF
chown -R mpiuser:mpigroup "$SSH_DIR"
chmod 600 "$SSH_DIR/id_ed25519" "$SSH_DIR/authorized_keys" "$SSH_DIR/config"
chmod 644 "$SSH_DIR/id_ed25519.pub"

# -----------------------------------------------------------------------------
paso "Acceso desde Windows sin contraseña"
# -----------------------------------------------------------------------------
if [ -f "$HOME_ADMIN/id_ed25519.pub" ]; then
    install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$HOME_ADMIN/.ssh"
    touch "$HOME_ADMIN/.ssh/authorized_keys"
    if ! grep -qF "$(cat "$HOME_ADMIN/id_ed25519.pub")" "$HOME_ADMIN/.ssh/authorized_keys"; then
        cat "$HOME_ADMIN/id_ed25519.pub" >> "$HOME_ADMIN/.ssh/authorized_keys"
    fi
    chown "$ADMIN:$ADMIN" "$HOME_ADMIN/.ssh/authorized_keys"
    chmod 600 "$HOME_ADMIN/.ssh/authorized_keys"
    rm -f "$HOME_ADMIN/id_ed25519.pub"
    echo "Llave de Windows autorizada para $ADMIN."
else
    echo "AVISO: no encontré $HOME_ADMIN/id_ed25519.pub; cada 'ssh' pedirá la contraseña."
    echo "       Cópiala con:  scp \$env:USERPROFILE\\.ssh\\id_ed25519.pub hpc-base:"
fi

# sudo sin contraseña para el administrador: los scripts 4 y 6 se lanzan por SSH
# y no tienen terminal donde escribirla.
echo "$ADMIN ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-upbc-admin
chmod 440 /etc/sudoers.d/90-upbc-admin
visudo -cf /etc/sudoers.d/90-upbc-admin >/dev/null

# -----------------------------------------------------------------------------
paso "OpenMPI: solo por la red host-only"
# -----------------------------------------------------------------------------
# ESTE ES EL PROBLEMA CLÁSICO DE MPI EN VIRTUALBOX.
#
# Cada VM tiene una tarjeta NAT, y VirtualBox les da a TODAS la misma IP en ella
# (10.0.2.15), porque cada NAT es una red privada distinta. OpenMPI ve esa
# 10.0.2.15 en todos los nodos, intenta usarla para hablar entre procesos y cada
# nodo acaba conectándose consigo mismo: mpirun se queda colgado sin mensaje.
#
# Se le obliga a usar solo 192.168.56.0/24. Además:
#   - pml/btl fijos a TCP: evita que pruebe UCX o InfiniBand, que no existen en
#     una VM y llenan la salida de avisos.
#   - rango de puertos fijo, como recomienda la guía del laboratorio, por si
#     después se activa un firewall.
cat > /etc/openmpi/openmpi-mca-params.conf <<EOF
# --- UPB-CIENTIFICA: clúster local en VirtualBox ---
pml = ob1
btl = self,vader,tcp
btl_tcp_if_include = ${RED_CLUSTER}
oob_tcp_if_include = ${RED_CLUSTER}
btl_tcp_port_min_v4 = 10000
btl_tcp_port_range_v4 = 1000
EOF

# -----------------------------------------------------------------------------
paso "Directorio compartido /srv/home"
# -----------------------------------------------------------------------------
install -d -m 775 -o mpiuser -g mpigroup /srv/home

# -----------------------------------------------------------------------------
paso "Limpieza antes de clonar"
# -----------------------------------------------------------------------------
apt-get clean

cat <<EOF

Plantilla lista.

Ahora APAGA la VM (no la clones encendida):
    sudo poweroff

Y en Windows sigue con el paso 3:
    .\\3-clonar-nodos.ps1
EOF
