#!/usr/bin/env bash
# generar-llaves-respaldo.sh — Crea el par de llaves GPG de los respaldos (RF-11).
#
# SE EJECUTA EN LA MÁQUINA DEL CUSTODIO, NUNCA en node-repository: la llave
# privada no debe existir en el servidor de datos (criterio de verificación de
# RF-11). Al servidor solo se le copia la pública (upbc-respaldo.pub).
#
#   ./generar-llaves-respaldo.sh [carpeta-salida]
#
# Deja en la carpeta de salida (por defecto ./llaves-respaldo):
#   upbc-respaldo.pub          -> copiar a node-repository:/etc/upbc/upbc-respaldo.pub
#   upbc-respaldo.privada.asc  -> GUARDAR FUERA DE LÍNEA (USB cifrada, caja
#                                 fuerte, gestor de contraseñas del equipo).
#                                 Sin ella NINGÚN respaldo se puede restaurar.
#   revocacion.asc             -> certificado para revocar la llave si se pierde
#                                 o se filtra la privada.
#
# La llave privada queda protegida con una frase de paso que gpg pide al crearla.
set -euo pipefail

SALIDA="${1:-./llaves-respaldo}"
NOMBRE="UPB-CIENTIFICA Respaldo"
CORREO="respaldo@upb-cientifica.local"
VIGENCIA="${VIGENCIA:-2y}"     # caduca a los 2 años: obliga a rotarla

mkdir -p "$SALIDA"; chmod 700 "$SALIDA"
# Anillo propio y aislado para no mezclar con las llaves personales del custodio.
export GNUPGHOME="$SALIDA/anillo"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"

if gpg --list-secret-keys "$CORREO" >/dev/null 2>&1; then
    echo "Ya existe una llave de respaldo en $GNUPGHOME. Bórrala a mano si quieres otra."
    exit 1
fi

echo "==> Generando RSA 4096 (firma) + RSA 4096 (cifrado), vigencia $VIGENCIA."
echo "    gpg pedirá una FRASE DE PASO para proteger la llave privada."
gpg --quick-generate-key "$NOMBRE <$CORREO>" rsa4096 sign "$VIGENCIA"
huella="$(gpg --with-colons --list-keys "$CORREO" | awk -F: '/^fpr:/ {print $10; exit}')"
gpg --quick-add-key "$huella" rsa4096 encr "$VIGENCIA"

gpg --armor --export "$huella" > "$SALIDA/upbc-respaldo.pub"
gpg --armor --export-secret-keys "$huella" > "$SALIDA/upbc-respaldo.privada.asc"
cp "$GNUPGHOME/openpgp-revocs.d/$huella.rev" "$SALIDA/revocacion.asc"
chmod 600 "$SALIDA"/*.asc

cat <<EOF

Listo. Huella: $huella

  1. Copia SOLO la pública al servidor:
       scp $SALIDA/upbc-respaldo.pub <admin>@node-repository:/tmp/
       (en la VM) sudo install -m 644 /tmp/upbc-respaldo.pub /etc/upbc/upbc-respaldo.pub
  2. Guarda upbc-respaldo.privada.asc y revocacion.asc FUERA DE LÍNEA y borra
     la carpeta $SALIDA de este equipo cuando lo hayas hecho.
  3. Recuerda la frase de paso: sin ella la llave privada no sirve.
EOF
