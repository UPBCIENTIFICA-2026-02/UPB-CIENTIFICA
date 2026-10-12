/**
 * Eventos del contrato (§5): ArchivoCompartido, ComparticionRevocada.
 *
 * Sus consumidores (Monitoring Service, notificaciones al cliente) todavía no
 * existen, así que se escriben como una línea JSON en el registro del
 * servicio (journalctl -u shared-file-svc). Cuando haya consumidor, se cambia
 * esta clase y el dominio no se entera.
 */
class EmisorEventos {
    emitir(nombre, datos) {
        console.log(JSON.stringify({ evento: nombre, en: new Date().toISOString(), ...datos }));
    }
}

module.exports = EmisorEventos;
