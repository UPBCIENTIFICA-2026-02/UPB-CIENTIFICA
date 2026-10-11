#!/usr/bin/env bash
# =============================================================================
# Paso 5 — Valida el clúster MPI de punta a punta. Se ejecuta en hpc-master
# como mpiuser:
#
#   scp 5-validar-mpi.sh hpc-master:
#   ssh hpc-master "sudo install -o mpiuser -g mpigroup -m 755 5-validar-mpi.sh /home/mpiuser/ && sudo -iu mpiuser ./5-validar-mpi.sh"
#
# Comprueba, en este orden, lo que la guía del laboratorio pide verificar a mano
# (pasos 5, 6, 7, 9 y 10 de docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md):
#   - SSH sin contraseña a los tres nodos
#   - /srv/home realmente compartido
#   - misma versión de OpenMPI en los tres
#   - hostfile
#   - "Hola mundo" repartido en los tres nodos
#   - "Suma" con MPI_Reduce: que los procesos se comunican de verdad
#
# Si algo falla, se detiene y dice qué paso revisar.
# =============================================================================
set -euo pipefail

paso()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mOK\033[0m  %s\n' "$*"; }
falla() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

NODOS=(hpc-master hpc-worker1 hpc-worker2)
DIR_MPI=/srv/home/mpi
HOSTFILE=/srv/home/hostfile

[ "$(id -un)" = "mpiuser" ] || falla "ejecútalo como mpiuser:  sudo -iu mpiuser ./5-validar-mpi.sh"
[ "$(hostname)" = "hpc-master" ] || falla "ejecútalo en hpc-master (estás en $(hostname))"
# OpenMPI se niega a arrancar como root. Por eso todo esto va como mpiuser.

# -----------------------------------------------------------------------------
paso "1. SSH sin contraseña a los tres nodos"
# -----------------------------------------------------------------------------
for n in "${NODOS[@]}"; do
    nombre="$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$n" hostname 2>&1)" \
        || falla "no entro por SSH a $n sin contraseña: $nombre
       Revisa el paso 2 (llave de mpiuser) y que $n esté configurado (paso 4)."
    [ "$nombre" = "$n" ] || falla "conecté a $n pero dice llamarse '$nombre'. ¿Faltó el paso 4 en ese nodo?"
    ok "$n"
done

# -----------------------------------------------------------------------------
paso "2. /srv/home compartido"
# -----------------------------------------------------------------------------
marca="prueba-$(date +%s)-$RANDOM"
echo "$marca" > /srv/home/.prueba-nfs
for n in hpc-worker1 hpc-worker2; do
    visto="$(ssh "$n" cat /srv/home/.prueba-nfs 2>&1)" || true
    [ "$visto" = "$marca" ] || falla "$n no ve lo que escribe el maestro en /srv/home.
       En $n:  findmnt /srv/home   (debe decir nfs4 desde hpc-master:/srv/home)
       Si no, repite el paso 4 en $n."
    ok "$n lee lo escrito por hpc-master"
done
rm -f /srv/home/.prueba-nfs

# -----------------------------------------------------------------------------
paso "3. Misma versión de OpenMPI en todos"
# -----------------------------------------------------------------------------
version_ref="$(mpirun --version | head -n1)"
for n in "${NODOS[@]}"; do
    v="$(ssh "$n" 'mpirun --version | head -n1')"
    [ "$v" = "$version_ref" ] || falla "$n tiene '$v' y el maestro '$version_ref'. Deben ser idénticas."
    ok "$n: $v"
done

# -----------------------------------------------------------------------------
paso "4. hostfile"
# -----------------------------------------------------------------------------
# Con solo 3 máquinas, el maestro TAMBIÉN calcula. La guía del laboratorio lo
# deja fuera para que no compita con el gestor de trabajos, pero aquí sacrificar
# un tercio del clúster no tiene sentido.
: > "$HOSTFILE"
total=0
for n in "${NODOS[@]}"; do
    nucleos="$(ssh "$n" nproc)"
    echo "$n slots=$nucleos" >> "$HOSTFILE"
    total=$((total + nucleos))
done
cat "$HOSTFILE"
ok "$HOSTFILE con $total slots en total"

# -----------------------------------------------------------------------------
paso "5. Hola mundo MPI"
# -----------------------------------------------------------------------------
mkdir -p "$DIR_MPI"
cat > "$DIR_MPI/hola.c" <<'EOF'
#include <mpi.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    char hostname[256];
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    gethostname(hostname, sizeof(hostname));
    printf("Proceso %d de %d ejecutandose en %s\n", rank, size, hostname);
    MPI_Finalize();
    return 0;
}
EOF
# Se compila en /srv/home: el binario tiene que estar en la MISMA ruta en todos
# los nodos, o mpirun falla con "No such file or directory" en los workers.
mpicc "$DIR_MPI/hola.c" -o "$DIR_MPI/hola.bin"

salida="$(timeout 60 mpirun -np "$total" --hostfile "$HOSTFILE" "$DIR_MPI/hola.bin")" \
    || falla "mpirun falló o se colgó más de 60 s. Lo más habitual en VirtualBox es que
       MPI intente usar la tarjeta NAT. Revisa /etc/openmpi/openmpi-mca-params.conf
       (paso 2): tiene que decir btl_tcp_if_include = 192.168.56.0/24."
echo "$salida" | sort -t' ' -k2 -n

distintos="$(echo "$salida" | awk '{print $NF}' | sort -u | wc -l)"
[ "$distintos" -eq "${#NODOS[@]}" ] || falla "los procesos corrieron en $distintos nodos y deberían ser ${#NODOS[@]}.
       Revisa el hostfile y que los workers vean $DIR_MPI/hola.bin."
ok "$total procesos repartidos en los ${#NODOS[@]} nodos"

# -----------------------------------------------------------------------------
paso "6. Comunicación real entre nodos (MPI_Reduce)"
# -----------------------------------------------------------------------------
# El hola mundo prueba que los procesos ARRANCAN; este prueba que se HABLAN.
cat > "$DIR_MPI/suma.c" <<'EOF'
#include <mpi.h>
#include <stdio.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    int valor_local = rank + 1, suma_total = 0;
    MPI_Reduce(&valor_local, &suma_total, 1, MPI_INT, MPI_SUM, 0, MPI_COMM_WORLD);
    if (rank == 0) {
        printf("Suma de 1..%d calculada entre %d procesos = %d\n", size, size, suma_total);
        printf("Valor esperado = %d\n", size * (size + 1) / 2);
    }
    MPI_Finalize();
    return 0;
}
EOF
mpicc "$DIR_MPI/suma.c" -o "$DIR_MPI/suma.bin"
salida="$(timeout 60 mpirun -np "$total" --hostfile "$HOSTFILE" "$DIR_MPI/suma.bin")" \
    || falla "suma.bin falló o se colgó: los procesos arrancan pero no se comunican (firewall o tarjeta de red)."
echo "$salida"
obtenido="$(echo "$salida" | sed -n 's/.*procesos = \([0-9]*\).*/\1/p')"
esperado=$(( total * (total + 1) / 2 ))
[ "$obtenido" = "$esperado" ] || falla "la suma dio '$obtenido' y debía dar $esperado"
ok "los nodos se comunican: $obtenido = $esperado"

cat <<EOF

=============================================================
 Clúster validado: ${#NODOS[@]} nodos, $total procesos MPI.
 Guarda esta salida: es la evidencia para el informe y la bitácora.

 Comando que usarás desde el portal para lanzar un trabajo:
   mpirun -np $total --hostfile $HOSTFILE $DIR_MPI/hola.bin
=============================================================
EOF
