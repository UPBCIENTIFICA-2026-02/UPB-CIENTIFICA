#!/usr/bin/env bash
# =============================================================================
# Paso 6 — Despliega gestor-cluster (RMI) y job-api (REST) en hpc-master.
#
#   (en Windows, tras compilar)  scp gestor-cluster.jar job-api.jar 6-desplegar-gestor.sh hpc-master:
#   ssh hpc-master "sudo bash 6-desplegar-gestor.sh"            # autenticación simulada
#   ssh hpc-master "sudo bash 6-desplegar-gestor.sh soap"       # valida contra auth-local
#
# ¿POR QUÉ EN EL MAESTRO, si el diagrama los pone en una VM node-rmi aparte?
# ----------------------------------------------------------------------------
# Porque job-runner.jar todavía no existe. Hoy gestor-cluster ejecuta el comando
# de cada trabajo con `bash -c` EN LA MÁQUINA DONDE CORRE. Si corre en hpc-master
# como mpiuser, un trabajo cuyo comando es `mpirun ... --hostfile ...` se reparte
# de verdad entre los tres nodos: es el puente más corto entre el portal y el
# clúster con el código que ya existe. (En Windows tampoco serviría: ahí `bash`
# es el lanzador de WSL.)
#
# ⚠ Con esto, cualquier usuario autenticado puede ejecutar cualquier comando
#   como mpiuser en el clúster. Es aceptable en un entorno local de pruebas, y
#   es justo el pendiente 7.3 de TRASPASO.md: lo resuelve job-runner.jar.
# =============================================================================
set -euo pipefail

paso()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mOK\033[0m  %s\n' "$*"; }
aviso() { printf '\033[1;33mAVISO: %s\033[0m\n' "$*"; }
falla() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

MODO_AUTH="${1:-simulado}"
case "$MODO_AUTH" in simulado|soap) ;; *) falla "uso: sudo bash $0 [simulado|soap]" ;; esac

# auth-local corre en el Windows; desde las VMs se le ve en la IP host-only.
URL_AUTH="http://192.168.56.1:8081/soap/user.php"
IP_MAESTRO="192.168.56.10"
DIR_APP=/opt/upbc

[ "$(id -u)" -eq 0 ] || falla "ejecútalo con sudo"
[ "$(hostname)" = "hpc-master" ] || falla "esto va en hpc-master (estás en $(hostname))"
command -v java >/dev/null || falla "no hay Java. ¿Se saltó el paso 2?"

ORIGEN="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
for jar in gestor-cluster.jar job-api.jar; do
    [ -f "$ORIGEN/$jar" ] || falla "no encuentro $ORIGEN/$jar. Cópialo desde Windows (ver la guía, paso 6)."
done

# -----------------------------------------------------------------------------
paso "Instalando los .jar en $DIR_APP"
# -----------------------------------------------------------------------------
install -d -m 755 "$DIR_APP"
install -m 644 "$ORIGEN/gestor-cluster.jar" "$ORIGEN/job-api.jar" "$DIR_APP/"
ls -l "$DIR_APP"

# El gestor no tiene ninguna salida de "versión"; esto al menos confirma que el
# .jar trae la autenticación (si no, es un build anterior a ese cambio).
if unzip -l "$DIR_APP/gestor-cluster.jar" 2>/dev/null | grep -q 'gestor/auth/ValidadorToken'; then
    ok "gestor-cluster.jar incluye la validación de token"
elif command -v unzip >/dev/null; then
    aviso "gestor-cluster.jar NO trae gestor/auth: está desactualizado. Recompila con 'mvn -DskipTests package'."
fi

# -----------------------------------------------------------------------------
paso "Servicios systemd (autenticación: $MODO_AUTH)"
# -----------------------------------------------------------------------------
# Ambos corren como mpiuser: el gestor lanza mpirun, que necesita la llave SSH
# de mpiuser y se niega a correr como root. WorkingDirectory=/srv/home para que
# los trabajos escriban en el almacenamiento compartido.
#
# -Djava.rmi.server.hostname: el stub RMI lleva dentro la dirección a la que hay
# que llamar. Se fija la IP host-only para que también funcione si job-api se
# mueve a otra máquina.
#
# Límites de memoria (-Xmx): el maestro tiene 2 GB y además calcula y sirve NFS.
AMBIENTE_AUTH="Environment=AUTH_MODE=${MODO_AUTH}"
if [ "$MODO_AUTH" = "soap" ]; then
    AMBIENTE_AUTH="${AMBIENTE_AUTH}
Environment=AUTH_URL=${URL_AUTH}
Environment=AUTH_NS=http://192.168.1.195/soap"
fi

cat > /etc/systemd/system/upbc-gestor.service <<EOF
[Unit]
Description=UPB-CIENTIFICA gestor-cluster (RMI Registry 2099, objeto remoto 2100)
After=network-online.target
Wants=network-online.target

[Service]
User=mpiuser
Group=mpigroup
WorkingDirectory=/srv/home
${AMBIENTE_AUTH}
ExecStart=/usr/bin/java -Xmx128m -Djava.rmi.server.hostname=${IP_MAESTRO} -jar ${DIR_APP}/gestor-cluster.jar
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/upbc-job-api.service <<EOF
[Unit]
Description=UPB-CIENTIFICA job-api (REST 8082)
After=upbc-gestor.service
Wants=upbc-gestor.service

[Service]
User=mpiuser
Group=mpigroup
ExecStart=/usr/bin/java -Xmx256m -jar ${DIR_APP}/job-api.jar
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable upbc-gestor.service upbc-job-api.service >/dev/null
# restart y no start: si ya estaban corriendo, toman los .jar nuevos.
systemctl restart upbc-gestor.service
systemctl restart upbc-job-api.service

# -----------------------------------------------------------------------------
paso "Esperando a que levanten"
# -----------------------------------------------------------------------------
esperar_puerto() {
    local puerto="$1" nombre="$2" i
    for i in $(seq 1 60); do
        ss -ltn "sport = :$puerto" | grep -q LISTEN && { ok "$nombre escuchando en $puerto"; return 0; }
        sleep 1
    done
    journalctl -u "$3" -n 30 --no-pager
    falla "$nombre no abrió el puerto $puerto en 60 s (arriba, su log)."
}
esperar_puerto 2099 "RMI Registry" upbc-gestor.service
esperar_puerto 2100 "objeto remoto JobService" upbc-gestor.service
# Spring Boot tarda más en arrancar, sobre todo en una VM pequeña.
esperar_puerto 8082 "job-api" upbc-job-api.service

# -----------------------------------------------------------------------------
paso "Pruebas"
# -----------------------------------------------------------------------------
codigo="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8082/jobs)"
[ "$codigo" = "401" ] || falla "sin token, /jobs debía responder 401 y respondió $codigo"
ok "sin token -> 401 (la autenticación está activa)"

if [ "$MODO_AUTH" = "soap" ]; then
    if curl -s -m 5 -o /dev/null "$URL_AUTH"; then
        ok "auth-local alcanzable en $URL_AUTH"
    else
        aviso "no llego a auth-local ($URL_AUTH). Arráncalo en Windows y abre el puerto 8081 en su firewall."
    fi
    echo
    echo "En modo soap, la prueba con un trabajo real se hace desde Windows, con un"
    echo "token emitido por auth-local (paso 9 de la guía)."
    exit 0
fi

# En modo simulado el gestor acepta cualquier token "mock-token-<uid>-..."
TOKEN="mock-token-mpiuser-despliegue"

if [ ! -x /srv/home/mpi/hola.bin ] || [ ! -f /srv/home/hostfile ]; then
    aviso "faltan /srv/home/mpi/hola.bin o /srv/home/hostfile: haz el paso 5 para probar un trabajo MPI real."
    exit 0
fi

# Tantos procesos como slots tenga el hostfile (6 con 2 vCPU por nodo).
NP="$(awk -F'slots=' '{s += $2} END {print s}' /srv/home/hostfile)"
CMD="mpirun -np $NP --hostfile /srv/home/hostfile /srv/home/mpi/hola.bin"

respuesta="$(curl -s -X POST http://127.0.0.1:8082/jobs \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"nombre\":\"prueba-despliegue\",\"comando\":\"$CMD\",\"prioridad\":5}")"
id="$(echo "$respuesta" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[ -n "$id" ] || falla "POST /jobs no devolvió id: $respuesta"
ok "trabajo enviado: $id"

estado=""
for i in $(seq 1 60); do
    detalle="$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8082/jobs/$id")"
    estado="$(echo "$detalle" | sed -n 's/.*"estado":"\([A-Z]*\)".*/\1/p')"
    case "$estado" in COMPLETED|FAILED|CANCELLED) break ;; esac
    sleep 1
done

echo "  estado final: $estado"
if [ "$estado" != "COMPLETED" ]; then
    echo "$detalle"
    falla "el trabajo no terminó bien. Mira: journalctl -u upbc-gestor -n 50"
fi

# El resultado viaja como JSON con \n escapados; se desescapan para leerlo.
resultado="$(echo "$detalle" | sed -n 's/.*"resultado":"\([^"]*\)".*/\1/p' | sed 's/\\n/\n/g')"
echo "$resultado" | sed 's/^/    /'
nodos="$(echo "$resultado" | awk '/ejecutandose en/ {print $NF}' | sort -u | wc -l)"
[ "$nodos" -eq 3 ] || falla "el trabajo corrió en $nodos nodos y debían ser 3"
ok "REST -> RMI -> mpirun -> 3 nodos: el gestor está conectado al clúster"

cat <<EOF

=============================================================
 job-api:  http://${IP_MAESTRO}:8082/jobs   (desde Windows)
 Logs:     journalctl -u upbc-gestor -f
           journalctl -u upbc-job-api -f
=============================================================
EOF
