// Cliente del servicio de identidad (node-soap).
//
// Es lo ÚNICO que node-web traduce en vez de reenviar: el navegador no habla
// SOAP. Contrato: FrontWebUPBCientifica/docs/PASARELA.md, sección 1.
//
// Usa las operaciones `login` y `logout` de users.wsdl, las mismas que el
// cliente móvil y el agente de escritorio. Antes usaba `iniciarSesion` /
// `validarToken`, que siguen existiendo en node-soap para quien las necesite,
// pero así los tres clientes comparten un solo contrato de sesión.
//
// node-web ya no valida el token en cada petición: la pasarela lo reenvía y
// es cada servicio quien lo valida (y responde 401 si no vale).

import { config } from './config.js';

// Ruta del endpoint en la VM de node-soap (<soap:address> de users.wsdl).
const RUTA_SOAP = '/soap/user.php';

// targetNamespace de users.wsdl. Configurable porque hoy es una IP.
const NS = process.env.NAMESPACE_IDENTIDAD || 'http://192.168.1.195/soap';

function escapar(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/*
 * El elemento de la operación va en el namespace del WSDL, pero sus HIJOS no.
 * users.wsdl no declara elementFormDefault, así que rige "unqualified". Por eso
 * se usa un prefijo (ns:) y no xmlns= por defecto, que haría que los hijos
 * heredaran el namespace y PHP los leyera vacíos.
 */
function sobreSoap(operacion, cuerpo) {
  const campos = Object.entries(cuerpo)
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

// PHP SoapServer devuelve prefijos que cambian entre peticiones (ns1:,
// SOAP-ENV:...), así que el patrón los ignora.
function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`));
  return m ? m[1] : null;
}

/** `login` devuelve roles y servicios como UNA cadena con comas. */
function lista(valor) {
  return (valor || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function error(codigo, mensaje) {
  return Object.assign(new Error(mensaje), { codigo });
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
    // 503 y nunca 401: que Auth no responda no es culpa del usuario.
    throw error(503, 'El servicio de identidad no responde.');
  }

  if (!respuesta.ok) {
    throw error(503, `El servicio de identidad respondió ${respuesta.status}.`);
  }
  return respuesta.text();
}

/**
 * @returns {{token: string, expiraEn: number, roles: string[], serviciosAutorizados: string[]}}
 */
export async function login(usuario, contrasena, origenCliente = 'web', codigoMfa) {
  const xml = await llamarSoap('login', { usuario, contrasena, origenCliente, codigoMfa });

  const token = extraer(xml, 'token');
  if (!token) {
    // node-soap explica el motivo en <message> (credenciales, código MFA
    // pendiente...); se pasa tal cual porque al usuario le sirve saberlo.
    throw error(401, extraer(xml, 'message') || 'Usuario o contraseña incorrectos');
  }

  return {
    token,
    expiraEn: Number(extraer(xml, 'expiraEn') || 3600),
    roles: lista(extraer(xml, 'roles')),
    serviciosAutorizados: lista(extraer(xml, 'mapaServiciosAutorizados'))
  };
}

export async function logout(token) {
  if (!token) return;
  try {
    await llamarSoap('logout', { token });
  } catch {
    // Si Auth no responde, el token caducará por su cuenta. El front cierra la
    // sesión local igual (PASARELA.md, "Cerrar sesión").
  }
}
