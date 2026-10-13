#!/usr/bin/env bash
# =============================================================================
# Paso 6 — Despliega el servicio HPC en hpc-master: job-runner (MPI),
# gestor-cluster (RMI) y job-api (REST).
#
#   (en Windows, tras compilar: mvn -f RMIUPBCientifica\pom.xml package -DskipTests)
#   scp RMIUPBCientifica/{gestor-cluster,job-api,job-runner}/target/*.jar \
#       RMIUPBCientifica/job-runner/ejemplos/pi.c 6-desplegar-gestor.sh hpc-master:
#   ssh hpc-master "sudo bash 6-desplegar-gestor.sh"            # autenticación simulada
#   ssh hpc-master "sudo bash 6-desplegar-gestor.sh soap"       # valida contra auth-local
#
# Flujo (Contrato_HPC): el usuario elige código fuente y dataset de su Home;
# gestor-cluster los valida y descarga de Storage (Windows, 192.168.56.1:8084)
# con el token del usuario, planifica y asigna nodos según su carga, y entrega
# el trabajo a job-runner, que lo compila con mpicc y lo lanza con mpirun sobre
# los nodos asignados. La salida vuelve al Home ("Resultados HPC/...").
#
# En el CCA el gestor y job-api van en la VM node-rmi y job-runner en hpc-master
# (Registry 2099/2100). Aquí los tres comparten hpc-master, así que job-runner
# usa 2199/2200 para no chocar con el gestor.
#
# ANTES este paso desplegaba solo el gestor, que ejecutaba el "comando" de cada
# trabajo con `bash -c` como mpiuser (riesgo V-11). Ya no hay shell en el camino.
# =============================================================================
set -euo pipefail

paso()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32mOK\033[0m  %s\n' "$*"; }
aviso() { printf '\033[1;33mAVISO: %s\033[0m\n' "$*"; }
falla() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

MODO_AUTH="${1:-simulado}"
case "$MODO_AUTH" in simulado|soap) ;; *) falla "uso: sudo bash $0 [simulado|soap]" ;; esac

# auth-local y Storage corren en el Windows; desde las VMs se les ve en la IP host-only.
URL_AUTH="http://192.168.56.1:8081/soap/user.php"
URL_STORAGE="http://192.168.56.1:8084"
IP_MAESTRO="192.168.56.10"
RED_CLUSTER="192.168.56.0/24"
DIR_APP=/opt/upbc
DIR_TRABAJOS=/srv/home/.hpc-trabajos
DIR_ESTADO=/var/lib/upbc

[ "$(id -u)" -eq 0 ] || falla "ejecútalo con sudo"
[ "$(hostname)" = "hpc-master" ] || falla "esto va en hpc-master (estás en $(hostname))"
command -v java >/dev/null || falla "no hay Java. ¿Se saltó el paso 2?"
command -v mpicc >/dev/null || falla "no hay mpicc (libopenmpi-dev). ¿Se saltó el paso 2?"
[ -f /srv/home/hostfile ] || falla "falta /srv/home/hostfile: haz antes el paso 5"

ORIGEN="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
for jar in gestor-cluster.jar job-api.jar job-runner.jar; do
    [ -f "$ORIGEN/$jar" ] || falla "no encuentro $ORIGEN/$jar. Cópialo desde Windows (ver la cabecera)."
done

# Nodos de la malla para el gestor, sacados del hostfile del paso 5:
#   "hpc-master slots=2" -> "hpc-master:2,hpc-worker1:2,..."
NODOS="$(awk '/slots=/ {split($2, s, "="); printf "%s%s:%s", sep, $1, s[2]; sep=","}' /srv/home/hostfile)"

# -----------------------------------------------------------------------------
paso "Instalando los .jar en $DIR_APP"
# -----------------------------------------------------------------------------
install -d -m 755 "$DIR_APP"
install -m 644 "$ORIGEN/gestor-cluster.jar" "$ORIGEN/job-api.jar" "$ORIGEN/job-runner.jar" "$DIR_APP/"
# Directorio compartido por NFS: mpirun lanza el binario en todos los nodos.
install -d -m 770 -o mpiuser -g mpigroup "$DIR_TRABAJOS"
install -d -m 750 -o mpiuser -g mpigroup "$DIR_ESTADO"
ls -l "$DIR_APP"
ok "nodos de la malla: $NODOS"

# -----------------------------------------------------------------------------
paso "Servicios systemd (autenticación: $MODO_AUTH)"
# -----------------------------------------------------------------------------
# Los tres corren como mpiuser: mpirun necesita su llave SSH y se niega a correr
# como root. -Djava.rmi.server.hostname: el stub RMI lleva la dirección a la que
# hay que llamar.
AMBIENTE_AUTH="Environment=AUTH_MODE=${MODO_AUTH}"
if [ "$MODO_AUTH" = "soap" ]; then
    AMBIENTE_AUTH="${AMBIENTE_AUTH}
Environment=AUTH_URL=${URL_AUTH}
Environment=AUTH_NS=http://192.168.1.195/soap"
fi

cat > /etc/systemd/system/upbc-job-runner.service <<EOF
[Unit]
Description=UPB-CIENTIFICA job-runner (ejecutor MPI, RMI 2199/2200)
After=network-online.target remote-fs.target
Wants=network-online.target

[Service]
User=mpiuser
Group=mpigroup
Environment=RUNNER_PUERTO_REGISTRY=2199
Environment=RUNNER_PUERTO_OBJETO=2200
Environment=DIR_TRABAJOS=${DIR_TRABAJOS}
Environment=NODOS_LOCALES=hpc-master
# OpenMPI elige mal la interfaz con la NAT de VirtualBox: solo la red host-only.
Environment="MPIRUN_OPCIONES=--mca btl_tcp_if_include ${RED_CLUSTER} --mca oob_tcp_if_include ${RED_CLUSTER}"
ExecStart=/usr/bin/java -Xmx128m -Djava.rmi.server.hostname=127.0.0.1 -jar ${DIR_APP}/job-runner.jar
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/upbc-gestor.service <<EOF
[Unit]
Description=UPB-CIENTIFICA gestor-cluster (RMI Registry 2099, objeto remoto 2100, métricas 9102)
After=network-online.target upbc-job-runner.service
Wants=network-online.target upbc-job-runner.service

[Service]
User=mpiuser
Group=mpigroup
${AMBIENTE_AUTH}
Environment=URL_STORAGE=${URL_STORAGE}
Environment=EJECUTOR_HOST=127.0.0.1
Environment=EJECUTOR_PUERTO=2199
Environment=HPC_NODOS=${NODOS}
Environment=ESTADO_HPC=${DIR_ESTADO}/trabajos.ser
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
systemctl enable upbc-job-runner.service upbc-gestor.service upbc-job-api.service >/dev/null
# restart y no start: si ya estaban corriendo, toman los .jar nuevos.
systemctl restart upbc-job-runner.service
sleep 2
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
esperar_puerto 2199 "job-runner" upbc-job-runner.service
esperar_puerto 2099 "RMI Registry del gestor" upbc-gestor.service
esperar_puerto 2100 "objeto remoto ServicioHpc" upbc-gestor.service
esperar_puerto 9102 "métricas del gestor" upbc-gestor.service
esperar_puerto 8082 "job-api" upbc-job-api.service

# -----------------------------------------------------------------------------
paso "Pruebas"
# -----------------------------------------------------------------------------
codigo="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8082/jobs)"
[ "$codigo" = "401" ] || falla "sin token, /jobs debía responder 401 y respondió $codigo"
ok "sin token -> 401 (la autenticación está activa)"

if [ "$MODO_AUTH" = "soap" ]; then
    echo
    echo "En modo soap la prueba con un trabajo real se hace desde un cliente con un"
    echo "token emitido por auth-local (portal, escritorio o móvil): sube ejemplos/pi.c"
    echo "a tu Home y envíalo con 6 procesos."
    exit 0
fi

# En modo simulado el gestor y Storage aceptan "mock-token-<uid>-...".
TOKEN="mock-token-mpiuser-despliegue"
if ! curl -s -m 5 -o /dev/null "$URL_STORAGE/health"; then
    aviso "no llego a Storage ($URL_STORAGE). Arráncalo en Windows (paso 7) y abre el 8084 en su firewall."
    exit 0
fi
[ -f "$ORIGEN/pi.c" ] || { aviso "copia ejemplos/pi.c al Home de $SUDO_USER para la prueba de punta a punta"; exit 0; }

# 1) El código de prueba al Home del usuario en Storage (como haría un cliente).
subido="$(curl -s -X POST "$URL_STORAGE/storage/archivos?directorioDestino=root&sobrescribir=true" \
    -H "Authorization: Bearer $TOKEN" -F "archivo=@$ORIGEN/pi.c")"
echo "$subido" | grep -q '"id"' || falla "Storage no aceptó pi.c: $subido"
ok "pi.c subido al Home de mpiuser en Storage"

# 2) Trabajo con tantos procesos como slots tenga el hostfile.
NP="$(awk -F'slots=' '{s += $2} END {print s}' /srv/home/hostfile)"
respuesta="$(curl -s -X POST http://127.0.0.1:8082/jobs \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"nombreTrabajo\":\"prueba-despliegue\",\"rutaCodigo\":\"/pi.c\",\"numeroProcesos\":$NP,\"tiempoMaximoEjecucion\":120,\"parametrosEjecucion\":{\"pasos\":\"50000000\"}}")"
id="$(echo "$respuesta" | sed -n 's/.*"trabajoId":"\([^"]*\)".*/\1/p')"
[ -n "$id" ] || falla "POST /jobs no devolvió trabajoId: $respuesta"
ok "trabajo enviado: $id ($NP procesos)"

estado=""
for i in $(seq 1 90); do
    detalle="$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8082/jobs/$id")"
    estado="$(echo "$detalle" | sed -n 's/.*"estado":"\([A-Z_]*\)".*/\1/p')"
    case "$estado" in COMPLETADO|FALLIDO|FALLIDO_TIMEOUT|CANCELADO) break ;; esac
    sleep 1
done
echo "  estado final: $estado"
logs="$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8082/jobs/$id/logs" \
        | sed -n 's/.*"logsEjecucion":"\(.*\)"}.*/\1/p' | sed 's/\\n/\n/g')"
echo "$logs" | sed 's/^/    /'
[ "$estado" = "COMPLETADO" ] || falla "el trabajo no terminó bien. Mira: journalctl -u upbc-job-runner -u upbc-gestor -n 80"

nodos="$(echo "$logs" | awk '/^rango .* en / {print $4}' | sed 's/:$//' | sort -u | wc -l)"
total="$(wc -l < /srv/home/hostfile)"
[ "$nodos" -eq "$total" ] || falla "el trabajo corrió en $nodos nodos y debían ser $total"
ok "Storage -> gestor (RMI) -> job-runner -> mpicc + mpirun en $nodos nodos -> resultado en el Home"

cat <<EOF

=============================================================
 job-api:   http://${IP_MAESTRO}:8082/jobs   (desde Windows: el portal y las apps)
 Métricas:  http://${IP_MAESTRO}:9102/metrics
 Logs:      journalctl -u upbc-job-runner -u upbc-gestor -f
 Windows (paso 7): .\\7-iniciar-servicios-windows.ps1 (sin -HpcLocal) apunta el portal aquí.
=============================================================
EOF
