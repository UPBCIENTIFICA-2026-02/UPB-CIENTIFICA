#!/usr/bin/env bash
# instalar.sh — provisiona la VM node-web de UPB-CIENTIFICA.
# Debian 12 limpio. Ejecutar como root:  sudo bash despliegue/instalar.sh
#
# Sin contenedores y sin servicios en la nube, tal como exige el enunciado:
# todo queda instalado de forma nativa sobre el sistema operativo.

set -euo pipefail

DESTINO=/opt/upbc-node-web
USUARIO=upbcweb
NODE_MAYOR=20

echo "==> 1/6 Paquetes base"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx

echo "==> 2/6 Node.js ${NODE_MAYOR} LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAYOR}* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAYOR}.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> 3/6 Usuario de servicio"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home "$DESTINO" "$USUARIO"

echo "==> 4/6 Copia de la aplicacion en $DESTINO"
mkdir -p "$DESTINO" /var/log/upbc /etc/upbc
cp -r servidor-web.js src public rutas-servicio.json package.json package-lock.json "$DESTINO"/
cd "$DESTINO"
npm ci --omit=dev
chown -R "$USUARIO":"$USUARIO" "$DESTINO" /var/log/upbc
cd - >/dev/null

echo "==> 5/6 Configuracion"
if [[ ! -f /etc/upbc/node-web.env ]]; then
  cp despliegue/node-web.env.example /etc/upbc/node-web.env
  chmod 640 /etc/upbc/node-web.env
  chown root:"$USUARIO" /etc/upbc/node-web.env
  echo "    Revisa /etc/upbc/node-web.env: las IP de los demas nodos son de ejemplo."
fi

# Certificado autofirmado para poder levantar TLS hoy. En produccion se
# reemplaza por el certificado que entregue el CCA.
if [[ ! -f /etc/ssl/upbc/node-web.crt ]]; then
  mkdir -p /etc/ssl/upbc
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/upbc/node-web.key \
    -out /etc/ssl/upbc/node-web.crt \
    -subj "/C=CO/ST=Santander/L=Bucaramanga/O=UPB-CIENTIFICA/CN=node-web.cca.upb.edu.co" 2>/dev/null
  chmod 600 /etc/ssl/upbc/node-web.key
fi

echo "==> 6/6 Servicios"
cp despliegue/node-web.service /etc/systemd/system/
cp despliegue/nginx-node-web.conf /etc/nginx/sites-available/node-web
ln -sf /etc/nginx/sites-available/node-web /etc/nginx/sites-enabled/node-web
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now node-web
nginx -t && systemctl reload nginx

sleep 2
echo
echo "Estado del servicio:"
systemctl --no-pager --lines=0 status node-web || true
echo
echo "Comprobacion local:"
curl -s http://127.0.0.1:8080/salud || echo "  el servidor aun no responde, revisa: journalctl -u node-web -n 50"
echo
echo "Listo. El portal queda publicado en https://<ip-de-esta-vm>/"
