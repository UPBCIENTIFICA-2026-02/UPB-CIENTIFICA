// Cliente del servicio de identidad (node-soap).
//
// node-web no valida credenciales por su cuenta: delega en el servicio SOAP,
// que es la única pieza del sistema que consulta el directorio LDAP.
//
// ---------------------------------------------------------------------------
// ESTE ARCHIVO SE REESCRIBIÓ CONTRA EL CONTRATO REAL DE node-soap.
//
// Antes hablaba con un contrato que solo existía en herramientas/nodos-falsos.js:
//   - POST /identidad.php                  -> ahora /soap/user.php
//   - namespace urn:upbc:identidad          -> ahora http://192.168.1.195/soap
//   - iniciarSesion(usuario, clave, ...)    -> el parámetro es `password`
//   - validarToken -> <uid> y <gid> NUMÉRICOS y <cuotaMb>
//        · el uid de LDAP es una CADENA ("jperez"), no un número: Number("jperez")
//          daba NaN. Ahora se trata como cadena, igual que en node-repository,
//          node-media y node-sync.
//        · no hay un solo gid: LDAP devuelve una LISTA de grupos, que es lo que
//          necesita el modelo de permisos Unix de Storage.
//        · cuotaMb no es asunto de Auth: la cuota vive en node-repository
//          (cuotas.conf). Se pide a Storage, ver rutas.js.
// ---------------------------------------------------------------------------
//
// El token es opaco para node-web: se guarda y se reenvía, nunca se interpreta.
// Se consulta a Auth en cada petición (con caché corta) para que cerrar sesión
// surta efecto de verdad.

import { config } from './config.js';

// Ruta del endpoint dentro de la VM de node-soap, tal como la publica el WSDL
// (elemento <soap:address> de users.wsdl).
const RUTA_SOAP = '/soap/user.php';

// targetNamespace del WSDL. Se puede sobreescribir por entorno porque hoy es una
// IP y cambiará cuando node-soap deje de estar en 192.168.1.195.
const NS = process.env.NAMESPACE_IDENTIDAD || 'http://192.168.1.195/soap';

function escapar(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/*
 * El elemento de la operación va en el namespace del WSDL, pero sus HIJOS no.
 *
 * El esquema de users.wsdl no declara elementFormDefault, así que rige el valor
 * por omisión, "unqualified": solo el elemento global lleva namespace. Por eso
 * se usa un prefijo (ns:) y no xmlns= por defecto, que haría que los hijos
 * heredaran el namespace y quedaran cualificados. El cliente Android ya lo
 * construye de esta forma.
 */
function sobreSoap(operacion, cuerpo) {
  const campos = Object.entries(cuerpo)
    // Los campos opcionales no se envían si vienen vacíos: node-soap solo exige
    // el código MFA cuando hay un OTP pendiente.
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<${k}>${escapar(v)}</${k}>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:${operacion} xmlns:ns="${NS}">${campos}</ns:${operacion}>
  </soap:Body>
</soap:Envelope>`;
}

// PHP SoapServer devuelve prefijos de namespace que cambian entre peticiones
// (ns1:, SOAP-ENV:...), así que los patrones los ignoran.
function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`));
  return m ? m[1] : null;
}

function extraerLista(xml, etiqueta) {
  const patron = new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`, 'g');
  return [...xml.matchAll(patron)].map(m => m[1]).filter(v => v !== '');
}

async function llamarSoap(operacion, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(new URL(RUTA_SOAP, config.nodos.identidad), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `${NS}/${operacion}`
      },
      body: sobreSoap(operacion, cuerpo),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch {
    const err = new Error('El servicio de identidad no responde');
    err.codigo = 503;
    throw err;
  }

  if (!respuesta.ok) {
    const err = new Error(`El servicio de identidad respondió ${respuesta.status}`);
    err.codigo = 503;
    throw err;
  }

  return respuesta.text();
}

export async function iniciarSesion(usuario, clave, codigoMfa) {
  const xml = await llamarSoap('iniciarSesion', {
    usuario,
    password: clave,          // el WSDL lo llama `password`, no `clave`
    origenCliente: 'web',
    codigoMfa
  });

  const token = extraer(xml, 'token');
  if (!token) {
    // node-soap distingue "credenciales malas" de "falta el código MFA", y esa
    // diferencia el usuario necesita verla para saber qué hacer.
    const mensaje = extraer(xml, 'message') || 'Usuario o contraseña incorrectos';
    const err = new Error(mensaje);
    err.codigo = 401;
    throw err;
  }

  return { token, expiraEn: Number(extraer(xml, 'expiraEn') || 3600) };
}

/**
 * @returns {{usuario: string, roles: string[], grupos: string[]}|null}
 */
export async function validarToken(token) {
  if (!token) return null;

  const xml = await llamarSoap('validarToken', { token });
  if (extraer(xml, 'valido') !== 'true') return null;

  const uid = extraer(xml, 'uid');
  if (!uid) return null;

  return {
    usuario: uid,                        // cadena, no número
    roles: extraerLista(xml, 'roles'),
    grupos: extraerLista(xml, 'grupos')
  };
}

/** Nombre para mostrar. Se pide aparte: validarToken no lo devuelve. */
export async function obtenerPerfil(usuario) {
  try {
    const xml = await llamarSoap('obtenerUsuario', { usuario });
    if (extraer(xml, 'success') !== 'true') return {};
    return {
      nombre: extraer(xml, 'nombre'),
      apellido: extraer(xml, 'apellido'),
      correo: extraer(xml, 'correo')
    };
  } catch {
    // El perfil es decorativo: si Auth no lo da, la sesión sigue siendo válida.
    return {};
  }
}

export async function cerrarSesion(token) {
  if (!token) return;
  try {
    await llamarSoap('cerrarSesion', { token });
  } catch {
    // Si Auth no responde, el token caducará por su cuenta. No es un error que
    // el usuario deba ver al pulsar "salir".
  }
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
