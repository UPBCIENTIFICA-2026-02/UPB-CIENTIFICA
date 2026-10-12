/*
 * Datos de demostración.
 *
 * Se usan en dos casos, igual que en el móvil y el escritorio:
 *  1. Modo demostración ("Entrar en modo demostración"): toda la app funciona
 *     sin servidor, para presentar la interfaz.
 *  2. Servicios que todavía no existen en el backend (hoy: Shared File).
 *
 * Tienen EXACTAMENTE la forma de los contratos reales (ArchivoDto de
 * node-repository, JobResponse de job-api, etc.). Así, cuando un servicio
 * existe, se cambia la fuente y la interfaz no se entera.
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const latencia = () => espera(220 + Math.random() * 260);

// ----------------------------------------------------------------- Storage
let siguienteId = 100;
const nuevoId = () => `n-${siguienteId++}`;

/** Árbol plano: cada nodo sabe quién es su carpeta contenedora (null = raíz). */
const nodos = [
  { id: "d-proyectos", nombre: "Proyectos", tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: null },
  { id: "d-datasets", nombre: "Datasets", tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: null },
  { id: "d-fotos", nombre: "Fotos", tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: null },
  { id: "d-codigo", nombre: "Código MPI", tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: null },
  { id: "a-01", nombre: "dataset-2026.csv", tipo: "archivo", tamanoBytes: 240 * MB, version: 2, directorioContenedorId: null },
  { id: "a-02", nombre: "paper_borrador.pdf", tipo: "archivo", tamanoBytes: 2.4 * MB, version: 5, directorioContenedorId: null },
  { id: "a-03", nombre: "resultados.tar.gz", tipo: "archivo", tamanoBytes: 512 * MB, version: 1, directorioContenedorId: null },
  { id: "a-04", nombre: "presentacion-avance.pptx", tipo: "archivo", tamanoBytes: 8.2 * MB, version: 3, directorioContenedorId: null },
  { id: "a-05", nombre: "notas-reunion.md", tipo: "archivo", tamanoBytes: 6 * KB, version: 7, directorioContenedorId: null },
  { id: "d-flujo", nombre: "simulacion-flujo", tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: "d-proyectos" },
  { id: "a-06", nombre: "informe-avance.docx", tipo: "archivo", tamanoBytes: 1.2 * MB, version: 4, directorioContenedorId: "d-proyectos" },
  { id: "a-07", nombre: "mallado.msh", tipo: "archivo", tamanoBytes: 48 * MB, version: 1, directorioContenedorId: "d-flujo" },
  { id: "a-08", nombre: "parametros.json", tipo: "archivo", tamanoBytes: 4 * KB, version: 6, directorioContenedorId: "d-flujo" },
  { id: "a-09", nombre: "resultados.csv", tipo: "archivo", tamanoBytes: 12 * MB, version: 2, directorioContenedorId: "d-flujo" },
  { id: "a-10", nombre: "genoma-lote12.fasta", tipo: "archivo", tamanoBytes: 890 * MB, version: 1, directorioContenedorId: "d-datasets" },
  { id: "a-11", nombre: "temperaturas-santander.parquet", tipo: "archivo", tamanoBytes: 64 * MB, version: 1, directorioContenedorId: "d-datasets" },
  { id: "a-12", nombre: "montaje-cluster.jpg", tipo: "archivo", tamanoBytes: 3.1 * MB, version: 1, directorioContenedorId: "d-fotos" },
  { id: "a-13", nombre: "trapecio.c", tipo: "archivo", tamanoBytes: 18 * KB, version: 3, directorioContenedorId: "d-codigo" },
  { id: "a-14", nombre: "monte-carlo.c", tipo: "archivo", tamanoBytes: 22 * KB, version: 2, directorioContenedorId: "d-codigo" },
  { id: "a-15", nombre: "Makefile", tipo: "archivo", tamanoBytes: 1 * KB, version: 1, directorioContenedorId: "d-codigo" },
];
const CUOTA = 5 * GB;

export const almacenamientoDemo = {
  async listar(directorioId) {
    await latencia();
    const padre = directorioId === "root" ? null : directorioId;
    return nodos.filter((n) => n.directorioContenedorId === padre).map((n) => ({ ...n }));
  },
  async cuota() {
    await latencia();
    const usados = Math.round(nodos.reduce((s, n) => s + n.tamanoBytes, 0));
    return { usados, cuota: CUOTA, disponibles: Math.max(0, CUOTA - usados) };
  },
  async subir(archivo, directorioId, alProgresar) {
    for (let p = 0; p <= 1.0001; p += 0.2) {
      alProgresar?.(Math.min(p, 1));
      await espera(160);
    }
    const padre = directorioId === "root" ? null : directorioId;
    const existente = nodos.find((n) => n.directorioContenedorId === padre && n.nombre === archivo.name);
    if (existente) {
      existente.version += 1;
      existente.tamanoBytes = archivo.size;
      return { ...existente };
    }
    const nodo = { id: nuevoId(), nombre: archivo.name, tipo: "archivo", tamanoBytes: archivo.size, version: 1, directorioContenedorId: padre };
    nodos.push(nodo);
    return { ...nodo };
  },
  async crearCarpeta(nombre, directorioPadreId) {
    await latencia();
    const nodo = { id: nuevoId(), nombre, tipo: "directorio", tamanoBytes: 0, version: 1, directorioContenedorId: directorioPadreId === "root" ? null : directorioPadreId };
    nodos.push(nodo);
    return { ...nodo };
  },
  async eliminar(id) {
    await latencia();
    const i = nodos.findIndex((n) => n.id === id);
    if (i >= 0) nodos.splice(i, 1);
  },
  async descargar(archivo) {
    await latencia();
    return new Blob(
      [`Archivo de demostración: ${archivo.nombre}\nEn el despliegue real este contenido lo entrega node-repository.\n`],
      { type: "text/plain" }
    );
  },
};

// --------------------------------------------------------------- Shared File
// Misma forma que RelacionCompartido de node-shared-file (solo modo demostración).
const relacionDemo = (compartidoId, nombre, propietario, nivelPermiso, destinatarioId, elementoTipo = "ARCHIVO") => ({
  compartidoId, elementoId: `demo-${compartidoId}`, elementoTipo, nombre, tamanoBytes: 1_250_000,
  propietario, compartidoPor: propietario, destinatarioTipo: "USUARIO", destinatarioId,
  nivelPermiso, estadoInvitacion: "ACTIVO", fechaCompartido: "2026-10-01T15:00:00Z", fechaExpiracion: null,
});
const compartidosConmigoDemo = [
  relacionDemo("s1", "paper_borrador.docx", "maria.lopez", "LECTURA", "demo"),
  relacionDemo("s2", "dataset_compartido.zip", "carlos.ruiz", "LECTURA_ESCRITURA", "demo"),
  relacionDemo("s3", "guia-laboratorio-mpi.pdf", "angie.villareal", "LECTURA", "demo"),
];
let queCompartoDemo = [relacionDemo("s4", "Resultados", "demo", "LECTURA", "maria.lopez", "DIRECTORIO")];

export const compartidosDemo = {
  async compartidosConmigo() {
    await latencia();
    return compartidosConmigoDemo.map((c) => ({ ...c }));
  },
  async queYoComparto() {
    await latencia();
    return queCompartoDemo.map((c) => ({ ...c }));
  },
  async compartir(elemento, destinatarioTipo, destinatarioId, nivelPermiso) {
    await latencia();
    const r = { ...relacionDemo(`demo-${Date.now()}`, elemento.nombre, "demo", nivelPermiso, destinatarioId,
      elemento.tipo === "directorio" ? "DIRECTORIO" : "ARCHIVO"), destinatarioTipo };
    queCompartoDemo = [r, ...queCompartoDemo];
    return { compartidoId: r.compartidoId, estadoInvitacion: "ACTIVO" };
  },
  async cambiarNivel(id, nivel) {
    await latencia();
    queCompartoDemo = queCompartoDemo.map((r) => (r.compartidoId === id ? { ...r, nivelPermiso: nivel } : r));
    return { compartidoId: id, nivelPermiso: nivel, advertencia: null };
  },
  async revocar(id) {
    await latencia();
    queCompartoDemo = queCompartoDemo.filter((r) => r.compartidoId !== id);
  },
};

// ------------------------------------------------------------- Photo Album
const PALETAS = [
  ["#1A5BC0", "#4FD8E3"], ["#7A4E9C", "#E37400"], ["#006970", "#9AE6B4"],
  ["#C5221F", "#F6AE2D"], ["#2E3A59", "#8E9CC9"], ["#004494", "#AFC6FF"],
];

/** Miniatura dibujada en SVG: un paisaje simple con los colores de la paleta. */
function miniaturaSvg(semilla) {
  const [a, b] = PALETAS[semilla % PALETAS.length];
  const sol = 30 + ((semilla * 37) % 50);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="320" height="320" fill="url(#g)"/>
    <circle cx="${200 + (semilla % 3) * 20}" cy="${sol + 40}" r="34" fill="#fff" opacity=".55"/>
    <path d="M0 250 L90 ${150 + (semilla % 4) * 12} L170 230 L240 ${170 + (semilla % 5) * 8} L320 240 L320 320 L0 320Z" fill="#000" opacity=".22"/>
    <path d="M0 280 L120 220 L210 270 L320 230 L320 320 L0 320Z" fill="#000" opacity=".3"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const titulosFotos = [
  "Montaje del clúster", "Rack de nodos", "Laboratorio CCA", "Equipo UPB-Científica",
  "Pruebas de red", "Visualización CFD", "Mapa de calor", "Microscopía muestra 3",
  "Campus Floridablanca", "Cableado del switch", "Sustentación de avance", "Simulación de partículas",
  "Diagrama en pizarra", "Atardecer en el campus",
];
const fotos = titulosFotos.map((titulo, i) => ({
  id: `f-${i + 1}`,
  titulo,
  tipo: "foto",
  tamanoBytes: Math.round((1.2 + (i % 5) * 0.7) * MB),
  ancho: 4032,
  alto: 3024,
  tieneMiniatura: true,
  fecha: new Date(Date.now() - (i * 3 + 1) * 86_400_000).toISOString(),
}));
const albumes = [
  { id: "al-1", nombre: "Clúster HPC", descripcion: "Montaje y pruebas del clúster del laboratorio", fotos: ["f-1", "f-2", "f-10"], creadoEn: new Date(Date.now() - 9 * 86_400_000).toISOString() },
  { id: "al-2", nombre: "Eventos", descripcion: "Sustentaciones y reuniones", fotos: ["f-4", "f-11"], creadoEn: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

export const albumDemo = {
  async fotos() {
    await latencia();
    return fotos.map((f) => ({ ...f }));
  },
  async urlMiniatura(foto) {
    return miniaturaSvg(Number(foto.id.split("-")[1]));
  },
  async urlContenido(foto) {
    return miniaturaSvg(Number(foto.id.split("-")[1]));
  },
  async indexar() {
    await espera(900);
    return { indexados: 0, mensaje: "Índice al día" };
  },
  async albumes() {
    await latencia();
    return albumes.map((a) => ({ id: a.id, nombre: a.nombre, descripcion: a.descripcion, totalFotos: a.fotos.length, creadoEn: a.creadoEn }));
  },
  async verAlbum(id) {
    await latencia();
    const a = albumes.find((x) => x.id === id);
    return { id: a.id, nombre: a.nombre, descripcion: a.descripcion, fotos: fotos.filter((f) => a.fotos.includes(f.id)) };
  },
  async crearAlbum(nombre, descripcion) {
    await latencia();
    const a = { id: `al-${Date.now()}`, nombre, descripcion, fotos: [], creadoEn: new Date().toISOString() };
    albumes.push(a);
    return { id: a.id, nombre, descripcion };
  },
  async agregarFoto(albumId, medioId) {
    await latencia();
    const a = albumes.find((x) => x.id === albumId);
    if (a && !a.fotos.includes(medioId)) a.fotos.push(medioId);
  },
  async quitarFoto(albumId, medioId) {
    await latencia();
    const a = albumes.find((x) => x.id === albumId);
    if (a) a.fotos = a.fotos.filter((f) => f !== medioId);
  },
};

// ---------------------------------------------------------------- Streaming
// Los tres del móvil (StreamingRepository.datosSimulados) y algunos más.
const videos = [
  { id: "v1", titulo: "Presentación proyecto UPB", duracionSegundos: 320 },
  { id: "v2", titulo: "Demo del clúster HPC", duracionSegundos: 540 },
  { id: "v3", titulo: "Charla resultados 2026", duracionSegundos: 1260 },
  { id: "v4", titulo: "Tutorial: enviar un trabajo MPI", duracionSegundos: 412 },
  { id: "v5", titulo: "Sincronización de archivos desde el móvil", duracionSegundos: 198 },
  { id: "v6", titulo: "Sustentación de avance · semana 8", duracionSegundos: 2715 },
].map((v, i) => ({ ...v, fecha: new Date(Date.now() - (i * 4 + 2) * 86_400_000).toISOString() }));

export const streamingDemo = {
  async catalogo() {
    await latencia();
    return videos.map((v) => ({ ...v }));
  },
  async sesion(id) {
    await latencia();
    return { sesionId: `mock-sesion-${id}`, manifestUrl: null };
  },
};

// --------------------------------------------------------------------- HPC
/*
 * Igual que HpcRepository.kt del móvil: el estado de cada trabajo se deduce
 * del tiempo que lleva enviado (en cola unos segundos, luego ejecutando,
 * luego terminado), así la pantalla "ve avanzar" los trabajos al consultar.
 * La forma es la de JobResponse del job-api real (RMIUPBCientifica).
 */
const MIN = 60_000;
const HORA = 60 * MIN;
const registros = (() => {
  const ahora = Date.now();
  const r = (id, nombre, fuente, dataset, procesos, prioridad, haceMs, colaMs, duracionMs, falla = false) =>
    ({ id, nombre, rutaCodigoFuente: fuente, rutaDataset: dataset, numeroProcesos: procesos, prioridad, enviado: ahora - haceMs, colaMs, duracionMs, falla, cancelado: null });
  return [
    r("7f3c2a91-1039", "Dinámica molecular · proteína 4HHB", "/Código MPI/gromacs-md.c", "/Datasets/4hhb.pdb", 32, 7, 3 * HORA, 20_000, 2 * HORA),
    r("9b81d4e2-1040", "Integral por trapecios · 10⁹ pasos", "/Código MPI/trapecio.c", "/dataset-2026.csv", 16, 5, HORA, 10_000, 25 * MIN, true),
    r("c04e7718-1041", "Simulación CFD · túnel de viento", "/Proyectos/simulacion-flujo/mallado.msh", "/Proyectos/simulacion-flujo/parametros.json", 64, 8, 40_000, 5_000, 150_000),
    r("e5a90b3c-1042", "Análisis genómico · lote 12", "/Código MPI/monte-carlo.c", "/Datasets/genoma-lote12.fasta", 16, 5, 2_000, 25_000, 90_000),
  ];
})();

function aJobResponse(reg, ahora = Date.now()) {
  const enEjecucion = ahora - reg.enviado - reg.colaMs;
  let estado;
  if (reg.cancelado) estado = "CANCELLED";
  else if (enEjecucion < 0) estado = "QUEUED";
  else if (enEjecucion < reg.duracionMs) estado = "RUNNING";
  else estado = reg.falla ? "FAILED" : "COMPLETED";
  const inicio = enEjecucion >= 0 ? new Date(reg.enviado + reg.colaMs).toISOString() : null;
  const terminado = ["COMPLETED", "FAILED"].includes(estado);
  return {
    id: reg.id,
    propietario: "demo",
    nombre: reg.nombre,
    rutaCodigoFuente: reg.rutaCodigoFuente,
    rutaDataset: reg.rutaDataset,
    numeroProcesos: reg.numeroProcesos,
    prioridad: reg.prioridad,
    estado,
    fechaCreacion: new Date(reg.enviado).toISOString(),
    fechaInicio: inicio,
    fechaFin: terminado ? new Date(reg.enviado + reg.colaMs + reg.duracionMs).toISOString() : reg.cancelado ? new Date(reg.cancelado).toISOString() : null,
    rutaResultados: estado === "COMPLETED" ? `/trabajos/${reg.id}/salida/` : null,
    resultadoResumen: estado === "COMPLETED" ? `mpirun -np ${reg.numeroProcesos} terminó con código 0` : null,
    mensajeError: estado === "FAILED" ? "mpirun terminó con código 1: proceso 7 abortó (MPI_ERR_COMM)" : null,
    // Solo para el modo demo: el contrato real no expone avance.
    _progreso: estado === "RUNNING" ? enEjecucion / reg.duracionMs : null,
  };
}

export const hpcDemo = {
  async trabajos() {
    await espera(150);
    const ahora = Date.now();
    return registros.map((r) => aJobResponse(r, ahora)).sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  },
  async estadoCluster() {
    await espera(100);
    const t = Date.now() / 20_000;
    const carga = 0.45 + 0.25 * Math.sin(t);
    return {
      nodosVivos: ["hpc-worker-1", "hpc-worker-2", "hpc-worker-3", "hpc-worker-4"],
      nodosEsperados: 4,
      cargaPromedio: Math.max(0, Math.min(1, carga)),
      clusterCompleto: true,
      consultadoEn: new Date().toISOString(),
    };
  },
  async enviar(solicitud) {
    await espera(700);
    const id = `${Math.random().toString(16).slice(2, 10)}-${1043 + registros.length - 4}`;
    registros.push({
      id, nombre: solicitud.nombre, rutaCodigoFuente: solicitud.rutaCodigoFuente, rutaDataset: solicitud.rutaDataset,
      numeroProcesos: solicitud.numeroProcesos, prioridad: solicitud.prioridad, enviado: Date.now(),
      colaMs: 5_000 + Math.random() * 7_000, duracionMs: 45_000 + Math.random() * 45_000, falla: false, cancelado: null,
    });
    return { id };
  },
  async cancelar(id) {
    await latencia();
    const r = registros.find((x) => x.id === id);
    if (r) r.cancelado = Date.now();
    return { id, cancelado: true };
  },
};
