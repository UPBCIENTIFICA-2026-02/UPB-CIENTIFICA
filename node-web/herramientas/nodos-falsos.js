// nodos-falsos.js — HERRAMIENTA DE PRUEBAS, no forma parte del servidor.
//
// Levanta cinco servidores que imitan a node-soap, node-repository, node-media,
// node-rmi y node-monitoreo, respondiendo exactamente los formatos acordados en
// docs/contratos.md. Sirve para probar servidor-web.js de punta a punta mientras
// los demás frentes del equipo terminan sus servicios.
//
// Uso:  npm run stubs      (en otra terminal)  npm start
//
// Cuando un servicio real esté disponible, se apunta node-web hacia él con su
// variable de entorno y se deja de usar este stub para ese servicio.

import express from 'express';

const SESION = {
  token: 'mock-token-apinzon',
  usuario: 'apinzon',
  nombre: 'Andrés Pinzón',
  uid: 1001,
  gid: 1001,
  cuotaMb: 5120
};

function levantar(nombre, puerto, configurar) {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: ['text/xml', 'application/xml'] }));
  configurar(app);
  app.listen(puerto, '127.0.0.1', () =>
    console.log(`[falso] ${nombre.padEnd(16)} http://127.0.0.1:${puerto}`));
}

// ------------------------------------------------- node-soap (SOAP, 8081)
levantar('node-soap', 8081, app => {
  app.post('/identidad.php', (req, res) => {
    const operacion = req.get('SOAPAction');
    const xml = String(req.body || '');
    const campo = t => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];

    res.type('text/xml');

    if (operacion === 'iniciarSesion') {
      if (!campo('usuario') || !campo('clave')) return res.send('<respuesta></respuesta>');
      return res.send(`<respuesta><token>${SESION.token}</token><expiraEn>3600</expiraEn></respuesta>`);
    }

    if (operacion === 'validarToken') {
      if (campo('token') !== SESION.token) return res.send('<respuesta><valido>false</valido></respuesta>');
      return res.send(`<respuesta>
        <valido>true</valido>
        <usuario>${SESION.usuario}</usuario>
        <nombre>${SESION.nombre}</nombre>
        <uid>${SESION.uid}</uid><gid>${SESION.gid}</gid>
        <cuotaMb>${SESION.cuotaMb}</cuotaMb>
      </respuesta>`);
    }

    res.status(400).send('<error>operacion desconocida</error>');
  });
});

// -------------------------------------------- node-repository (HTTP, 8084)
// Imita el contrato real de node-repository (repositorio UPB-CIENTIFICA):
// ruta /storage, identificadores de nodo y tamaños en bytes.
levantar('node-repository', 8084, app => {
  app.get('/storage/directorios/:id', (req, res) => res.json([
    { id: 'd-01', nombre: 'simulacion-flujo', tipo: 'directorio', tamanoBytes: 0, version: 1, directorioContenedorId: null },
    { id: 'a-01', nombre: 'dataset-2026.csv', tipo: 'archivo', tamanoBytes: 251658240, version: 2, directorioContenedorId: null },
    { id: 'a-02', nombre: 'resultados.tar.gz', tipo: 'archivo', tamanoBytes: 536870912, version: 1, directorioContenedorId: null }
  ]));
  app.get('/storage/cuota', (req, res) =>
    res.json({ usados: 851443712, cuota: 5368709120, disponibles: 4517265408 }));
});

// ------------------------------------------------- node-media (HTTP, 8083)
levantar('node-media', 8083, app => {
  app.get('/album', (req, res) => res.json({
    orden: req.query.orden || 'fecha',
    fotos: [
      { id: 'f-1', titulo: 'Montaje del clúster', fecha: '2026-08-12' },
      { id: 'f-2', titulo: 'Prueba de red del CCA', fecha: '2026-08-19' },
      { id: 'f-3', titulo: 'Nodos en rack', fecha: '2026-08-25' }
    ]
  }));
  app.get('/videos', (req, res) => res.json({
    videos: [
      { id: 'v-1', titulo: 'Presentación de resultados', duracionSeg: 742, fecha: '2026-08-20' },
      { id: 'v-2', titulo: 'Demostración de sincronización', duracionSeg: 318, fecha: '2026-08-26' }
    ]
  }));
});

// --------------------------------------------------- node-rmi (HTTP, 8082)
// Imita el contrato real de job-api (Spring Boot + RMI) del repositorio
// RMIUPBCientifica: ruta /jobs, estados del enum Java, lista como arreglo.
const TRABAJOS = [
  { id: 'a1b2c3d4-0001', nombre: 'monte-carlo', comando: 'mpirun -np 4 ./mc.bin',
    prioridad: 8, estado: 'RUNNING', fechaCreacion: '2026-08-28T08:15:00Z' },
  { id: 'a1b2c3d4-0002', nombre: 'fluidos-3d', comando: 'mpirun -np 2 ./fluidos',
    prioridad: 5, estado: 'COMPLETED', fechaCreacion: '2026-08-27T21:02:00Z', resultado: 'ok' },
  { id: 'a1b2c3d4-0003', nombre: 'prueba-hola-mpi', comando: 'mpirun -np 1 ./hola',
    prioridad: 3, estado: 'FAILED', fechaCreacion: '2026-08-27T16:44:00Z', mensajeError: 'exit 127' }
];
levantar('node-rmi', 8082, app => {
  app.get('/jobs', (req, res) => res.json(TRABAJOS));
  app.post('/jobs', (req, res) => {
    const nuevo = {
      id: 'a1b2c3d4-' + String(1000 + TRABAJOS.length),
      nombre: req.body.nombre,
      comando: req.body.comando,
      prioridad: req.body.prioridad ?? 5,
      estado: 'QUEUED',
      fechaCreacion: new Date().toISOString()
    };
    TRABAJOS.unshift(nuevo);
    res.status(201).json({ id: nuevo.id });
  });
  app.delete('/jobs/:id', (req, res) => res.json({ id: req.params.id, cancelado: true }));
});

// -------------------------------------------- node-monitoreo (HTTP, 3000)
levantar('node-monitoreo', 3000, app => {
  const v = (min, max) => Math.floor(min + Math.random() * (max - min));
  app.get('/api/estado', (req, res) => res.json({
    nodos: [
      { nombre: 'node-repository', cpu: v(15, 35), memoria: v(35, 50), disco: 63, arriba: true },
      { nombre: 'node-sync', cpu: v(5, 15), memoria: v(20, 30), disco: 19, arriba: true },
      { nombre: 'hpc-master', cpu: v(60, 85), memoria: v(50, 65), disco: 31, arriba: true },
      { nombre: 'hpc-worker-1', cpu: v(80, 99), memoria: v(60, 75), disco: 22, arriba: true }
    ]
  }));
});

console.log('\nNodos falsos arriba. En otra terminal: npm start\n');
