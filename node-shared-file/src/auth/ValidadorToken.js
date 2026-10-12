/**
 * Patrón Strategy para la validación de token.
 *
 * `ValidadorSimulado` sirve para desarrollo local sin node-soap levantado.
 * `ValidadorSoap` habla con el Authentication Service real (node-soap).
 * Se elige con MODO_AUTENTICACION en el .env, sin tocar el resto del código.
 *
 * Los dos devuelven la MISMA forma: { id, roles, grupos }. El resto del
 * servicio no sabe cuál está activo.
 */

const { ServicioAuthNoDisponible } = require("../dominio/errores");

class ValidadorToken {
  async validar(_token) {
    throw new Error("No implementado");
  }
}

/** Acepta cualquier token que empiece por "mock-token-" y deduce el usuario. */
class ValidadorSimulado extends ValidadorToken {
  async validar(token) {
    if (!token || !token.startsWith("mock-token-")) return null;
    const usuario = token.split("-")[2] || "desconocido";
    return { id: usuario, roles: ["investigador"], grupos: ["usuarios"] };
  }

  /**
   * Sin directorio no hay mapa de servicios que consultar: en modo simulado
   * todo usuario puede usar todo. La autorización real (D2) solo se aplica en
   * modo "soap", contra validarAccesoServicio de node-soap.
   */
  async autorizarServicio(_usuario, _servicio) {
    return true;
  }
}

/**
 * Extrae el primer valor de una etiqueta, ignorando el prefijo de namespace.
 *
 * PHP SoapServer devuelve las respuestas con prefijos que cambian según la
 * petición (ns1:, SOAP-ENV:...), así que el patrón acepta cualquiera.
 */
function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`));
  return m ? m[1] : null;
}

/** Igual que extraer, pero para elementos repetidos (maxOccurs="unbounded"). */
function extraerLista(xml, etiqueta) {
  const patron = new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`, "g");
  const valores = [];
  for (const m of xml.matchAll(patron)) {
    if (m[1] !== "") valores.push(m[1]);
  }
  return valores;
}

/**
 * Valida el token contra la operación `validarToken` del WSDL de node-soap.
 *
 * Se construye el sobre SOAP a mano con fetch, igual que hace node-web, para no
 * añadir una dependencia nueva al servicio por una sola llamada.
 *
 * CACHÉ: la propuesta de arquitectura advierte que validar contra Auth en CADA
 * petición convierte al Authentication Service en un cuello de botella. Se
 * cachea el resultado unos segundos: es el tiempo máximo que un token revocado
 * seguiría siendo aceptado, y a cambio una ráfaga de peticiones del mismo
 * cliente cuesta una sola llamada SOAP.
 */
class ValidadorSoap extends ValidadorToken {
  constructor(urlServicio, namespace, ttlCacheMs = 5000, tamanoMaxCache = 1000) {
    super();
    this.urlServicio = urlServicio;
    this.namespace = namespace;
    this.ttlCacheMs = ttlCacheMs;
    this.tamanoMaxCache = tamanoMaxCache;
    this.cache = new Map();
    this.accesos = new Map();   // "uid|servicio" -> { permitido, vence }
  }

  #deCache(token) {
    const entrada = this.cache.get(token);
    if (!entrada) return undefined;
    if (Date.now() > entrada.vence) {
      this.cache.delete(token);
      return undefined;
    }
    return entrada.usuario;
  }

  #aCache(token, usuario) {
    // Tope simple para que la caché no crezca sin límite: al llenarse se
    // descarta la entrada más antigua (Map conserva el orden de inserción).
    if (this.cache.size >= this.tamanoMaxCache) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(token, { usuario, vence: Date.now() + this.ttlCacheMs });
  }

  /*
   * El elemento de la operación va en el namespace del WSDL, pero sus HIJOS no.
   *
   * El esquema de users.wsdl no declara elementFormDefault, así que vale el
   * valor por omisión, "unqualified": solo el elemento global (validarToken)
   * lleva namespace. Por eso se usa un prefijo (ns:) en vez de xmlns= por
   * defecto: con xmlns= los hijos heredarían el namespace y quedarían
   * cualificados, que es justo lo que el esquema no pide. El cliente Android
   * ya lo hace de esta forma.
   */
  #sobre(token) {
    // El token va escapado: un token con & o < rompería el XML.
    const seguro = String(token).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:validarToken xmlns:ns="${this.namespace}">
      <token>${seguro}</token>
    </ns:validarToken>
  </soap:Body>
</soap:Envelope>`;
  }

  async validar(token) {
    if (!token) return null;

    const cacheado = this.#deCache(token);
    if (cacheado !== undefined) return cacheado;

    let respuesta;
    try {
      respuesta = await fetch(this.urlServicio, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `${this.namespace}/validarToken`,
        },
        body: this.#sobre(token),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      // Auth caído no es "token inválido": son 503 y 401, y confundirlos hace
      // que el cliente borre una sesión que en realidad sigue siendo buena.
      throw new ServicioAuthNoDisponible(e.message);
    }

    if (!respuesta.ok) {
      throw new ServicioAuthNoDisponible(`node-soap respondió ${respuesta.status}`);
    }

    const xml = await respuesta.text();

    if (extraer(xml, "valido") !== "true") {
      // Token inválido o caducado: se cachea también el rechazo, para que un
      // cliente con un token viejo no golpee a Auth en cada reintento.
      this.#aCache(token, null);
      return null;
    }

    const usuario = {
      id: extraer(xml, "uid"),
      roles: extraerLista(xml, "roles"),
      grupos: extraerLista(xml, "grupos"),
    };

    if (!usuario.id) {
      // Respuesta marcada como válida pero sin uid: es un contrato roto, no un
      // token malo. Mejor fallar ruidosamente que tratar al usuario como nadie.
      throw new ServicioAuthNoDisponible(
        "node-soap devolvió valido=true sin uid"
      );
    }

    this.#aCache(token, usuario);
    return usuario;
  }

  /**
   * Mapa de servicios (D2): ¿el perfil del usuario puede usar `servicio`?
   * Operación validarAccesoServicio(usuario, servicio) de users.wsdl.
   *
   * ANTES ningún servicio lo comprobaba: el login devolvía
   * mapaServiciosAutorizados pero un usuario sin "hpc" en su mapa podía usar
   * la HPC igual. AHORA el middleware de autenticación lo exige.
   *
   * Se cachea por (uid, servicio) un minuto: el mapa cambia muy rara vez y así
   * no se añade una llamada SOAP a cada petición. Si node-soap no responde se
   * lanza ServicioAuthNoDisponible (503), nunca se concede por defecto.
   */
  async autorizarServicio(usuario, servicio) {
    const clave = `${usuario.id}|${servicio}`;
    const entrada = this.accesos.get(clave);
    if (entrada && Date.now() < entrada.vence) return entrada.permitido;

    const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:validarAccesoServicio xmlns:ns="${this.namespace}">
      <usuario>${esc(usuario.id)}</usuario>
      <servicio>${esc(servicio)}</servicio>
    </ns:validarAccesoServicio>
  </soap:Body>
</soap:Envelope>`;
    let respuesta;
    try {
      respuesta = await fetch(this.urlServicio, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `${this.namespace}/validarAccesoServicio`,
        },
        body: sobre,
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      throw new ServicioAuthNoDisponible(e.message);
    }
    if (!respuesta.ok) {
      throw new ServicioAuthNoDisponible(`node-soap respondió ${respuesta.status} a validarAccesoServicio`);
    }
    const permitido = extraer(await respuesta.text(), "success") === "true";

    if (this.accesos.size >= this.tamanoMaxCache) {
      this.accesos.delete(this.accesos.keys().next().value);
    }
    this.accesos.set(clave, { permitido, vence: Date.now() + 60_000 });
    return permitido;
  }
}

function crearValidador(config) {
  if (config.modoAutenticacion === "soap") {
    if (!config.urlAuthSoap) {
      throw new Error(
        "MODO_AUTENTICACION=soap requiere URL_AUTH_SOAP en el .env"
      );
    }
    return new ValidadorSoap(config.urlAuthSoap, config.namespaceAuth);
  }
  return new ValidadorSimulado();
}

module.exports = { ValidadorToken, ValidadorSimulado, ValidadorSoap, crearValidador };
