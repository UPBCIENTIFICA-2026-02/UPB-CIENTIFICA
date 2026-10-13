#!/usr/bin/env bash
# respaldo-gpg.sh — Copia de seguridad CIFRADA del repositorio central (RF-11).
#
# Corre en la VM node-repository (diagrama de despliegue: GnuPG 2.4,
# upbc-respaldo.pub, respaldo-gpg.sh). Cifra con GPG usando SOLO la llave
# PÚBLICA de respaldo: este servidor no tiene, ni necesita, la llave privada.
# Criterio de verificación de RF-11: "una copia de seguridad generada por el
# sistema no puede leerse sin la llave privada, la cual se custodia fuera del
# servidor de datos". La privada la genera y guarda el custodio con
# generar-llaves-respaldo.sh, en OTRA máquina.
#
# Qué se respalda (las dos partes hacen falta para restaurar):
#   archivos.tar.gz.gpg     el árbol físico de Storage (RAIZ_ALMACENAMIENTO,
#                           /srv/home en producción): <uid>/<id>.v<N>
#   <base>.dump.gpg         pg_dump de cada base: metadatos_storage (qué
#                           archivo es cada <id>, sus versiones, carpetas y
#                           comparticiones) y comparticiones (Shared File).
#   MANIFIESTO.sha256       SHA-256 de los .gpg, para detectar corrupción
#                           antes de intentar descifrar.
#
# El contenido NUNCA toca el disco sin cifrar: tar y pg_dump van por tubería
# directamente a gpg.
#
# Uso:
#   respaldo-gpg.sh                 respaldo completo con la configuración de
#                                   /etc/upbc/respaldo.conf (o variables de entorno)
#   respaldo-gpg.sh --verificar     comprueba la configuración sin respaldar
#
# Programado (cron, todos los días a las 02:30):
#   30 2 * * *  root  /opt/upbc/respaldo/respaldo-gpg.sh >> /var/log/upbc-respaldo.log 2>&1
set -euo pipefail

# --- Configuración ------------------------------------------------------------
# Todo se puede fijar en /etc/upbc/respaldo.conf (KEY=valor) o por entorno.
CONF="${CONF:-/etc/upbc/respaldo.conf}"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

LLAVE_PUBLICA="${LLAVE_PUBLICA:-/etc/upbc/upbc-respaldo.pub}"
RAIZ_ALMACENAMIENTO="${RAIZ_ALMACENAMIENTO:-/srv/home}"
DESTINO="${DESTINO:-/var/backups/upbc}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"
# Bases a volcar: "nombre=URL de conexión" separadas por espacios. Si se deja
# vacío se leen DATABASE_URL de los .env de los servicios (ENV_STORAGE, ENV_SHARED).
BASES="${BASES:-}"
ENV_STORAGE="${ENV_STORAGE:-/opt/upbc/node-repository/.env}"
ENV_SHARED="${ENV_SHARED:-/opt/upbc/node-shared-file/.env}"

registro() { printf '%s [respaldo] %s\n' "$(date '+%F %T')" "$*"; }
fallo() { registro "ERROR: $*"; exit 1; }

url_de_env() {   # url_de_env <archivo .env>  -> DATABASE_URL
    [ -f "$1" ] && sed -n 's/^DATABASE_URL=//p' "$1" | tail -n1 | tr -d '\r"'"'"
}

if [ -z "$BASES" ]; then
    u="$(url_de_env "$ENV_STORAGE" || true)"; [ -n "$u" ] && BASES="metadatos_storage=$u"
    u="$(url_de_env "$ENV_SHARED" || true)";  [ -n "$u" ] && BASES="$BASES comparticiones=$u"
fi

# --- Comprobaciones ------------------------------------------------------------
command -v gpg >/dev/null     || fallo "no está gpg (apt install gnupg)"
command -v pg_dump >/dev/null || fallo "no está pg_dump (apt install postgresql-client)"
[ -f "$LLAVE_PUBLICA" ] || fallo "no existe la llave pública $LLAVE_PUBLICA (cópiala desde el custodio)"
[ -d "$RAIZ_ALMACENAMIENTO" ] || fallo "no existe RAIZ_ALMACENAMIENTO=$RAIZ_ALMACENAMIENTO"
[ -n "$BASES" ] || fallo "no hay bases que volcar (define BASES o los .env de los servicios)"

# Un anillo de llaves temporal y vacío: gpg no toca el del usuario ni el de root,
# y queda demostrado que aquí no hay ninguna llave privada.
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
chmod 700 "$GNUPGHOME"
trap 'rm -rf "$GNUPGHOME"' EXIT

# La llave tiene que ser de cifrado y no estar caducada ni revocada: si no, gpg
# fallaría a mitad del respaldo. --show-keys la inspecciona sin importarla.
info="$(gpg --batch --with-colons --show-keys "$LLAVE_PUBLICA" 2>/dev/null)" || fallo "$LLAVE_PUBLICA no es una llave pública GPG válida"
# Campo 12 de "pub": capacidades utilizables de toda la llave; "E" = puede cifrar.
awk -F: '$1 == "pub" && $12 ~ /E/ {ok = 1} END {exit !ok}' <<<"$info" \
    || fallo "la llave $LLAVE_PUBLICA no puede cifrar (sin subllave de cifrado válida)"
if awk -F: '$1 == "pub" && $2 ~ /[re]/ {m = 1} END {exit !m}' <<<"$info"; then
    fallo "la llave $LLAVE_PUBLICA está revocada o caducada: pide una nueva al custodio"
fi
huella="$(awk -F: '/^fpr:/ {print $10; exit}' <<<"$info")"

if [ "${1:-}" = "--verificar" ]; then
    nombres=""; for par in $BASES; do nombres="$nombres ${par%%=*}"; done
    registro "configuración correcta: llave $huella, datos en $RAIZ_ALMACENAMIENTO, bases:$nombres"
    exit 0
fi

# Nunca dos respaldos a la vez sobre el mismo destino.
mkdir -p "$DESTINO"
exec 9>"$DESTINO/.bloqueo"
if command -v flock >/dev/null; then flock -n 9 || fallo "ya hay un respaldo en curso"; fi

cifrar() {   # cifrar <salida.gpg>   (lee de la entrada estándar)
    gpg --batch --yes --quiet --trust-model always \
        --recipient-file "$LLAVE_PUBLICA" --encrypt --output "$1"
}

marca="$(date '+%Y%m%d-%H%M%S')"
dir="$DESTINO/$marca"
mkdir -p "$dir"
umask 077
registro "inicio -> $dir (llave $huella)"

# --- 1. Archivos -----------------------------------------------------------------
tar -C "$RAIZ_ALMACENAMIENTO" -czf - . | cifrar "$dir/archivos.tar.gz.gpg" \
    || fallo "no se pudo respaldar $RAIZ_ALMACENAMIENTO"
registro "archivos: $(du -h "$dir/archivos.tar.gz.gpg" | cut -f1)"

# --- 2. Bases de datos (formato custom: se restaura con pg_restore) ---------------
for par in $BASES; do
    nombre="${par%%=*}"; url="${par#*=}"
    pg_dump --format=custom --no-owner --dbname="$url" | cifrar "$dir/$nombre.dump.gpg" \
        || fallo "no se pudo volcar la base $nombre"
    registro "base $nombre: $(du -h "$dir/$nombre.dump.gpg" | cut -f1)"
done

# --- 3. Manifiesto -----------------------------------------------------------------
( cd "$dir" && sha256sum ./*.gpg > MANIFIESTO.sha256 )
printf 'llave=%s\nfecha=%s\nraiz=%s\n' "$huella" "$marca" "$RAIZ_ALMACENAMIENTO" > "$dir/INFO"

# --- 4. Retención: se borran los respaldos de más de RETENCION_DIAS días ----------
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$RETENCION_DIAS" -print -exec rm -rf {} + \
    | sed 's/^/  borrado por antigüedad: /' || true

registro "fin: respaldo $marca completo"
