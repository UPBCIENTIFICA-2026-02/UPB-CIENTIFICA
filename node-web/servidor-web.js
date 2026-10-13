// servidor-web.js — artefacto «executable» de la VM node-web.
// Servidor web JavaScript de UPB-CIENTIFICA.
//
// Dos responsabilidades, y ninguna más:
//   1. Entregar la interfaz web (spa-ui.js, del repositorio FrontWebUPBCientifica).
//   2. Ser la pasarela de esa interfaz hacia los servicios: el navegador no
//      habla SOAP, RMI ni gRPC, y llamar a cada VM por separado chocaría con
//      CORS. Contrato: FrontWebUPBCientifica/docs/PASARELA.md.
//
// No almacena datos, no valida credenciales por su cuenta y no decide permisos:
// el token viaja intacto a cada servicio, que es quien lo valida.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import morgan from 'morgan';
import { config, resumenConfig } from './src/config.js';
import { reenviar } from './src/pasarela.js';
import { rutas } from './src/rutas.js';
import { cabecerasSeguridad, bloquearOcultos } from './src/seguridad.js';
import { crearMetricas } from './src/metricas.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // Nginx, en la misma VM, pone X-Forwarded-*

// Análisis de vulnerabilidades (G2): nada oculto (.git, .env...) sale por aquí,
// y todas las respuestas llevan CSP, anti-clickjacking y nosniff. Ver src/seguridad.js.
app.use(bloquearOcultos);

// Monitoreo (M1): GET /metrics para Prometheus (ver src/metricas.js).
const metricas = crearMetricas('node-web');
app.use(metricas.middleware);
app.get('/metrics', metricas.endpoint);
app.use(cabecerasSeguridad(config.dirInterfaz));

// El <video> manda el token en la URL (?access_token=...), porque no puede
// poner cabeceras. Que no quede escrito en el registro de accesos.
morgan.token('url-segura', (req) =>
  req.originalUrl.replace(/([?&]access_token=)[^&]*/gi, '$1[oculto]'));
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url-segura HTTP/:http-version" ' +
  ':status :res[content-length] ":referrer" ":user-agent"'));

// --- Pasarela: reenvío 1 a 1 (PASARELA.md, sección 2) -----------------------
// ANTES de express.json(): el cuerpo tiene que llegar intacto al servicio. Las
// subidas de archivos son multipart y pueden pesar cientos de MB.
app.use('/api/storage',     reenviar(config.nodos.archivos, '/storage',   'Storage (node-repository)'));
app.use('/api/album',       reenviar(config.nodos.medios,   '/album',     'Photo Album (node-media)'));
app.use('/api/streaming',   reenviar(config.nodos.medios,   '/streaming', 'Streaming (node-media)'));
app.use('/api/jobs',        reenviar(config.nodos.trabajos, '/jobs',      'HPC (job-api)'));
app.use('/api/cluster',     reenviar(config.nodos.trabajos, '/cluster',   'HPC (job-api)'));
app.use('/api/shared-file', reenviar(config.nodos.compartidos, '/shared-file', 'Shared File (node-repository)'));

// Monitoreo (M1): Grafana bajo el mismo origen que el portal (/monitoreo/), así el
// enlace "Monitoreo" del front no necesita la IP de node-monitoreo. Grafana se
// configura con serve_from_sub_path y pone sus propias cabeceras de seguridad.
app.use('/monitoreo', reenviar(config.nodos.monitoreo, '/monitoreo', 'Monitoreo (Grafana)'));

// --- Lo que node-web traduce: inicio y cierre de sesión por SOAP -------------
app.use('/api', express.json({ limit: '1mb' }), rutas);
app.use('/api', (req, res) =>
  res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: `La pasarela no tiene la ruta ${req.method} ${req.originalUrl}.` }));

// --- Sonda de vida: la usan el indicador de conexión del front y el monitoreo
app.get('/salud', (req, res) => {
  res.json({ estado: 'arriba', servicio: 'node-web', version: process.env.npm_package_version || '0.2.0', ...resumenConfig() });
});

// --- Interfaz web --------------------------------------------------------------
// El front usa rutas con # (#/inicio, #/archivos), así que no hace falta
// devolver index.html para rutas desconocidas.
if (!existsSync(join(config.dirInterfaz, 'index.html'))) {
  console.warn(`AVISO: no hay index.html en ${config.dirInterfaz}.`);
  console.warn('       Copia el front con  npm run interfaz  o define DIR_INTERFAZ.');
}
app.use(express.static(config.dirInterfaz, { dotfiles: 'ignore' }));

app.use((req, res) => res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada' }));

const servidor = app.listen(config.puerto, config.interfaz, () => {
  console.log(`node-web escuchando en http://${config.interfaz}:${config.puerto}`);
  console.log(`Interfaz: ${config.dirInterfaz}`);
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
