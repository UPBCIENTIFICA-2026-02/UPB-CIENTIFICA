// Pruebas unitarias del freno a la fuerza bruta (G2). Se pasa `ahora` a mano
// para no esperar 15 minutos reales.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloqueado, registrarFallo, registrarExito } from '../src/limiteIntentos.js';

// El módulo guarda los contadores en memoria: cada prueba usa su propia IP.
let n = 0;
const ipNueva = () => `10.99.0.${++n}`;
const T0 = 1_000_000_000_000;
const MIN = 60_000;

test('4 fallos no bloquean; el 5.º bloquea al mismo usuario desde la misma IP', () => {
  const ip = ipNueva();
  for (let i = 0; i < 4; i++) registrarFallo(ip, 'ana', T0 + i);
  assert.equal(bloqueado(ip, 'ana', T0 + 10), 0);
  registrarFallo(ip, 'ana', T0 + 5);
  assert.ok(bloqueado(ip, 'ana', T0 + 10) > 0);
});

test('el bloqueo dura 15 minutos desde el primer fallo de la ventana', () => {
  const ip = ipNueva();
  for (let i = 0; i < 5; i++) registrarFallo(ip, 'ana', T0);
  assert.equal(bloqueado(ip, 'ana', T0 + MIN), 14 * 60);
  assert.equal(bloqueado(ip, 'ana', T0 + 15 * MIN), 0);
});

test('el usuario no distingue mayúsculas', () => {
  const ip = ipNueva();
  for (let i = 0; i < 5; i++) registrarFallo(ip, 'Ana', T0);
  assert.ok(bloqueado(ip, 'ana', T0) > 0);
});

test('otro usuario desde la misma IP no queda bloqueado por los fallos de ana', () => {
  const ip = ipNueva();
  for (let i = 0; i < 5; i++) registrarFallo(ip, 'ana', T0);
  assert.equal(bloqueado(ip, 'beto', T0), 0);
});

test('el mismo usuario desde otra IP no queda bloqueado', () => {
  const ip = ipNueva();
  for (let i = 0; i < 5; i++) registrarFallo(ip, 'ana', T0);
  assert.equal(bloqueado(ipNueva(), 'ana', T0), 0);
});

test('20 fallos desde una IP, con usuarios distintos, bloquean la IP', () => {
  const ip = ipNueva();
  for (let i = 0; i < 20; i++) registrarFallo(ip, `usuario${i}`, T0);
  assert.ok(bloqueado(ip, 'cualquiera', T0) > 0);
});

test('un inicio correcto limpia el contador de ese usuario', () => {
  const ip = ipNueva();
  for (let i = 0; i < 4; i++) registrarFallo(ip, 'ana', T0);
  registrarExito(ip, 'ana');
  registrarFallo(ip, 'ana', T0 + 1);
  assert.equal(bloqueado(ip, 'ana', T0 + 2), 0);
});

test('los fallos fuera de la ventana de 15 min no cuentan', () => {
  const ip = ipNueva();
  for (let i = 0; i < 4; i++) registrarFallo(ip, 'ana', T0);
  registrarFallo(ip, 'ana', T0 + 16 * MIN);
  assert.equal(bloqueado(ip, 'ana', T0 + 16 * MIN), 0);
});
