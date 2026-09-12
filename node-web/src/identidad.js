// Cliente del servicio de identidad (node-soap).
//
// node-web no valida credenciales por su cuenta: delega en el servicio SOAP,
// que es la única pieza del sistema que consulta el directorio LDAP.
//
// Punto abierto de la arquitectura: falta decidir si el token es autocontenido
// (node-web verifica la firma sin preguntar) o si es opaco y hay que consultar
// en cada petición. Aquí está implementada la segunda opción, que permite
// revocar sesiones. Si el equipo decide lo contrario, solo cambia validarToken.

import { config } from './config.js';

function sobreSoap(operacion, cuerpo) {
  const campos = Object.entries(cuerpo).map(([k, v]) => `<${k}>${v ?? ''}</${k}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operacion} xmlns="urn:upbc:identidad">${campos}</${operacion}>
  </soap:Body>
</soap:Envelope>`;
}

function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`));
  return m ? m[1] : null;
}

async function llamarSoap(operacion, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(new URL('/identidad.php', config.nodos.identidad), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: operacion },
      body: sobreSoap(operacion, cuerpo),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (e) {
    const err = new Error('El servicio de identidad no responde');
    err.codigo = 503;
    throw err;
  }
  return respuesta.text();
}

export async function iniciarSesion(usuario, clave, codigoMfa) {
  const xml = await llamarSoap('iniciarSesion', { usuario, clave, codigoMfa });
  const token = extraer(xml, 'token');
  if (!token) {
    const err = new Error('Usuario, contraseña o código de verificación incorrectos');
    err.codigo = 401;
    throw err;
  }
  return { token, expiraEn: Number(extraer(xml, 'expiraEn') || 3600) };
}

export async function validarToken(token) {
  if (!token) return null;
  const xml = await llamarSoap('validarToken', { token });
  if (extraer(xml, 'valido') !== 'true') return null;
  return {
    usuario: extraer(xml, 'usuario'),
    nombre: extraer(xml, 'nombre'),
    uid: Number(extraer(xml, 'uid')),
    gid: Number(extraer(xml, 'gid')),
    cuotaMb: Number(extraer(xml, 'cuotaMb'))
  };
}

// Middleware: exige sesión válida y deja el usuario en req.sesion.
export async function exigirSesion(req, res, siguiente) {
  const cabecera = req.get('Authorization') || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  try {
    const sesion = await validarToken(token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión de nuevo.' });
    req.sesion = sesion;
    siguiente();
  } catch (e) {
    res.status(e.codigo || 503).json({ error: e.message });
  }
}
