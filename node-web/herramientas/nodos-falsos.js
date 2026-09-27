// nodos-falsos.js — HERRAMIENTA DE PRUEBAS, no forma parte del servidor.
//
// Levanta cinco servidores que imitan a node-soap, node-repository, node-media,
// node-rmi y node-monitoreo. Sirve para probar servidor-web.js de punta a punta
// sin levantar las VMs.
//
// IMPORTANTE: estos stubs imitan los contratos REALES de cada servicio, no una
// propuesta. Antes imitaban un contrato inventado (/identidad.php, /album,
// /videos) que ningún servicio implementaba, así que node-web "funcionaba"
// contra los stubs y daba 404 contra los servicios de verdad. Si se cambia un
// contrato, hay que cambiarlo aquí también o este archivo vuelve a mentir.
//
// Uso:  npm run stubs      (en otra terminal)  npm start

import express from 'express';

// El namespace real del WSDL de node-soap (users.wsdl).
const NS = 'http://192.168.1.195/soap';

const SESION = {
  token: 'upbc1.token-de-prueba.firma-de-prueba',
  uid: 'apinzon',
  nombre: 'Andrés',
  apellido: 'Pinzón',
  correo: 'apinzon@upb-cientifica.local',
  roles: ['investigadores'],
  grupos: ['investigadores', 'usuarios']
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
// Imita users.wsdl: mismo endpoint, mismo namespace, mismas operaciones.
levantar('node-soap', 8081, app => {
  const sobre = (operacion, cuerpo) => `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
                   xmlns:ns1="${NS}">
  <SOAP-ENV:Body>
    <ns1:${operacion}Response>${cuerpo}</ns1:${operacion}Response>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const lista = (etiqueta, valores) =>
    valores.map(v => `<${etiqueta}>${v}</${etiqueta}>`).join('');

  app.post('/soap/user.php', (req, res) => {
    const xml = String(req.body || '');
    const campo = t => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];

    // El SOAPAction real es "<namespace>/<operacion>"; también se acepta el
    // nombre suelto por comodidad al depurar con curl.
    const accion = String(req.get('SOAPAction') || '').replace(NS + '/', '').replace(/"/g, '');

    res.type('text/xml');

    if (accion === 'iniciarSesion') {
      if (!campo('usuario') || !campo('password')) {
        return res.send(sobre('iniciarSesion',
          '<success>false</success><message>Usuario o contraseña incorrectos</message>'));
      }
      return res.send(sobre('iniciarSesion',
        `<success>true</success><message>Sesión iniciada</message>` +
        `<token>${SESION.token}</token><expiraEn>28800</expiraEn>` +
        `<uid>${SESION.uid}</uid>` +
        lista('roles', SESION.roles) + lista('grupos', SESION.grupos)));
    }

    if (accion === 'validarToken') {
      if (campo('token') !== SESION.token) {
        return res.send(sobre('validarToken', '<valido>false</valido>'));
      }
      return res.send(sobre('validarToken',
        `<valido>true</valido><uid>${SESION.uid}</uid>` +
        lista('roles', SESION.roles) + lista('grupos', SESION.grupos) +
        `<expiraEn>28800</expiraEn>`));
    }

    if (accion === 'obtenerUsuario') {
      return res.send(sobre('obtenerUsuario',
        `<success>true</success><message>Usuario encontrado</message>` +
        `<usuario>${SESION.uid}</usuario><nombre>${SESION.nombre}</nombre>` +
        `<apellido>${SESION.apellido}</apellido><correo>${SESION.correo}</correo>`));
    }

    if (accion === 'cerrarSesion') {
      return res.send(sobre('cerrarSesion',
        '<success>true</success><message>Sesión cerrada</message>'));
    }

    res.status(500).send(sobre('Fault', '<message>operacion desconocida</message>'));
  });
});

// -------------------------------------------- node-repository (HTTP, 8084)
// Imita el contrato real de node-repository: ruta /storage, identificadores de
// nodo, tamaños en bytes y los campos de permisos que consume node-media.
levantar('node-repository', 8084, app => {
  app.get('/storage/directorios/:id', (req, res) => res.json([
    { id: 'd-01', nombre: 'simulacion-flujo', tipo: 'directorio', tamanoBytes: 0, version: 1,
      directorioContenedorId: null, propietario: 'apinzon', grupo: 'investigadores', permisos: 'rwxr-----' },
    { id: 'a-01', nombre: 'dataset-2026.csv', tipo: 'archivo', tamanoBytes: 251658240, version: 2,
      directorioContenedorId: null, propietario: 'apinzon', grupo: 'investigadores', permisos: 'rw-r-----' },
    { id: 'a-02', nombre: 'resultados.tar.gz', tipo: 'archivo', tamanoBytes: 536870912, version: 1,
      directorioContenedorId: null, propietario: 'apinzon', grupo: 'investigadores', permisos: 'rw-r-----' }
  ]));
  app.get('/storage/cuota', (req, res) =>
    res.json({ usados: 851443712, cuota: 5368709120, disponibles: 4517265408 }));
  app.get('/health', (req, res) =>
    res.json({ estado: 'ok', servicio: 'distributed-storage', bd: 'ok', version: '0.1.0' }));
});

// ------------------------------------------------- node-media (HTTP, 8083)
// Endpoints REALES: /album/fotos y /streaming/catalogo, que devuelven ARREGLOS.
levantar('node-media', 8083, app => {
  app.get('/album/fotos', (req, res) => res.json([
    { id: 'f-1', titulo: 'Montaje del clúster', tipo: 'foto', tamanoBytes: 2411724,
      ancho: 4032, alto: 3024, tieneMiniatura: true, fecha: '2026-08-12T10:04:00.000Z' },
    { id: 'f-2', titulo: 'Prueba de red del CCA', tipo: 'foto', tamanoBytes: 1884160,
      ancho: 3024, alto: 4032, tieneMiniatura: true, fecha: '2026-08-19T15:22:00.000Z' },
    { id: 'f-3', titulo: 'Nodos en rack', tipo: 'foto', tamanoBytes: 3355443,
      ancho: 4032, alto: 3024, tieneMiniatura: false, fecha: '2026-08-25T09:10:00.000Z' }
  ]));

  app.get('/streaming/catalogo', (req, res) => res.json([
    { id: 'v-1', titulo: 'Presentación de resultados', duracionSegundos: 742,
      fecha: '2026-08-20T18:00:00.000Z' },
    { id: 'v-2', titulo: 'Demostración de sincronización', duracionSegundos: 318,
      fecha: '2026-08-26T11:30:00.000Z' }
  ]));

  app.post('/album/indexar', (req, res) => res.json({ indexados: 3, revisados: 5 }));
  app.get('/health', (req, res) =>
    res.json({ estado: 'ok', servicio: 'media', bd: 'ok', fuente: 'storage-api', version: '0.1.0' }));
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

console.log('\nNodos falsos arriba. En otra terminal: npm start');
console.log(`Usuario de prueba: cualquiera + cualquier clave (token ${SESION.token})\n`);
