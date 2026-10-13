#!/usr/bin/env node
/*
 * auth-local.js — Authentication Service de pruebas para el entorno local.
 *
 * HERRAMIENTA DE PRUEBAS. No es node-soap ni lo sustituye en producción.
 *
 * ¿Para qué existe, si ya hay dos simuladores?
 * ------------------------------------------------------------------------
 * Ninguno de los dos sirve para probar las interfaces contra los servicios
 * REALES (node-repository, node-media, gestor del clúster):
 *
 *   - FrontUPBCientifica/mock-auth-server/server.js solo habla el contrato de
 *     la app móvil (login / logout). Su validarToken no devuelve el uid, así que
 *     node-web rechaza todas las peticiones del portal.
 *
 *   - node-web/herramientas/nodos-falsos.js emite tokens "upbc1.token-de-prueba"
 *     que los servicios reales, en MODO_AUTENTICACION=simulado, rechazan (solo
 *     aceptan "mock-token-<uid>-..."). Y además ocupa los puertos 8082/8083/8084,
 *     que son justo los de los servicios reales.
 *
 * Este habla LOS DOS contratos de users.wsdl y emite tokens que entienden todos:
 *
 *   App móvil  ->  login, logout, validarToken
 *   node-web   ->  iniciarSesion, validarToken, obtenerUsuario, cerrarSesion
 *   Servicios  ->  validarToken (cuando corren con MODO_AUTENTICACION=soap)
 *
 * Escucha en el puerto 8081 y en la ruta /soap/user.php, los mismos que el
 * node-soap real. Así, cuando exista la VM de node-soap, lo único que cambia
 * en los clientes es la IP.
 *
 * Tokens: "mock-token-<uid>-<aleatorio>". Es el formato que aceptan los
 * validadores simulados de node-repository, node-media, node-sync y el gestor
 * RMI, así que funcionan tanto si los servicios validan en modo "simulado"
 * como en modo "soap" contra este mismo proceso.
 *
 * Uso:
 *   node herramientas/auth-local.js
 *   PUERTO=9000 node herramientas/auth-local.js
 *
 * Sin dependencias: solo el módulo http de Node.
 */

const http = require("http");
const crypto = require("crypto");

const PUERTO = Number(process.env.PUERTO || 8081);
// 0.0.0.0 para que el celular, en la misma Wi-Fi, pueda llegar.
const INTERFAZ = process.env.INTERFAZ || "0.0.0.0";
// targetNamespace de users.wsdl.
const NS = "http://192.168.1.195/soap";
const VIGENCIA_SEGUNDOS = 8 * 3600;

/*
 * Usuarios de prueba.
 *
 * Los grupos importan cuando los servicios validan en modo "soap": son los que
 * evalúa el segmento de grupo de los permisos Unix de node-repository. Con
 * `investigador` y `estudiante` en grupos distintos se puede comprobar que un
 * archivo compartido con un grupo no lo ve el otro.
 *
 * En modo "simulado" los servicios IGNORAN estos grupos: su validador inventa
 * siempre ["usuarios"].
 */
const USUARIOS = {
  user1: {
    clave: "1234", nombre: "Usuario", apellido: "Uno",
    grupos: ["investigadores", "usuarios"],
  },
  investigador: {
    clave: "test", nombre: "Investigador", apellido: "Prueba",
    grupos: ["investigadores", "usuarios"],
  },
  estudiante: {
    clave: "test", nombre: "Estudiante", apellido: "Prueba",
    grupos: ["estudiantes", "usuarios"],
  },
};

/**
 * Mapa de servicios: lo que cada PERFIL puede usar. Es lo mismo que en el
 * directorio real está en ou=services (despliegue/node-soap/directorio.ldif):
 * la app lo recibe en mapaServiciosAutorizados y los servicios lo exigen con
 * validarAccesoServicio cuando corren en modo "soap" (D2).
 *
 * Los estudiantes no tienen "hpc": así se puede comprobar que el gestor del
 * clúster los rechaza con 403. Album, streaming y filesync trabajan sobre el
 * Home, así que todo perfil que los tenga necesita también "storage".
 */
const SERVICIOS_POR_PERFIL = {
  // hpcadmin = permiso "hpc:prioridad-alta" de Contrato_HPC y administrar los
  // nodos de la malla Grid (RegistrarNodo / RetirarNodo).
  investigadores: ["storage", "sharedfile", "album", "streaming", "filesync", "hpc", "hpcadmin"],
  estudiantes: ["storage", "sharedfile", "album", "streaming", "filesync"],
};

/** Home de cada usuario (D3). En el directorio real es el atributo homeDirectory. */
const homeDe = (uid) => `/srv/home/${uid}`;

/** token -> { uid, vence } */
const sesiones = new Map();

// ---------------------------------------------------------------- utilidades

function hora() {
  return new Date().toLocaleTimeString("es-CO", { hour12: false });
}

function log(...partes) {
  console.log(`[${hora()}]`, ...partes);
}

function escapar(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Valor de un elemento hijo, ignorando el prefijo de namespace. */
function campo(xml, nombre) {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${nombre}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${nombre}>`));
  return m ? m[1].trim() : "";
}

/**
 * Nombre de la operación.
 *
 * Se mira primero la cabecera SOAPAction ("<namespace>/<operacion>") y, si no
 * viene, el primer elemento dentro de <Body>.
 */
function operacionDe(req, xml) {
  const accion = String(req.headers.soapaction || "").replace(/"/g, "");
  if (accion) return accion.split("/").pop();
  const m = xml.match(/<(?:[\w.-]+:)?Body[^>]*>\s*<(?:[\w.-]+:)?([\w]+)/);
  return m ? m[1] : "";
}

/** Sobre de respuesta con la misma forma que devuelve PHP SoapServer. */
function sobre(operacion, campos) {
  const cuerpo = campos
    .map(([k, v]) => (Array.isArray(v)
      ? v.map((x) => `<${k}>${escapar(x)}</${k}>`).join("")
      : `<${k}>${escapar(v)}</${k}>`))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="${NS}">
<SOAP-ENV:Body><ns1:${operacion}Response>${cuerpo}</ns1:${operacion}Response></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function fault(mensaje) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
<SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode>
<faultstring>${escapar(mensaje)}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

// ------------------------------------------------------------------- dominio

/**
 * Comprueba credenciales y explica el motivo si fallan.
 *
 * El motivo se registra en consola (nunca la contraseña). Con el simulador
 * anterior el log solo mostraba el usuario y no había forma de saber si la
 * contraseña había llegado vacía, mal escrita o directamente no había llegado.
 */
function verificar(usuario, clave) {
  const u = USUARIOS[usuario];
  if (!usuario) return { ok: false, motivo: "no llegó el usuario" };
  if (!u) return { ok: false, motivo: `el usuario "${usuario}" no existe` };
  if (!clave) return { ok: false, motivo: "no llegó la contraseña (vacía)" };
  if (u.clave !== clave) {
    return { ok: false, motivo: `contraseña incorrecta (llegaron ${clave.length} caracteres)` };
  }
  return { ok: true, datos: u };
}

function rolesDe(datos) {
  return datos.grupos.length ? [datos.grupos[0]] : [];
}

function emitir(uid) {
  const token = `mock-token-${uid}-${crypto.randomBytes(6).toString("hex")}`;
  sesiones.set(token, { uid, vence: Date.now() + VIGENCIA_SEGUNDOS * 1000 });
  return token;
}

function sesionDe(token) {
  const s = sesiones.get(token);
  if (!s) return null;
  if (Date.now() > s.vence) {
    sesiones.delete(token);
    return null;
  }
  return s;
}

// ---------------------------------------------------------------- operaciones

const OPERACIONES = {
  /** Contrato de node-web: password, roles/grupos como elementos repetidos. */
  iniciarSesion(xml) {
    const usuario = campo(xml, "usuario");
    const r = verificar(usuario, campo(xml, "password"));
    if (!r.ok) {
      log(`iniciarSesion  usuario="${usuario}"  RECHAZADO: ${r.motivo}`);
      return [["success", "false"], ["message", "Usuario o contraseña incorrectos"]];
    }
    const token = emitir(usuario);
    log(`iniciarSesion  usuario="${usuario}"  OK  origen=${campo(xml, "origenCliente") || "-"}`);
    return [
      ["success", "true"], ["message", "Sesión iniciada"],
      ["token", token], ["expiraEn", VIGENCIA_SEGUNDOS], ["uid", usuario],
      ["roles", rolesDe(r.datos)], ["grupos", r.datos.grupos],
    ];
  },

  /**
   * Contrato de la app móvil: contrasena, y roles / mapaServiciosAutorizados
   * como UNA cadena separada por comas (la app hace .split(",")).
   */
  login(xml) {
    const usuario = campo(xml, "usuario");
    const r = verificar(usuario, campo(xml, "contrasena"));
    if (!r.ok) {
      log(`login          usuario="${usuario}"  RECHAZADO: ${r.motivo}`);
      return [["success", "false"], ["message", "Usuario o contraseña incorrectos"]];
    }
    const token = emitir(usuario);
    const roles = rolesDe(r.datos);
    const servicios = SERVICIOS_POR_PERFIL[roles[0]] || [];
    log(`login          usuario="${usuario}"  OK  origen=${campo(xml, "origenCliente") || "-"}`);
    return [
      ["success", "true"], ["message", "Sesión iniciada"],
      ["token", token], ["expiraEn", VIGENCIA_SEGUNDOS], ["uid", usuario],
      ["roles", roles.join(",")], ["grupos", r.datos.grupos.join(",")],
      ["mapaServiciosAutorizados", servicios.join(",")],
    ];
  },

  /** Lo llaman node-web en cada petición y los servicios en modo "soap". */
  validarToken(xml) {
    const token = campo(xml, "token");
    const s = sesionDe(token);
    if (!s) {
      log(`validarToken   token=${token.slice(0, 22)}…  INVÁLIDO o caducado`);
      return [["valido", "false"]];
    }
    const datos = USUARIOS[s.uid];
    return [
      ["valido", "true"], ["uid", s.uid],
      ["roles", rolesDe(datos)], ["grupos", datos.grupos],
      ["expiraEn", Math.max(0, Math.round((s.vence - Date.now()) / 1000))],
    ];
  },

  obtenerUsuario(xml) {
    const usuario = campo(xml, "usuario");
    const u = USUARIOS[usuario];
    if (!u) return [["success", "false"], ["message", "Usuario no encontrado"]];
    return [
      ["success", "true"], ["message", "Usuario encontrado"], ["usuario", usuario],
      ["nombre", u.nombre], ["apellido", u.apellido],
      ["correo", `${usuario}@upb-cientifica.local`],
      ["homeDirectory", homeDe(usuario)],
    ];
  },

  /**
   * Mapa de servicios (D2), igual que user.php: el perfil es el primer grupo
   * en orden alfabético y se mira si el servicio lo incluye.
   */
  validarAccesoServicio(xml) {
    const usuario = campo(xml, "usuario");
    const servicio = campo(xml, "servicio");
    const datos = USUARIOS[usuario];
    if (!datos || !servicio) return [["success", "false"], ["message", "Usuario o servicio inválido"]];
    const perfil = [...datos.grupos].sort()[0];
    const ok = (SERVICIOS_POR_PERFIL[perfil] || []).includes(servicio);
    log(`validarAccesoServicio  ${usuario} (${perfil}) -> ${servicio}: ${ok ? "PERMITIDO" : "DENEGADO"}`);
    return ok
      ? [["success", "true"], ["message", `Acceso PERMITIDO al servicio ${servicio}`], ["perfil", perfil], ["servicio", servicio]]
      : [["success", "false"], ["message", `Acceso DENEGADO al servicio ${servicio} para el perfil ${perfil}`],
         ["perfil", perfil], ["servicio", servicio]];
  },

  autenticarUsuario(xml) {
    const r = verificar(campo(xml, "usuario"), campo(xml, "password"));
    return r.ok
      ? [["success", "true"], ["message", "Autenticación exitosa"]]
      : [["success", "false"], ["message", "Usuario o contraseña incorrectos"]];
  },

  cerrarSesion(xml) {
    const token = campo(xml, "token");
    const habia = sesiones.delete(token);
    log(`cerrarSesion   ${habia ? "OK" : "el token no existía"}`);
    return [["success", String(habia)], ["message", habia ? "Sesión cerrada" : "Token no válido"]];
  },
};
// La app móvil usa logout; node-web, cerrarSesion. Hacen lo mismo.
OPERACIONES.logout = OPERACIONES.cerrarSesion;

// -------------------------------------------------------------------- servidor

const servidor = http.createServer((req, res) => {
  // Comprobación rápida desde el navegador del celular: http://<ip>:8081/
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`auth-local OK — ${sesiones.size} sesión(es) activa(s)\n`);
    return;
  }

  let xml = "";
  req.on("data", (c) => { xml += c; });
  req.on("end", () => {
    const op = operacionDe(req, xml);
    const manejador = OPERACIONES[op];
    res.setHeader("Content-Type", "text/xml; charset=utf-8");

    if (!manejador) {
      log(`operación desconocida: "${op}"`);
      res.writeHead(500);
      res.end(fault(`Operación no soportada: ${op}`));
      return;
    }

    try {
      res.writeHead(200);
      res.end(sobre(op, manejador(xml)));
    } catch (e) {
      log(`error en ${op}: ${e.message}`);
      res.writeHead(500);
      res.end(fault(e.message));
    }
  });
});

servidor.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nEl puerto ${PUERTO} ya está ocupado. ¿Hay otro auth-local, nodos-falsos.js`);
    console.error("o el node-soap real corriendo? Ciérralo o usa PUERTO=<otro>.\n");
  } else {
    console.error(e);
  }
  process.exit(1);
});

servidor.listen(PUERTO, INTERFAZ, () => {
  console.log("============================================================");
  console.log(` auth-local escuchando en http://${INTERFAZ}:${PUERTO}/soap/user.php`);
  console.log(" Usuarios de prueba:");
  for (const [u, d] of Object.entries(USUARIOS)) {
    console.log(`   ${u.padEnd(13)} / ${d.clave.padEnd(5)}  grupos: ${d.grupos.join(", ")}`);
  }
  console.log(" Tokens con formato mock-token-<uid>-...: los aceptan todos los");
  console.log(" servicios, tanto en modo 'simulado' como en modo 'soap'.");
  console.log("============================================================");
});
