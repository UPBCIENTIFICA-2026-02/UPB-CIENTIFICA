#!/usr/bin/env node
/*
 * prueba-cliente-movil.js — HERRAMIENTA DE PRUEBAS.
 *
 * Replica la secuencia de llamadas que hace el cliente móvil Android contra los
 * servicios REALES, sin necesidad de compilar ni ejecutar la app.
 *
 * Para qué sirve: separar dos preguntas que conviene no mezclar al depurar.
 *   1. ¿El backend responde lo que el móvil espera?   <-- esto lo contesta aquí
 *   2. ¿La app está bien escrita?                     <-- eso se mira en Android
 *
 * El móvil habla DIRECTO con cada servicio por su protocolo real, sin pasar por
 * node-web (ver TRASPASO §2.4), así que esta herramienta hace lo mismo.
 *
 * Los endpoints que se prueban son los documentados en TRASPASO §3.4 como
 * "lo que el cliente móvil espera".
 *
 * Uso:
 *
 *   # Modo simulado (MODO_AUTENTICACION=simulado en los servicios):
 *   node herramientas/prueba-cliente-movil.js --token mock-token-jperez-abc123
 *
 *   # Modo real: pide el token a node-soap igual que haría la app
 *   node herramientas/prueba-cliente-movil.js \
 *        --soap https://192.168.1.195:8081/soap/user.php \
 *        --usuario jperez --clave secreta
 *
 *   # Apuntar a otras direcciones (por defecto: localhost)
 *   node herramientas/prueba-cliente-movil.js --token ... \
 *        --storage http://192.168.20.31:8084 --media http://192.168.20.31:8083
 *
 * No necesita dependencias: usa fetch/FormData/Blob del propio Node 18+.
 */

// ---------------------------------------------------------------- argumentos

function leerArgumentos(argv) {
  const opciones = {
    storage: "http://127.0.0.1:8084",
    media: "http://127.0.0.1:8083",
    soap: null,
    namespace: "http://192.168.1.195/soap",
    usuario: null,
    clave: null,
    token: null,
    limpiar: true,
  };

  for (let i = 2; i < argv.length; i++) {
    const clave = argv[i].replace(/^--/, "");
    if (clave === "sin-limpiar") { opciones.limpiar = false; continue; }
    if (clave === "ayuda" || clave === "help" || clave === "h") { opciones.ayuda = true; continue; }
    if (!(clave in opciones)) {
      console.error(`Opción desconocida: ${argv[i]}`);
      process.exit(2);
    }
    opciones[clave] = argv[++i];
  }
  return opciones;
}

// ------------------------------------------------------------------ informe

let total = 0;
let fallos = 0;
let omitidos = 0;
const pendientes = [];

function comprobar(nombre, condicion, detalle = "") {
  total++;
  if (condicion) {
    console.log(`  OK      ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLA   ${nombre}${detalle ? `\n            ${detalle}` : ""}`);
  }
  return condicion;
}

function omitir(nombre, motivo) {
  omitidos++;
  console.log(`  OMITIDA ${nombre}\n            ${motivo}`);
}

function seccion(titulo) {
  console.log(`\n=== ${titulo} ===`);
}

// -------------------------------------------------------------------- SOAP

function extraer(xml, etiqueta) {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`));
  return m ? m[1] : null;
}

function extraerLista(xml, etiqueta) {
  const patron = new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`, "g");
  return [...xml.matchAll(patron)].map((m) => m[1]).filter((v) => v !== "");
}

async function llamarSoap(url, namespace, operacion, campos) {
  const cuerpo = Object.entries(campos)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<${k}>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${k}>`)
    .join("");

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operacion} xmlns="${namespace}">${cuerpo}</${operacion}>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${namespace}/${operacion}` },
    body: sobre,
    signal: AbortSignal.timeout(10000),
  });

  return { estado: res.status, xml: await res.text() };
}

// ------------------------------------------------------------------- flujo

async function main() {
  const op = leerArgumentos(process.argv);

  if (op.ayuda) {
    console.log(require("fs").readFileSync(__filename, "utf8").split("*/")[0]);
    return;
  }

  console.log("Banco de pruebas del cliente móvil — UPB-CIENTÍFICA");
  console.log(`  Storage : ${op.storage}`);
  console.log(`  Media   : ${op.media}`);
  console.log(`  Auth    : ${op.soap || "(no se usa; token dado a mano)"}`);

  let token = op.token;

  // --------------------------------------------------------- 1. salud
  seccion("1. ¿Están arriba los servicios?");

  for (const [nombre, base] of [["Storage", op.storage], ["Media", op.media]]) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      const d = await r.json().catch(() => ({}));
      comprobar(`${nombre} responde /health`, r.ok && d.estado === "ok",
        `estado=${r.status} cuerpo=${JSON.stringify(d)}`);
      if (d.bd && d.bd !== "ok") {
        pendientes.push(`${nombre}: la base de datos no responde (${d.bd}).`);
      }
    } catch (e) {
      comprobar(`${nombre} responde /health`, false, `no contesta: ${e.message}`);
      pendientes.push(`${nombre} no está levantado en ${base}.`);
    }
  }

  // ------------------------------------------------- 2. autenticación SOAP
  if (op.soap) {
    seccion("2. Autenticación contra node-soap");

    // Lo que EXPONE node-soap hoy.
    try {
      const { xml } = await llamarSoap(op.soap, op.namespace, "iniciarSesion", {
        usuario: op.usuario, password: op.clave, origenCliente: "movil",
      });
      token = extraer(xml, "token");
      const ok = comprobar("iniciarSesion devuelve un token", Boolean(token),
        `respuesta: ${xml.slice(0, 200).replace(/\s+/g, " ")}`);
      if (ok) {
        comprobar("iniciarSesion devuelve uid, roles y grupos",
          Boolean(extraer(xml, "uid")) && extraerLista(xml, "grupos").length > 0,
          `uid=${extraer(xml, "uid")} roles=[${extraerLista(xml, "roles")}] grupos=[${extraerLista(xml, "grupos")}]`);
      }
    } catch (e) {
      comprobar("iniciarSesion responde", false, e.message);
      pendientes.push(`node-soap no responde en ${op.soap}. Si el certificado es propio, exporta NODE_EXTRA_CA_CERTS=/ruta/ca.crt`);
    }

    if (token) {
      const { xml } = await llamarSoap(op.soap, op.namespace, "validarToken", { token });
      comprobar("validarToken acepta el token recién emitido",
        extraer(xml, "valido") === "true", xml.slice(0, 200).replace(/\s+/g, " "));
    }

    // Lo que ESPERA el móvil según TRASPASO §3.4, que NO es lo mismo.
    seccion("2b. ¿Coincide con lo que el móvil espera? (TRASPASO §3.4)");
    const { xml: xmlLogin } = await llamarSoap(op.soap, op.namespace, "login", {
      usuario: op.usuario, contrasena: op.clave, origenCliente: "movil",
    }).catch(() => ({ xml: "" }));

    const tieneLogin = Boolean(extraer(xmlLogin, "token"));
    comprobar("node-soap expone la operación 'login' que usa la app", tieneLogin,
      "node-soap expone 'iniciarSesion(usuario, password, ...)'.\n" +
      "            La app espera      'login(usuario, contrasena, origenCliente)'.\n" +
      "            Hay que alinear una de las dos: ver el resumen al final.");

    if (!tieneLogin) {
      pendientes.push(
        "CONTRATO: la app llama login/logout y espera 'contrasena' y 'mapaServiciosAutorizados'.\n" +
        "   node-soap expone iniciarSesion/cerrarSesion con 'password' y devuelve roles+grupos.\n" +
        "   Mientras no se alineen, el LOGIN DE LA APP NO VA A FUNCIONAR contra node-soap real."
      );
    }
  } else {
    seccion("2. Autenticación");
    omitir("login contra node-soap",
      "no se pasó --soap; se usa el token dado con --token (modo simulado)");
  }

  if (!token) {
    console.log("\nSin token no se puede seguir. Usa --token o --soap/--usuario/--clave.");
    resumen();
    process.exit(1);
  }

  const cab = { Authorization: `Bearer ${token}` };
  const pedir = (url, opts = {}) =>
    fetch(url, { ...opts, headers: { ...cab, ...opts.headers }, signal: AbortSignal.timeout(15000) });

  // ------------------------------------------------- 3. Storage (RF-01..04)
  seccion("3. Distributed Storage — lo que la app usa para 'Mis archivos'");

  let idSubido = null;
  const nombreArchivo = `prueba-movil-${Date.now()}.txt`;
  const contenido = "contenido de prueba del cliente movil\n";

  // GET /storage/cuota
  try {
    const r = await pedir(`${op.storage}/storage/cuota`);
    const d = await r.json();
    comprobar("GET /storage/cuota", r.ok && typeof d.cuota === "number" && typeof d.usados === "number",
      `estado=${r.status} cuerpo=${JSON.stringify(d)}`);
  } catch (e) {
    comprobar("GET /storage/cuota", false, e.message);
  }

  // POST /storage/archivos (multipart)
  try {
    const form = new FormData();
    form.append("archivo", new Blob([contenido], { type: "text/plain" }), nombreArchivo);
    const r = await pedir(`${op.storage}/storage/archivos?directorioDestino=root`, {
      method: "POST", body: form,
    });
    const d = await r.json();
    idSubido = d.id;
    comprobar("POST /storage/archivos (subida multipart)", r.status === 201 && Boolean(d.id),
      `estado=${r.status} cuerpo=${JSON.stringify(d)}`);
    comprobar("el ArchivoDto trae los campos que la app lee",
      d.id !== undefined && d.nombre !== undefined && d.tipo !== undefined &&
      d.tamanoBytes !== undefined && d.version !== undefined &&
      "directorioContenedorId" in d,
      `faltan campos en: ${JSON.stringify(d)}`);
  } catch (e) {
    comprobar("POST /storage/archivos (subida multipart)", false, e.message);
  }

  // GET /storage/directorios/root
  try {
    const r = await pedir(`${op.storage}/storage/directorios/root`);
    const d = await r.json();
    const esArreglo = Array.isArray(d);
    comprobar("GET /storage/directorios/root devuelve un arreglo", esArreglo,
      `estado=${r.status} tipo=${esArreglo ? "arreglo" : typeof d} cuerpo=${JSON.stringify(d).slice(0, 160)}`);
    if (esArreglo && idSubido) {
      comprobar("el archivo recién subido aparece en el listado",
        d.some((n) => n.id === idSubido), `no se encontró ${idSubido} entre ${d.length} nodos`);
    }
  } catch (e) {
    comprobar("GET /storage/directorios/root", false, e.message);
  }

  // GET /storage/archivos/{id}/descargar
  if (idSubido) {
    try {
      const r = await pedir(`${op.storage}/storage/archivos/${idSubido}/descargar`);
      const texto = await r.text();
      comprobar("GET /storage/archivos/{id}/descargar devuelve el mismo contenido",
        r.ok && texto === contenido, `estado=${r.status} bytes=${texto.length}`);

      // Range: lo usa el reproductor de video de la app
      const r2 = await pedir(`${op.storage}/storage/archivos/${idSubido}/descargar`, {
        headers: { Range: "bytes=0-9" },
      });
      const parcial = await r2.text();
      comprobar("Storage admite Range (necesario para reproducir video)",
        r2.status === 206 && parcial.length === 10,
        `estado=${r2.status} content-range=${r2.headers.get("content-range")}`);
    } catch (e) {
      comprobar("descarga desde Storage", false, e.message);
    }
  } else {
    omitir("descarga desde Storage", "no se pudo subir el archivo de prueba");
  }

  // ------------------------------------------------- 4. Álbum y streaming
  seccion("4. Photo Album y Streaming — pestañas 'Fotos' y 'Videos'");

  try {
    const r = await pedir(`${op.media}/album/indexar`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    comprobar("POST /album/indexar (la app la dispara al entrar)", r.ok,
      `estado=${r.status} cuerpo=${JSON.stringify(d)}`);
    if (r.ok && d.revisados === 0) {
      pendientes.push("La indexación no encontró fotos ni videos: sube alguno a Storage para ver contenido.");
    }
  } catch (e) {
    comprobar("POST /album/indexar", false, e.message);
  }

  for (const [nombre, ruta] of [
    ["GET /album/fotos?pagina=0", `${op.media}/album/fotos?pagina=0`],
    ["GET /album/albumes", `${op.media}/album/albumes`],
    ["GET /streaming/catalogo?pagina=0", `${op.media}/streaming/catalogo?pagina=0`],
  ]) {
    try {
      const r = await pedir(ruta);
      const d = await r.json();
      comprobar(nombre, r.ok && Array.isArray(d),
        `estado=${r.status} cuerpo=${JSON.stringify(d).slice(0, 160)}`);
    } catch (e) {
      comprobar(nombre, false, e.message);
    }
  }

  // búsqueda: el contrato exige mínimo 2 caracteres
  try {
    const r = await pedir(`${op.media}/streaming/buscar?criterioTexto=pr`);
    comprobar("GET /streaming/buscar?criterioTexto=...", r.ok, `estado=${r.status}`);
  } catch (e) {
    comprobar("GET /streaming/buscar", false, e.message);
  }

  // sesión de reproducción: solo si hay algún video indexado
  try {
    const r = await pedir(`${op.media}/streaming/catalogo?pagina=0`);
    const videos = await r.json();
    if (Array.isArray(videos) && videos.length > 0) {
      const s = await pedir(`${op.media}/streaming/${videos[0].id}/sesion`);
      const d = await s.json();
      comprobar("GET /streaming/{id}/sesion devuelve sesionId y manifestUrl",
        s.ok && Boolean(d.sesionId) && Boolean(d.manifestUrl), JSON.stringify(d));
    } else {
      omitir("GET /streaming/{id}/sesion", "no hay videos indexados todavía");
    }
  } catch (e) {
    comprobar("GET /streaming/{id}/sesion", false, e.message);
  }

  // ------------------------------------------------- 5. lo que NO existe
  seccion("5. Lo que la app espera y todavía no existe");

  omitir("Shared File (/shared-file/compartir, /compartidos-conmigo)",
    "el servicio no está implementado en ninguna parte del repositorio");
  omitir("File Sync (gRPC 9090)",
    "es gRPC: se prueba con node-sync/examples/client, no desde aquí");

  // ------------------------------------------------- limpieza
  if (idSubido && op.limpiar) {
    try {
      const r = await pedir(`${op.storage}/storage/archivos/${idSubido}`, { method: "DELETE" });
      comprobar("DELETE /storage/archivos/{id} (limpieza)", r.status === 204, `estado=${r.status}`);
    } catch (e) {
      comprobar("limpieza del archivo de prueba", false, e.message);
    }
  }

  resumen();
  process.exit(fallos === 0 ? 0 : 1);
}

function resumen() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Comprobaciones: ${total}   fallos: ${fallos}   omitidas: ${omitidos}`);

  if (pendientes.length) {
    console.log("\nCosas a resolver antes de probar con la app:");
    for (const p of pendientes) console.log(` - ${p}`);
  }

  console.log(
    fallos === 0
      ? "\nEl backend responde lo que el móvil espera (salvo lo omitido)."
      : "\nHay fallos: arréglalos antes de depurar la app, o estarás buscando en el sitio equivocado."
  );
}

main().catch((e) => {
  console.error("\nError inesperado:", e);
  process.exit(1);
});
