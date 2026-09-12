// Configuración de node-web.
//
// El mapa de servicios se lee del archivo rutas-servicio.json (artefacto del
// diagrama de despliegue). Las variables de entorno permiten sobreescribir
// cada URL sin editar el archivo, para que la misma copia del código sirva
// en la VM del CCA y en el equipo de desarrollo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapa = JSON.parse(readFileSync(join(raiz, 'rutas-servicio.json'), 'utf8'));

const env = process.env;

function url(nombre) {
  return env['URL_' + nombre.toUpperCase()] || mapa.servicios[nombre].url;
}

export const config = {
  raiz,

  // El proceso escucha en localhost; Nginx termina TLS y publica el :443
  // hacia los clientes, tal como aparece en el diagrama de despliegue.
  puerto: Number(env.PORT || 8080),
  interfaz: env.BIND || '127.0.0.1',

  nodos: {
    identidad: url('identidad'),
    archivos: url('archivos'),
    medios: url('medios'),
    trabajos: url('trabajos'),
    monitoreo: url('monitoreo')
  },

  timeoutMs: Number(env.TIMEOUT_MS || mapa.timeoutMs || 5000)
};

export function resumenConfig() {
  return { puerto: config.puerto, nodos: config.nodos, timeoutMs: config.timeoutMs };
}
