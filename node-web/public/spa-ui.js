// spa-ui.js — interfaz del portal UPB-CIENTÍFICA.
// Sin framework a propósito: el módulo debe poder ejecutarse en la VM del CCA
// sin cadena de compilación ni dependencias descargadas en tiempo de build.

const app = document.getElementById('app');
const quien = document.getElementById('quien');
let token = sessionStorage.getItem('upbc-token');
let sesion = null;
let pestana = 'archivos';

async function api(ruta, opciones = {}) {
  const respuesta = await fetch('/api' + ruta, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...opciones.headers
    }
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || 'Error inesperado');
  return datos;
}

function esc(t) {
  return String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// ------------------------------------------------------------------- Acceso
function pintarAcceso(mensaje) {
  quien.textContent = '';
  app.innerHTML = `
    <form class="acceso panel" id="f-acceso">
      <h2>Entrar al portal</h2>
      <p class="pista">Usa las credenciales del directorio de la universidad.</p>
      <label for="usuario">Usuario</label>
      <input id="usuario" name="usuario" autocomplete="username" required>
      <label for="clave">Contraseña</label>
      <input id="clave" name="clave" type="password" autocomplete="current-password" required>
      <label for="mfa">Código de verificación <span style="color:#98a2b3">(si lo tienes activo)</span></label>
      <input id="mfa" name="mfa" inputmode="numeric" autocomplete="one-time-code">
      <button class="principal" type="submit">Entrar</button>
      ${mensaje ? `<div class="aviso">${esc(mensaje)}</div>` : ''}
    </form>`;

  document.getElementById('f-acceso').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api('/sesion', {
        method: 'POST',
        body: JSON.stringify({
          usuario: usuario.value,
          clave: clave.value,
          codigoMfa: mfa.value
        })
      });
      token = r.token;
      sessionStorage.setItem('upbc-token', token);
      arrancar();
    } catch (err) {
      pintarAcceso(err.message);
    }
  });
}

// ------------------------------------------------------------------ Portada
const PESTANAS = [
  ['archivos', 'Archivos'],
  ['album', 'Fotos'],
  ['videos', 'Videos'],
  ['trabajos', 'Trabajos HPC'],
  ['monitoreo', 'Infraestructura']
];

function pintarMarco(contenido, simulado) {
  app.innerHTML = `
    ${simulado ? '<div class="simulado">Modo simulado: los datos que ves son de ejemplo. Los servicios reales aún no están conectados.</div>' : ''}
    <nav>${PESTANAS.map(([id, nombre]) =>
      `<button data-p="${id}" aria-selected="${id === pestana}">${nombre}</button>`).join('')}</nav>
    <section class="panel" id="contenido">${contenido}</section>`;

  app.querySelectorAll('nav button').forEach(b =>
    b.addEventListener('click', () => { pestana = b.dataset.p; cargar(); }));
}

async function cargar() {
  pintarMarco('<p class="vacio">Cargando…</p>', false);
  try {
    const vista = await VISTAS[pestana]();
    pintarMarco(vista, false);
  } catch (e) {
    if (String(e.message).includes('Sesión')) {
      token = null; sessionStorage.removeItem('upbc-token');
      return pintarAcceso('Tu sesión expiró. Entra de nuevo.');
    }
    pintarMarco(`<h2>${esc(PESTANAS.find(p => p[0] === pestana)[1])}</h2>
      <div class="aviso">${esc(e.message)}</div>`, false);
  }
}

const VISTAS = {
  async archivos() {
    const d = await api('/archivos');
    const pct = d.cuotaMb ? Math.round((d.usadoMb / d.cuotaMb) * 100) : 0;
    if (!d.entradas.length) {
      return `<h2>Archivos</h2><p class="vacio">Tu espacio está vacío. Sube un archivo para empezar.</p>`;
    }
    return `
      <h2>Archivos</h2>
      <p class="pista">Espacio usado: ${d.usadoMb} MB de ${d.cuotaMb} MB (${pct} %).</p>
      <div class="barra" style="margin-bottom:16px"><span style="width:${pct}%"></span></div>
      <table>
        <tr><th>Nombre</th><th>Tipo</th><th>Tamaño</th><th>Versión</th></tr>
        ${d.entradas.map(e => `<tr>
          <td>${esc(e.nombre)}</td>
          <td>${esc(e.tipo)}</td>
          <td>${e.tamanoMb !== null ? e.tamanoMb + ' MB' : '—'}</td>
          <td>${esc(e.version ?? '—')}</td>
        </tr>`).join('')}
      </table>`;
  },

  async album() {
    const d = await api('/album');
    if (!d.fotos.length) return '<h2>Fotos</h2><p class="vacio">Todavía no hay imágenes en tu espacio.</p>';
    return `<h2>Fotos</h2>
      <p class="pista">Imágenes de tu espacio personal, ordenadas por ${esc(d.orden)}.</p>
      <div class="rejilla">${d.fotos.map(f => `
        <figure class="foto" style="margin:0">
          <div class="lienzo"></div>
          <figcaption class="pie">${esc(f.titulo)}<div class="fecha">${esc(f.fecha)}</div></figcaption>
        </figure>`).join('')}</div>`;
  },

  async videos() {
    const d = await api('/videos');
    if (!d.videos.length) return '<h2>Videos</h2><p class="vacio">Todavía no hay videos publicados.</p>';
    return `<h2>Videos</h2>
      <p class="pista">Presentaciones disponibles para los usuarios autorizados.</p>
      <table>
        <tr><th>Título</th><th>Duración</th><th>Publicado</th></tr>
        ${d.videos.map(v => `<tr>
          <td>${esc(v.titulo)}</td>
          <td>${Math.floor(v.duracionSeg / 60)} min ${v.duracionSeg % 60} s</td>
          <td>${esc(v.fecha)}</td>
        </tr>`).join('')}
      </table>`;
  },

  async trabajos() {
    const d = await api('/trabajos');
    return `<h2>Trabajos HPC</h2>
      <p class="pista">Trabajos MPI enviados al clúster del laboratorio.</p>
      <table>
        <tr><th>Identificador</th><th>Nombre</th><th>Comando</th><th>Prioridad</th><th>Estado</th><th>Enviado</th></tr>
        ${d.trabajos.map(t => `<tr>
          <td><code>${esc(String(t.id).slice(0, 8))}</code></td>
          <td>${esc(t.nombre)}</td>
          <td><code>${esc(t.comando)}</code></td>
          <td>${esc(t.prioridad)}</td>
          <td><span class="estado ${esc(t.estado)}">${esc(t.estado)}</span></td>
          <td>${new Date(t.enviado).toLocaleString('es-CO')}</td>
        </tr>`).join('')}
      </table>`;
  },

  async monitoreo() {
    const d = await api('/monitoreo');
    return `<h2>Infraestructura</h2>
      <p class="pista">Ocupación de recursos por nodo. Los tableros completos están en Grafana.</p>
      <table>
        <tr><th>Nodo</th><th>CPU</th><th>Memoria</th><th>Disco</th><th>Estado</th></tr>
        ${d.nodos.map(n => `<tr>
          <td><code>${esc(n.nombre)}</code></td>
          <td><div class="barra"><span style="width:${n.cpu}%"></span></div>${n.cpu} %</td>
          <td>${n.memoria} %</td>
          <td>${n.disco} %</td>
          <td>${n.arriba ? 'Activo' : 'Caído'}</td>
        </tr>`).join('')}
      </table>`;
  }
};

async function arrancar() {
  if (!token) return pintarAcceso();
  try {
    sesion = await api('/sesion');
    quien.textContent = sesion.nombre + ' · cuota ' + sesion.cuotaMb + ' MB';
    cargar();
  } catch {
    token = null;
    sessionStorage.removeItem('upbc-token');
    pintarAcceso();
  }
}

arrancar();
