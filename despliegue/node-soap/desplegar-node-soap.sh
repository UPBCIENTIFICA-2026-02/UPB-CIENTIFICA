#!/usr/bin/env bash
# Despliega Authentication Service (node-soap) en SU VM: copia el servicio
# SOAP a Apache y carga el directorio (usuarios, grupos y mapa de servicios).
#
# Se ejecuta DENTRO de la VM node-soap, como root, desde la raíz del monorepo
# (o con RAIZ=<ruta del monorepo>):
#
#   sudo ./despliegue/node-soap/desplegar-node-soap.sh
#
# Supone lo que ya tiene la VM del equipo: OpenLDAP con la base
# dc=upb-cientifica,dc=local y LDAPS, Apache con PHP, y
# /etc/apache2/soap-config.php (plantilla: node-soap/back/soap-config.php.example).
#
# Pide la contraseña del administrador de LDAP (cn=admin) y una contraseña
# para cada usuario de prueba. No guarda ninguna.
set -euo pipefail

RAIZ="${RAIZ:-$(cd "$(dirname "$0")/../.." && pwd)}"
DESTINO="${DESTINO:-/var/www/html/soap}"
ADMIN_DN="${ADMIN_DN:-cn=admin,dc=upb-cientifica,dc=local}"
LDAP_URI="${LDAP_URI:-ldapi:///}"

paso() { printf '\n==> %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root (sudo)."; exit 1; }

paso "Dependencias (php-soap, php-ldap, ldap-utils)"
apt-get install -y -q php-soap php-ldap ldap-utils slapd >/dev/null
php -m | grep -qi '^soap$' && php -m | grep -qi '^ldap$' || { echo "Faltan las extensiones soap/ldap de PHP"; exit 1; }

paso "Servicio SOAP -> $DESTINO"
# user.php, sesion.php (nuevo: sin él user.php no arranca), mfa.php y los WSDL.
install -d -o root -g www-data -m 755 "$DESTINO"
install -o root -g www-data -m 644 "$RAIZ"/node-soap/back/{user.php,sesion.php,mfa.php,users.wsdl,mfa.wsdl} "$DESTINO"/
[ -f /etc/apache2/soap-config.php ] || {
  echo "Falta /etc/apache2/soap-config.php. Cópialo de node-soap/back/soap-config.php.example y rellénalo."
  exit 1
}
# El WSDL cambió (homeDirectory): PHP cachea los WSDL y seguiría sirviendo el viejo.
rm -f /tmp/wsdl-* 2>/dev/null || true

paso "Directorio: usuarios, grupos y mapa de servicios"
ldif="$(mktemp)"
trap 'rm -f "$ldif"' EXIT
cp "$RAIZ/despliegue/node-soap/directorio.ldif" "$ldif"
for uid in user1 investigador estudiante; do
  read -r -s -p "Contraseña para $uid: " clave; echo
  hash="$(slappasswd -s "$clave")"
  # | como separador: el hash {SSHA} puede contener /.
  sed -i "s|@CLAVE_${uid}@|${hash}|" "$ldif"
done
# -c: las entradas que ya existen se saltan (sus datos NO se tocan).
ldapadd -c -x -H "$LDAP_URI" -D "$ADMIN_DN" -W -f "$ldif" || true

paso "Apache"
systemctl reload apache2

paso "Comprobación"
url="https://localhost:8081/soap/user.php"
cuerpo='<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns:validarAccesoServicio xmlns:ns="http://192.168.1.195/soap"><usuario>estudiante</usuario><servicio>hpc</servicio></ns:validarAccesoServicio></soap:Body></soap:Envelope>'
curl -sk -H 'Content-Type: text/xml' -H 'SOAPAction: http://192.168.1.195/soap/validarAccesoServicio' \
  --data "$cuerpo" "$url" | grep -o '<message>[^<]*' || echo "No respondió $url (revisa el VirtualHost de Apache)."
echo "Debe decir: Acceso DENEGADO al servicio hpc para el perfil estudiantes"
