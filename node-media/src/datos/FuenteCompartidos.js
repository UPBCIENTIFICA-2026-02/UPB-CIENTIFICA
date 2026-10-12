/**
 * Lo que Shared File Service dice que está compartido con el usuario
 * (ListarCompartidosConmigo, GET /shared-file/compartidos-conmigo).
 *
 * Contrato_Streaming, ListarCatalogo: "Dominio consulta metadatos multimedia
 * propios + compartidos vía Shared File Service". node-media no decide quién
 * comparte con quién: se lo pregunta al servicio que lo registra, con el token
 * del propio usuario (Shared File saca el destinatario del token).
 */
const { FuenteNoDisponible } = require("../dominio/errores");

const POR_PAGINA = 50;      // el de node-shared-file (ComparticionService.POR_PAGINA)
const MAX_PAGINAS = 40;     // tope de seguridad: 2000 comparticiones

class FuenteCompartidos {
  constructor(urlBase) {
    this.urlBase = urlBase.replace(/\/$/, "");
  }

  /** [{ elementoId, elementoTipo: "ARCHIVO"|"DIRECTORIO", nombre, propietario, ... }] */
  async compartidosConmigo(token) {
    const todos = [];
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      let res;
      try {
        res = await fetch(`${this.urlBase}/shared-file/compartidos-conmigo?pagina=${pagina}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        throw new FuenteNoDisponible(`no se pudo contactar a Shared File: ${e.message}`);
      }
      if (!res.ok) throw new FuenteNoDisponible(`Shared File respondió ${res.status}`);
      const lote = await res.json();
      if (!Array.isArray(lote)) throw new FuenteNoDisponible("Shared File devolvió algo que no es una lista");
      todos.push(...lote);
      if (lote.length < POR_PAGINA) break;
    }
    return todos;
  }
}

module.exports = FuenteCompartidos;
