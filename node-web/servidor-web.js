// servidor-web.js — artefacto «executable» de la VM node-web.
// Servidor web JavaScript de UPB-CIENTIFICA.
//
// Dos responsabilidades, y ninguna más:
//   1. Entregar la interfaz (spa-ui.js) al navegador.
//   2. Exponer la API que esa interfaz consume, delegando en los demás nodos.
//
// No almacena datos, no valida credenciales por su cuenta y no decide permisos.

import express from 'express';
import morgan from 'morgan';
import { join } from 'node:path';
import { config, resumenConfig } from './src/config.js';
import { rutas } from './src/rutas.js';

const app = express();

app.disable('x-powered-by');
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// Interfaz del portal: entrega index.html y spa-ui.js al navegador.
app.use(express.static(join(config.raiz, 'public')));

// API del portal.
app.use('/api', rutas);

// Sonda de vida para el módulo de monitoreo.
app.get('/salud', (req, res) => {
  res.json({ estado: 'arriba', servicio: 'node-web', version: process.env.npm_package_version || '0.1.0', ...resumenConfig() });
});

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const servidor = app.listen(config.puerto, config.interfaz, () => {
  console.log(`node-web escuchando en http://${config.interfaz}:${config.puerto}`);
  console.log('Servicios configurados:');
  for (const [nombre, url] of Object.entries(config.nodos)) console.log(`  ${nombre.padEnd(10)} ${url}`);
});

// Cierre ordenado: systemd envía SIGTERM al reiniciar el servicio.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    console.log(`${senal} recibida, cerrando conexiones`);
    servidor.close(() => process.exit(0));
  });
}
