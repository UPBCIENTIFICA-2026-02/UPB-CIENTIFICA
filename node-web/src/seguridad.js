// seguridad.js — Cabeceras de seguridad y bloqueo de archivos ocultos (G2).
//
// Hallazgos del análisis de vulnerabilidades (docs/seguridad/analisis-vulnerabilidades.md):
//   - ZAP: "Content Security Policy (CSP) Header Not Set", "Missing
//     Anti-clickjacking Header", "X-Content-Type-Options Header Missing".
//     Nginx pone algunas en producción, pero no CSP, y en desarrollo no hay
//     Nginx. Se ponen aquí para que valgan en los dos casos.
//   - ZAP: "Hidden File Found" -> /.git/config se servía. Cuando node-web sirve
//     el front directamente desde el repositorio FrontWebUPBCientifica (lo hace
//     el script 7), la carpeta .git iba con él: cualquiera podía bajarse el
//     repositorio entero, con su historial.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hash SHA-256 de cada <script> en línea de index.html. La CSP los autoriza
 * uno por uno en vez de abrir 'unsafe-inline' a cualquier script.
 */
function hashesScriptsEnLinea(dirInterfaz) {
  const ruta = join(dirInterfaz, 'index.html');
  if (!existsSync(ruta)) return [];
  const html = readFileSync(ruta, 'utf8');
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(([, cuerpo]) => `'sha256-${createHash('sha256').update(cuerpo).digest('base64')}'`);
}

/**
 * CSP del portal. Todo es local: ni CDNs ni fuentes externas.
 *  - style-src 'unsafe-inline': la interfaz usa atributos style="..." (no
 *    ejecutan código; es el riesgo que se asume, ver el informe).
 *  - img-src/media-src blob:: las miniaturas y las fotos se piden con el token
 *    y se muestran como blob.
 *  - frame-ancestors 'none': nadie puede meter el portal en un iframe
 *    (clickjacking), lo mismo que X-Frame-Options: DENY.
 */
export function politicaContenido(dirInterfaz) {
  const scripts = ["'self'", ...hashesScriptsEnLinea(dirInterfaz)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function cabecerasSeguridad(dirInterfaz) {
  const csp = politicaContenido(dirInterfaz);
  return (req, res, siguiente) => {
    // Grafana (/monitoreo/) es otra aplicación con su propia CSP: la del portal
    // la rompería (scripts en línea que el portal no tiene).
    if (req.path.startsWith('/monitoreo')) return siguiente();
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    siguiente();
  };
}

/** 404 para cualquier ruta con un segmento oculto (.git, .env, .vscode...). */
export function bloquearOcultos(req, res, siguiente) {
  const ruta = decodeURIComponent(req.path);
  if (ruta.split('/').some((s) => s.startsWith('.') && s !== '.well-known')) {
    return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada' });
  }
  siguiente();
}
