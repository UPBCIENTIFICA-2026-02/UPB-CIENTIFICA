#!/usr/bin/env bash
# =============================================================================
# Paso 4 — Convierte un clon de la plantilla en un nodo concreto del clúster.
#
#   sudo bash 4-configurar-nodo.sh hpc-master     <- SIEMPRE primero
#   sudo bash 4-configurar-nodo.sh hpc-worker1
#   sudo bash 4-configurar-nodo.sh hpc-worker2
#
# El maestro va primero porque es el servidor NFS: los workers intentan montar
# su /srv/home al terminar.
#
# Qué hace:
#   1. Nombre del nodo e IP fija en la red host-only.
#   2. /etc/hosts con los tres nodos, SIN la línea 127.0.1.1.
#   3. Identidad propia: machine-id y llaves de host SSH nuevas (los clones
#      salieron todos con las de la plantilla).
#   4. NFS: el maestro exporta /srv/home; los workers lo montan.
#
# Se puede repetir sin romper nada.
# =============================================================================
set -euo pipefail

paso()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33mAVISO: %s\033[0m\n' "$*"; }
falla() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

NOMBRE="${1:-}"
case "$NOMBRE" in
    hpc-master)  IP="192.168.56.10" ;;
    hpc-worker1) IP="192.168.56.11" ;;
    hpc-worker2) IP="192.168.56.12" ;;
    *) falla "uso: sudo bash $0 hpc-master|hpc-worker1|hpc-worker2" ;;
esac

[ "$(id -u)" -eq 0 ] || falla "ejecútalo con sudo"
id mpiuser >/dev/null 2>&1 || falla "no existe mpiuser: ¿este clon salió de una plantilla preparada con el paso 2?"

RED="192.168.56.0/24"
MARCA_INI="# >>> UPB-CIENTIFICA host-only >>>"
MARCA_FIN="# <<< UPB-CIENTIFICA host-only <<<"

# -----------------------------------------------------------------------------
paso "Detectando la tarjeta host-only"
# -----------------------------------------------------------------------------
# La tarjeta NAT es la que lleva la ruta por defecto (salida a Internet). La
# host-only es la otra. Se detecta en vez de suponer "enp0s8" por si VirtualBox
# o el kernel las nombran distinto.
IF_NAT="$(ip route show default | awk '{print $5; exit}')"
IF_HO="$(ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' \
         | grep -v -x -e lo -e "${IF_NAT:-ninguna}" | head -n1)"
[ -n "$IF_HO" ] || falla "no encuentro una segunda tarjeta de red. Revisa que el Adaptador 2 de la VM sea 'Solo-anfitrión'."
echo "NAT: ${IF_NAT:-?}   host-only: $IF_HO   ->   $IP/24"

# -----------------------------------------------------------------------------
paso "Nombre y resolución de nombres"
# -----------------------------------------------------------------------------
# /etc/hosts se reescribe ANTES de cambiar el nombre, para que el nombre nuevo
# ya resuelva (si no, sudo se queja con "unable to resolve host").
cat > /etc/hosts <<'EOF'
127.0.0.1       localhost
::1             localhost ip6-localhost ip6-loopback
ff02::1         ip6-allnodes
ff02::2         ip6-allrouters

# --- Clúster UPB-CIENTIFICA (red host-only de VirtualBox) ---
# A propósito NO hay línea "127.0.1.1 <nombre-del-nodo>": si un nodo resuelve
# su propio nombre a loopback, los demás no pueden alcanzarlo y MPI falla.
192.168.56.10   hpc-master
192.168.56.11   hpc-worker1
192.168.56.12   hpc-worker2

# El Windows anfitrión: ahí corren auth-local, Storage, Media y el portal.
192.168.56.1    anfitrion-windows
EOF
hostnamectl set-hostname "$NOMBRE"
echo "hostname: $(hostname)"

# -----------------------------------------------------------------------------
paso "IP fija $IP en $IF_HO"
# -----------------------------------------------------------------------------
# Se quita el bloque de una ejecución anterior y se escribe el nuevo.
sed -i "/^${MARCA_INI}\$/,/^${MARCA_FIN}\$/d" /etc/network/interfaces
cat >> /etc/network/interfaces <<EOF
${MARCA_INI}
# Sin "gateway": la salida a Internet sigue siendo por la tarjeta NAT.
allow-hotplug ${IF_HO}
iface ${IF_HO} inet static
    address ${IP}/24
${MARCA_FIN}
EOF
ifdown "$IF_HO" >/dev/null 2>&1 || true
ip addr flush dev "$IF_HO"
ifup "$IF_HO"
ip -4 -brief addr show "$IF_HO"

# -----------------------------------------------------------------------------
paso "Identidad propia del nodo (machine-id y llaves de host SSH)"
# -----------------------------------------------------------------------------
# Los tres clones nacieron con el machine-id y las llaves de host de la
# plantilla. Dos máquinas con la misma identidad confunden a systemd, al DHCP y
# a SSH. Esta sesión SSH no se corta al reiniciar el servicio.
rm -f /etc/machine-id /var/lib/dbus/machine-id
systemd-machine-id-setup >/dev/null
ln -sf /etc/machine-id /var/lib/dbus/machine-id
rm -f /etc/ssh/ssh_host_*
ssh-keygen -A >/dev/null
systemctl restart ssh
echo "machine-id: $(cat /etc/machine-id)"

# -----------------------------------------------------------------------------
if [ "$NOMBRE" = "hpc-master" ]; then
    paso "NFS: exportando /srv/home a la red del clúster"
    # -------------------------------------------------------------------------
    # Con 3 máquinas no hay una VM node-repository aparte: el maestro hace de
    # servidor NFS. Es la única diferencia de topología con la guía del
    # laboratorio (docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md, paso 6).
    install -d -m 775 -o mpiuser -g mpigroup /srv/home
    LINEA="/srv/home  ${RED}(rw,sync,no_subtree_check)"
    grep -qxF "$LINEA" /etc/exports 2>/dev/null || echo "$LINEA" >> /etc/exports
    systemctl enable --now nfs-server >/dev/null
    exportfs -ra
    exportfs -v
else
    paso "NFS: montando /srv/home desde hpc-master"
    # -------------------------------------------------------------------------
    systemctl disable --now nfs-server >/dev/null 2>&1 || true

    # x-systemd.automount + nofail: el montaje se hace al primer acceso. Así el
    # worker arranca aunque el maestro todavía no esté encendido, y se monta
    # solo en cuanto alguien toca /srv/home. Sin esto, encender las VMs en otro
    # orden deja el worker colgado en el arranque.
    LINEA="hpc-master:/srv/home  /srv/home  nfs4  defaults,_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=20  0  0"
    sed -i '\#^hpc-master:/srv/home[[:space:]]#d' /etc/fstab
    echo "$LINEA" >> /etc/fstab
    systemctl daemon-reload
    systemctl restart remote-fs.target

    if ping -c1 -W2 hpc-master >/dev/null 2>&1; then
        ls /srv/home >/dev/null 2>&1 || true
        if findmnt -t nfs4 /srv/home >/dev/null; then
            findmnt -t nfs4 /srv/home
        else
            aviso "hpc-master responde pero /srv/home no se montó. ¿Configuraste el maestro primero?"
        fi
    else
        aviso "hpc-master no responde todavía. Se montará solo la primera vez que se use /srv/home."
    fi
fi

# -----------------------------------------------------------------------------
paso "Comprobación"
# -----------------------------------------------------------------------------
for n in hpc-master hpc-worker1 hpc-worker2; do
    if ping -c1 -W2 "$n" >/dev/null 2>&1; then r="responde"; else r="NO responde (¿aún sin configurar?)"; fi
    printf '  %-12s %s\n' "$n" "$r"
done

cat <<EOF

$NOMBRE configurado: $IP en $IF_HO.
EOF
if [ "$NOMBRE" != "hpc-worker2" ]; then
    echo "Sigue con el siguiente nodo."
else
    echo "Los tres nodos están configurados. Siguiente: paso 5 (validar MPI) en hpc-master."
fi
