// Adaptadores hacia los demás nodos del sistema.
//
// Cada función encapsula UNA llamada a UN servicio y traduce su respuesta al
// formato que consume la interfaz. Aquí es donde se absorben las diferencias
// entre lo que cada frente construyó: si node-rmi renombra un campo, se
// cambia una línea de este archivo y ni las rutas ni la interfaz se enteran.
//
// El token del usuario se reenvía a cada servicio: son ellos quienes aplican
// permisos y cuota, no node-web.

import { config } from './config.js';

async function pedir(url, ctx, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(url, {
      ...opciones,
      headers: {
        ...(ctx?.token ? { Authorization: 'Bearer ' + ctx.token } : {}),
        ...opciones.headers
      },
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch {
    throw new Error(`sin respuesta de ${new URL(url).host}`);
  }
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new Error('el servicio rechazó tus credenciales');
  }
  if (!respuesta.ok) throw new Error(`${new URL(url).host} respondió ${respuesta.status}`);
  return respuesta.status === 204 ? null : respuesta.json();
}

const aMb = bytes => Math.round((Number(bytes) || 0) / (1024 * 1024));

// ------------------------------------------------------- Shared File (8084)
// node-repository expone /storage con identificadores de nodo, no rutas.
export async function listarArchivos(ctx, directorio = 'root') {
  const base = config.nodos.archivos;
  const [entradas, cuota] = await Promise.all([
    pedir(new URL(`/storage/directorios/${directorio}`, base), ctx),
    pedir(new URL('/storage/cuota', base), ctx)
  ]);

  return {
    directorio,
    cuotaMb: aMb(cuota.cuota),
    usadoMb: aMb(cuota.usados),
    entradas: entradas.map(e => ({
      id: e.id,
      nombre: e.nombre,
      tipo: e.tipo,
      tamanoMb: e.tipo === 'archivo' ? aMb(e.tamanoBytes) : null,
      version: e.version
    }))
  };
}

export function urlDescarga(id) {
  return new URL(`/storage/archivos/${id}/descargar`, config.nodos.archivos).toString();
}

// PENDIENTE: node-repository todavía no expone compartición entre usuarios.
export async function compartirArchivo() {
  const e = new Error('Compartir archivos aún no está disponible en el servicio de almacenamiento.');
  e.codigo = 501;
  throw e;
}

// ------------------------------------------------- Álbum y streaming (8083)
export function listarAlbum(ctx, orden = 'fecha') {
  const u = new URL('/album', config.nodos.medios);
  u.searchParams.set('orden', orden);
  return pedir(u, ctx);
}

export function listarVideos(ctx) {
  return pedir(new URL('/videos', config.nodos.medios), ctx);
}

// -------------------------------------------------------- MPI Jobs (8082)
// node-rmi usa los estados del enum Java. La interfaz muestra los nuestros.
const ESTADOS = {
  QUEUED: 'EN_COLA',
  RUNNING: 'EJECUTANDO',
  COMPLETED: 'TERMINADO',
  FAILED: 'FALLIDO',
  CANCELLED: 'CANCELADO'
};

const aTrabajo = j => ({
  id: j.id,
  nombre: j.nombre,
  comando: j.comando,
  prioridad: j.prioridad,
  estado: ESTADOS[j.estado] || j.estado,
  enviado: j.fechaCreacion,
  resultado: j.resultado,
  mensajeError: j.mensajeError
});

export async function listarTrabajos(ctx) {
  const lista = await pedir(new URL('/jobs', config.nodos.trabajos), ctx);
  return { trabajos: (lista || []).map(aTrabajo) };
}

export async function enviarTrabajo(ctx, { nombre, comando, prioridad }) {
  const creado = await pedir(new URL('/jobs', config.nodos.trabajos), ctx, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, comando, prioridad: Number(prioridad) || 5 })
  });
  return { id: creado.id, nombre, estado: 'EN_COLA' };
}

export function cancelarTrabajo(ctx, id) {
  return pedir(new URL(`/jobs/${id}`, config.nodos.trabajos), ctx, { method: 'DELETE' });
}

// ------------------------------------------------------- Monitoreo (3000)
export function estadoInfraestructura(ctx) {
  return pedir(new URL('/api/estado', config.nodos.monitoreo), ctx);
}
