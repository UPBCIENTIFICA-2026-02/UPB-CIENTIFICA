// API del portal: la superficie que consume la interfaz del navegador.
//
// Aquí no hay lógica de negocio. Cada ruta valida la entrada, llama a un
// adaptador de servicios.js y traduce el error a algo que una persona pueda
// leer en pantalla.

import { Router } from 'express';
import { iniciarSesion, exigirSesion } from './identidad.js';
import * as svc from './servicios.js';

export const rutas = Router();

// Contexto que se pasa a los adaptadores: el token se reenvía a cada servicio.
function contexto(req) {
  const cabecera = req.get('Authorization') || '';
  return { token: cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null, sesion: req.sesion };
}

function ruta(manejador) {
  return async (req, res) => {
    try {
      await manejador(req, res);
    } catch (e) {
      res.status(e.codigo || 503).json({ error: e.message });
    }
  };
}

// ----------------------------------------------------------------- Identidad
rutas.post('/sesion', ruta(async (req, res) => {
  const { usuario, clave, codigoMfa } = req.body || {};
  if (!usuario || !clave) return res.status(400).json({ error: 'Escribe usuario y clave.' });
  res.json(await iniciarSesion(usuario, clave, codigoMfa));
}));

rutas.get('/sesion', exigirSesion, (req, res) => res.json(req.sesion));

// --------------------------------------------------------------- Shared File
rutas.get('/archivos', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.listarArchivos(contexto(req), req.query.directorio || 'root'));
}));

rutas.get('/archivos/:id/descarga', exigirSesion, ruta(async (req, res) => {
  res.json({ url: svc.urlDescarga(req.params.id) });
}));

rutas.post('/archivos/compartir', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.compartirArchivo(contexto(req), req.body));
}));

// --------------------------------------------------------------- Photo Album
rutas.get('/album', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.listarAlbum(contexto(req), req.query.orden));
}));

// ----------------------------------------------------------------- Streaming
rutas.get('/videos', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.listarVideos(contexto(req)));
}));

// ------------------------------------------------------------------ MPI Jobs
rutas.get('/trabajos', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.listarTrabajos(contexto(req)));
}));

rutas.post('/trabajos', exigirSesion, ruta(async (req, res) => {
  const { nombre, comando, prioridad } = req.body || {};
  if (!nombre || !comando) {
    return res.status(400).json({ error: 'El trabajo necesita un nombre y un comando.' });
  }
  res.status(201).json(await svc.enviarTrabajo(contexto(req), { nombre, comando, prioridad }));
}));

rutas.delete('/trabajos/:id', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.cancelarTrabajo(contexto(req), req.params.id));
}));

// ----------------------------------------------------------------- Monitoreo
rutas.get('/monitoreo', exigirSesion, ruta(async (req, res) => {
  res.json(await svc.estadoInfraestructura(contexto(req)));
}));
