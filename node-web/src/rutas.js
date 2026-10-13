// Rutas que node-web TRADUCE (todo lo demás lo reenvía la pasarela).
//
// Contrato: FrontWebUPBCientifica/docs/PASARELA.md, sección 1.
//
//   POST   /api/sesion   { usuario, contrasena, origenCliente }  ->  SOAP login
//   DELETE /api/sesion   (Authorization)                         ->  SOAP logout
//
// Antes este archivo tenía una API propia (/api/archivos, /api/trabajos,
// /api/videos...) con adaptadores que reescribían las respuestas de cada
// servicio. El front web nuevo habla directamente con los contratos de los
// servicios a través de la pasarela, así que esa capa se quitó.

import { Router } from 'express';
import { login, logout } from './identidad.js';
import { bloqueado, registrarFallo, registrarExito } from './limiteIntentos.js';

export const rutas = Router();

function tokenDe(req) {
  const cabecera = req.get('Authorization') || '';
  return cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
}

rutas.post('/sesion', async (req, res) => {
  const { usuario, contrasena, clave, origenCliente, codigoMfa } = req.body || {};
  // `clave` se acepta también: es el nombre que usaba la API anterior y el que
  // aparece en los ejemplos de la guía del clúster local.
  const secreto = contrasena ?? clave;

  if (!usuario || !secreto) {
    return res.status(400).json({ error: 'SOLICITUD_INVALIDA', mensaje: 'Escribe usuario y contraseña.' });
  }

  // Freno a la fuerza bruta (G2): ver limiteIntentos.js.
  const espera = bloqueado(req.ip, usuario);
  if (espera > 0) {
    res.set('Retry-After', String(espera));
    return res.status(429).json({
      error: 'DEMASIADOS_INTENTOS',
      mensaje: `Demasiados intentos fallidos. Vuelve a intentarlo en ${Math.ceil(espera / 60)} min.`,
    });
  }

  try {
    const sesion = await login(usuario, secreto, origenCliente || 'web', codigoMfa);
    registrarExito(req.ip, usuario);
    res.json(sesion);
  } catch (e) {
    const estado = e.codigo || 503;
    if (estado === 401) registrarFallo(req.ip, usuario);
    res.status(estado).json({
      error: estado === 401 ? 'CREDENCIALES_INVALIDAS' : 'AUTH_NO_DISPONIBLE',
      mensaje: e.message
    });
  }
});

rutas.delete('/sesion', async (req, res) => {
  await logout(tokenDe(req));
  res.status(204).end();
});
