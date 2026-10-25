/**
 * Clientes REST delgados, uno por contrato. Solo arman la URL y la petición;
 * las comprobaciones viven en las suites.
 *
 * Rutas verificadas contra el código (rutas/ y controller/) y las adendas:
 *   Storage      node-repository/src/rutas/almacenamiento.js
 *   Shared File  node-shared-file/src/rutas/compartidos.js
 *   Media        node-media/src/rutas/album.js, streaming.js
 *   HPC          RMIUPBCientifica/job-api/.../TrabajoController.java, ClusterController.java
 */
const { pedir, formularioArchivo } = require("./http");

const enc = encodeURIComponent;
const consulta = (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
    const s = q.toString();
    return s ? `?${s}` : "";
};

function storage(cfg, token) {
    const b = `${cfg.storage.api}/storage`;
    return {
        cuota: () => pedir(`${b}/cuota`, { token }),
        listar: (id = "root") => pedir(`${b}/directorios/${enc(id)}`, { token }),
        crearDirectorio: (nombre, padre = "root", extra = {}) =>
            pedir(`${b}/directorios`, { metodo: "POST", token, json: { nombre, directorioPadreId: padre, ...extra } }),
        subir: (nombre, contenido, { destino = "root", sobrescribir = false, tipo } = {}) =>
            pedir(`${b}/archivos${consulta({ directorioDestino: destino, sobrescribir: sobrescribir ? "true" : undefined })}`,
                { metodo: "POST", token, formulario: formularioArchivo(nombre, contenido, tipo) }),
        descargar: (id, rango) =>
            pedir(`${b}/archivos/${enc(id)}/descargar`, { token, cabeceras: rango ? { Range: rango } : {} }),
        eliminar: (id) => pedir(`${b}/archivos/${enc(id)}`, { metodo: "DELETE", token }),
        nodo: (id) => pedir(`${b}/nodos/${enc(id)}`, { token }),
        otorgar: (id, acceso) => pedir(`${b}/nodos/${enc(id)}/accesos`, { metodo: "PUT", token, json: acceso }),
        revocar: (id, tipo, destinatario) =>
            pedir(`${b}/nodos/${enc(id)}/accesos/${enc(tipo)}/${enc(destinatario)}`, { metodo: "DELETE", token }),

        /** Busca por nombre dentro de un directorio; null si no está. */
        async buscar(directorioId, nombre) {
            const r = await pedir(`${b}/directorios/${enc(directorioId)}`, { token });
            return Array.isArray(r.json) ? r.json.find((n) => n.nombre === nombre) || null : null;
        },
    };
}

function compartidos(cfg, token) {
    const b = `${cfg.compartidos.api}/shared-file`;
    return {
        compartir: (cuerpo) => pedir(`${b}/compartir`, { metodo: "POST", token, json: cuerpo }),
        compartirDirectorio: (cuerpo) => pedir(`${b}/compartir-directorio`, { metodo: "POST", token, json: cuerpo }),
        actualizar: (id, nuevoNivelPermiso) =>
            pedir(`${b}/compartir/${enc(id)}`, { metodo: "PATCH", token, json: { nuevoNivelPermiso } }),
        revocar: (id) => pedir(`${b}/compartir/${enc(id)}`, { metodo: "DELETE", token }),
        revocarElemento: (elementoId, destinatarioTipo, destinatarioId) =>
            pedir(`${b}/compartir${consulta({ elementoId, destinatarioTipo, destinatarioId })}`, { metodo: "DELETE", token }),
        conmigo: (pagina) => pedir(`${b}/compartidos-conmigo${consulta({ pagina })}`, { token }),
        queComparto: (pagina) => pedir(`${b}/que-yo-comparto${consulta({ pagina })}`, { token }),
        permisos: (elementoId) => pedir(`${b}/permisos-efectivos/${enc(elementoId)}`, { token }),
        home: () => pedir(`${b}/home`, { token }),
        contenidoHome: () => pedir(`${b}/home/contenido`, { token }),
        cuota: () => pedir(`${b}/cuota`, { token }),
    };
}

function medios(cfg, token) {
    const a = `${cfg.medios.api}/album`;
    const s = `${cfg.medios.api}/streaming`;
    return {
        indexar: () => pedir(`${a}/indexar`, { metodo: "POST", token, tiempoMs: 120000 }),
        fotos: (params) => pedir(`${a}/fotos${consulta(params)}`, { token, tiempoMs: 120000 }),
        buscarFotos: (criterioTexto, ordenPor) => pedir(`${a}/fotos/buscar${consulta({ criterioTexto, ordenPor })}`, { token }),
        foto: (id) => pedir(`${a}/fotos/${enc(id)}`, { token }),
        miniaturaFoto: (id) => pedir(`${a}/fotos/${enc(id)}/miniatura`, { token }),
        contenidoFoto: (id) => pedir(`${a}/fotos/${enc(id)}/contenido`, { token }),
        eliminarFoto: (id) => pedir(`${a}/fotos/${enc(id)}`, { metodo: "DELETE", token }),
        albumes: () => pedir(`${a}/albumes`, { token }),
        crearAlbum: (nombre, descripcion) => pedir(`${a}/albumes`, { metodo: "POST", token, json: { nombre, descripcion } }),
        verAlbum: (id) => pedir(`${a}/albumes/${enc(id)}`, { token }),
        agregarFoto: (id, medioId, orden) =>
            pedir(`${a}/albumes/${enc(id)}/fotos`, { metodo: "POST", token, json: { medioId, orden } }),
        quitarFoto: (id, medioId) => pedir(`${a}/albumes/${enc(id)}/fotos/${enc(medioId)}`, { metodo: "DELETE", token }),
        eliminarAlbum: (id) => pedir(`${a}/albumes/${enc(id)}`, { metodo: "DELETE", token }),

        catalogo: (params) => pedir(`${s}/catalogo${consulta(params)}`, { token, tiempoMs: 120000 }),
        buscarVideos: (criterioTexto, ordenPor) => pedir(`${s}/buscar${consulta({ criterioTexto, ordenPor })}`, { token }),
        sesion: (id) => pedir(`${s}/${enc(id)}/sesion`, { token }),
        contenidoVideo: (id, rango) =>
            pedir(`${s}/${enc(id)}/contenido`, { token, cabeceras: rango ? { Range: rango } : {}, tiempoMs: 60000 }),
        miniaturaVideo: (id) => pedir(`${s}/${enc(id)}/miniatura`, { token }),
        eliminarVideo: (id) => pedir(`${s}/${enc(id)}`, { metodo: "DELETE", token }),
    };
}

function hpc(cfg, token) {
    const b = cfg.hpc.api;
    return {
        enviar: (cuerpo) => pedir(`${b}/jobs`, { metodo: "POST", token, json: cuerpo }),
        listar: (estado) => pedir(`${b}/jobs${consulta({ estado })}`, { token }),
        consultar: (id) => pedir(`${b}/jobs/${enc(id)}`, { token }),
        estado: (id) => pedir(`${b}/jobs/${enc(id)}/estado`, { token }),
        resultado: (id) => pedir(`${b}/jobs/${enc(id)}/resultado`, { token }),
        logs: (id) => pedir(`${b}/jobs/${enc(id)}/logs`, { token }),
        cancelar: (id) => pedir(`${b}/jobs/${enc(id)}`, { metodo: "DELETE", token }),
        prioridad: (id, nuevaPrioridad) =>
            pedir(`${b}/jobs/${enc(id)}/prioridad`, { metodo: "PUT", token, json: { nuevaPrioridad } }),
        reintentar: (id) => pedir(`${b}/jobs/${enc(id)}/reintento`, { metodo: "POST", token }),
        cluster: () => pedir(`${b}/cluster/estado`, { token }),
    };
}

module.exports = { storage, compartidos, medios, hpc };
