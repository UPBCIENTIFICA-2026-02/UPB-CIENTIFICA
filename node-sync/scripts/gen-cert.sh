#!/usr/bin/env bash
# Genera un certificado TLS autofirmado para desarrollo/pruebas.
# En produccion use un certificado emitido por la CA interna del CCA.
set -e
OUT="${1:-certs}"
mkdir -p "$OUT"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT/server.key" -out "$OUT/server.crt" -days 365 \
  -subj "/CN=node-sync.upbcientifica.local" \
  -addext "subjectAltName=DNS:localhost,DNS:node-sync.upbcientifica.local,IP:127.0.0.1"
echo "Generados: $OUT/server.crt  y  $OUT/server.key"
