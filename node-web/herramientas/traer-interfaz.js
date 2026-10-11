#!/usr/bin/env node
// traer-interfaz.js — copia el front web (FrontWebUPBCientifica) a public/.
//
//   npm run interfaz
//   RUTA_FRONT=D:\otro\FrontWebUPBCientifica npm run interfaz
//
// ¿Por qué copiar? El front vive en su propio repositorio, pero instalar.sh
// despliega la carpeta public/ de node-web en la VM. Copiarlo aquí deja el
// despliegue igual que antes y fija QUÉ versión del front va con este node-web
// (queda anotada en public/ORIGEN.txt).
//
// En desarrollo no hace falta copiar: arranca node-web con
// DIR_INTERFAZ=<ruta del front> y verás los cambios al recargar.
//
// Solo se copian los archivos que el navegador necesita (README del front,
// sección "Desplegar"): index.html, spa-ui.js, estilos/ y src/.

import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizNodeWeb = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Por defecto, el front clonado al lado del monorepo:
//   GitHub/UPB-CIENTIFICA/node-web  ->  GitHub/FrontWebUPBCientifica
const front = resolve(process.env.RUTA_FRONT || join(raizNodeWeb, '..', '..', 'FrontWebUPBCientifica'));
const destino = join(raizNodeWeb, 'public');
const ELEMENTOS = ['index.html', 'spa-ui.js', 'estilos', 'src'];

const faltan = ELEMENTOS.filter((e) => !existsSync(join(front, e)));
if (faltan.length) {
  console.error(`No encuentro el front en ${front} (faltan: ${faltan.join(', ')}).`);
  console.error('Indica dónde está con RUTA_FRONT=<ruta> npm run interfaz');
  process.exit(1);
}

// Se vacía public/ entera: si el front borró un archivo, no debe quedarse aquí.
rmSync(destino, { recursive: true, force: true });
for (const e of ELEMENTOS) cpSync(join(front, e), join(destino, e), { recursive: true });

let version = 'desconocida (el front no es un repositorio git)';
try {
  const commit = execFileSync('git', ['-C', front, 'log', '-1', '--format=%h %s (%ci)'], { encoding: 'utf8' }).trim();
  const sucio = execFileSync('git', ['-C', front, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  version = commit + (sucio ? '  + cambios sin commitear' : '');
} catch { /* sin git: se deja "desconocida" */ }

writeFileSync(join(destino, 'ORIGEN.txt'), [
  'Copia del front web generada por node-web/herramientas/traer-interfaz.js.',
  'NO editar aquí: los cambios se hacen en el repositorio del front y se vuelve a copiar.',
  '',
  `Origen:  ${front}`,
  `Commit:  ${version}`,
  `Copiado: ${new Date().toISOString()}`,
  ''
].join('\n'));

const total = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? total(join(dir, e.name)) : 1), 0);

console.log(`Front copiado a ${destino}`);
console.log(`  ${total(destino) - 1} archivos  ·  commit ${version}`);
