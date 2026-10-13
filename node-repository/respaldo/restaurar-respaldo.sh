#!/usr/bin/env bash
# restaurar-respaldo.sh — Descifra y restaura un respaldo de respaldo-gpg.sh.
#
# Necesita la LLAVE PRIVADA de respaldo (la del custodio): por eso se ejecuta
# donde ella esté, no en node-repository. Comprueba el MANIFIESTO antes de
# descifrar nada.
#
#   ./restaurar-respaldo.sh <carpeta-del-respaldo> <llave-privada.asc> <destino>
#       -> <destino>/archivos/      el árbol de Storage tal como estaba
#          <destino>/<base>.dump    volcados de PostgreSQL (formato custom)
#
# Para volver a cargarlos en el servidor (con los servicios detenidos):
#   rsync -a <destino>/archivos/ /srv/home/
#   pg_restore --clean --if-exists --no-owner -d <URL de la base> <destino>/metadatos_storage.dump
#   pg_restore --clean --if-exists --no-owner -d <URL de la base> <destino>/comparticiones.dump
set -euo pipefail

[ $# -eq 3 ] || { echo "uso: $0 <carpeta-del-respaldo> <llave-privada.asc> <destino>"; exit 1; }
RESPALDO="$1"; PRIVADA="$2"; DESTINO="$3"

[ -f "$RESPALDO/MANIFIESTO.sha256" ] || { echo "$RESPALDO no parece un respaldo (falta MANIFIESTO.sha256)"; exit 1; }
echo "==> Comprobando integridad"
( cd "$RESPALDO" && sha256sum -c --quiet MANIFIESTO.sha256 ) || { echo "El respaldo está dañado: no se restaura."; exit 1; }

export GNUPGHOME="$(mktemp -d)"; chmod 700 "$GNUPGHOME"
trap 'rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --import "$PRIVADA"     # pedirá la frase de paso al descifrar

mkdir -p "$DESTINO/archivos"
echo "==> Archivos"
gpg --quiet --decrypt "$RESPALDO/archivos.tar.gz.gpg" | tar -C "$DESTINO/archivos" -xzf -
for f in "$RESPALDO"/*.dump.gpg; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .gpg)"
    echo "==> Base ${base%.dump}"
    gpg --quiet --decrypt --output "$DESTINO/$base" "$f"
done
echo "Restaurado en $DESTINO. Instrucciones para cargarlo: ver la cabecera de este script."
