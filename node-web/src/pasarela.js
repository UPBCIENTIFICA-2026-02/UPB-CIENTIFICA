// Pasarela del cliente web: reenvío 1 a 1 hacia cada servicio.
//
// Contrato: FrontWebUPBCientifica/docs/PASARELA.md, sección 2.
//
//   /api/storage/**    ->  node-repository  /storage/**
//   /api/album/**      ->  node-media       /album/**
//   /api/streaming/**  ->  node-media       /streaming/**
//   /api/jobs/**       ->  job-api          /jobs/**
//   /api/cluster/**    ->  job-api          /cluster/**
//
// Mismo método, misma ruta sin /api, mismo cuerpo, misma cabecera Authorization.
// node-web NO interpreta nada: ni valida el token (lo hace cada servicio), ni
// conoce los DTO. Así, si un servicio cambia un campo, la pasarela no se entera.
//
// Por qué no se usa la librería http-proxy: son 100 líneas sin dependencias, y
// así se ve exactamente qué cabeceras pasan y cuáles no.

import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';

// Cabeceras que describen la conexión de UN tramo (navegador–node-web o
// node-web–servicio) y no deben pasar al otro. RFC 9110, sección 7.6.1.
const DE_TRAMO = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'
]);

function filtrar(cabeceras) {
  const salida = {};
  for (const [nombre, valor] of Object.entries(cabeceras)) {
    if (!DE_TRAMO.has(nombre.toLowerCase())) salida[nombre] = valor;
  }
  return salida;
}

function responderError(res, estado, error, mensaje) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error, mensaje }));
}

/**
 * Middleware que reenvía todo lo montado bajo él.
 *
 * @param base     URL del servicio, p. ej. "http://node-repository:8084"
 * @param prefijo  prefijo de ruta en el servicio, p. ej. "/storage"
 * @param nombre   nombre legible para los mensajes de error
 */
export function reenviar(base, prefijo, nombre) {
  const origen = new URL(base);
  const cliente = origen.protocol === 'https:' ? https : http;

  return (req, res) => {
    // Montado con app.use('/api/storage', ...), Express deja en req.url lo que
    // viene DESPUÉS del montaje: "/directorios/root?x=1".
    const entrada = new URL(req.url, 'http://x');
    const cabeceras = filtrar(req.headers);

    /*
     * Token en la URL (solo lo usa el <video>).
     *
     * Un <video> no puede poner la cabecera Authorization, así que el front
     * manda ?access_token=... Se pasa a cabecera y se QUITA de la URL antes de
     * reenviar: si no, el token acabaría en los registros de acceso del
     * servicio. Se aplica a cualquier ruta, no solo al video, para que un
     * token en la URL nunca salga de aquí.
     */
    const tokenEnUrl = entrada.searchParams.get('access_token');
    if (tokenEnUrl !== null) {
      entrada.searchParams.delete('access_token');
      if (!cabeceras.authorization && tokenEnUrl) {
        cabeceras.authorization = `Bearer ${tokenEnUrl}`;
      }
    }

    /*
     * "/" tras el montaje significa la raíz del recurso: /api/jobs -> /jobs.
     * No se añade la barra final: Spring 6 (job-api) dejó de tratar "/jobs/"
     * igual que "/jobs" y respondería 404.
     */
    const ruta = entrada.pathname === '/' ? '' : entrada.pathname;
    const destino = new URL(prefijo + ruta + entrada.search, origen);

    cabeceras.host = destino.host;
    cabeceras['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress]
      .filter(Boolean).join(', ');
    cabeceras['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || req.protocol;
    cabeceras['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host;

    const salida = cliente.request(destino, { method: req.method, headers: cabeceras }, (r) => {
      // Estado y cuerpo del servicio TAL CUAL, incluidos los errores: el front
      // muestra el { error, mensaje } de cada servicio, que es el que mejor
      // explica qué pasó. Range, Content-Range, Accept-Ranges,
      // Content-Disposition y Content-Length pasan sin tocarse.
      res.writeHead(r.statusCode, filtrar(r.headers));
      r.pipe(res);
    });

    // Inactividad, no duración total: una descarga larga mientras fluyan datos
    // no se corta.
    salida.setTimeout(config.inactividadPasarelaMs, () => {
      salida.destroy(new Error('INACTIVIDAD'));
    });

    salida.on('error', (e) => {
      if (e.message === 'INACTIVIDAD') {
        responderError(res, 504, 'SERVICIO_LENTO', `${nombre} tardó demasiado en responder.`);
      } else {
        // ECONNREFUSED, ENOTFOUND, EHOSTUNREACH...: el servicio no está.
        responderError(res, 502, 'SERVICIO_NO_DISPONIBLE',
          `No hay respuesta de ${nombre} (${origen.host}). Revisa que esté encendido.`);
      }
    });

    // Si el navegador abandona (cierra la pestaña, salta en el video), no tiene
    // sentido seguir pidiéndole bytes al servicio.
    res.on('close', () => {
      if (!res.writableFinished) salida.destroy();
    });

    // El cuerpo pasa como flujo, sin parsearlo: las subidas son multipart y
    // pueden pesar cientos de MB. Por eso la pasarela se monta ANTES de
    // express.json().
    req.pipe(salida);
  };
}

/** Para servicios que todavía no existen: respuesta clara en vez de un 404. */
export function noDisponible(nombre) {
  return (_req, res) =>
    responderError(res, 501, 'NO_IMPLEMENTADO', `${nombre} todavía no existe en el backend.`);
}
