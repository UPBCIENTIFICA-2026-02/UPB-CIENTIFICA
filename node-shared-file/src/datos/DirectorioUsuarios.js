/**
 * Consulta a Authentication sobre OTROS usuarios (no sobre el que pregunta:
 * eso es el ValidadorToken). Patrón Strategy, igual que el validador:
 *
 *   DirectorioSimulado -> desarrollo sin node-soap: acepta cualquier nombre
 *                         con formato de usuario.
 *   DirectorioSoap     -> operación obtenerUsuario de users.wsdl.
 *
 * Se usa para SHR-003 ("el destinatario no existe"). Los GRUPOS no se
 * comprueban: users.wsdl no tiene una operación para eso y el contrato admite
 * compartir con un grupo sin miembros (caso límite, §8).
 */
const { ServicioAuthNoDisponible } = require("../dominio/errores");

const FORMATO_USUARIO = /^[A-Za-z0-9._-]{1,64}$/;

class DirectorioUsuarios {
    constructor(plantillaHome) {
        this.plantillaHome = plantillaHome;
    }

    async existeUsuario(_uid) {
        throw new Error("No implementado");
    }

    /**
     * Ruta del Home. El contrato dice que sale de Authentication.
     *
     * ANTES: siempre la convención (/srv/home/<uid>), porque node-soap no la
     * publicaba. AHORA (D3) DirectorioSoap la pide a obtenerUsuario, que
     * devuelve el homeDirectory de LDAP; la convención queda solo como respaldo
     * (modo simulado, o una entrada sin homeDirectory).
     */
    async homeDe(uid) {
        return this.plantillaHome.replace("{uid}", uid);
    }
}

class DirectorioSimulado extends DirectorioUsuarios {
    async existeUsuario(uid) {
        return FORMATO_USUARIO.test(uid || "");
    }
}

class DirectorioSoap extends DirectorioUsuarios {
    constructor(urlServicio, namespace, plantillaHome) {
        super(plantillaHome);
        this.urlServicio = urlServicio;
        this.namespace = namespace;
    }

    async existeUsuario(uid) {
        if (!FORMATO_USUARIO.test(uid || "")) return false;
        return (await this.#obtenerUsuario(uid)).existe;
    }

    /** homeDirectory del directorio; si no lo trae, la convención. */
    async homeDe(uid) {
        if (FORMATO_USUARIO.test(uid || "")) {
            const { home } = await this.#obtenerUsuario(uid);
            if (home) return home;
        }
        return super.homeDe(uid);
    }

    /** Operación obtenerUsuario de users.wsdl: { existe, home }. */
    async #obtenerUsuario(uid) {
        // Hijos sin namespace (elementFormDefault unqualified), como en el ValidadorSoap.
        const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:obtenerUsuario xmlns:ns="${this.namespace}">
      <usuario>${uid}</usuario>
    </ns:obtenerUsuario>
  </soap:Body>
</soap:Envelope>`;
        let respuesta;
        try {
            respuesta = await fetch(this.urlServicio, {
                method: "POST",
                headers: {
                    "Content-Type": "text/xml; charset=utf-8",
                    SOAPAction: `${this.namespace}/obtenerUsuario`,
                },
                body: sobre,
                signal: AbortSignal.timeout(5000),
            });
        } catch (e) {
            throw new ServicioAuthNoDisponible(e.message);
        }
        if (!respuesta.ok) throw new ServicioAuthNoDisponible(`node-soap respondió ${respuesta.status}`);
        const xml = await respuesta.text();
        const valor = (etiqueta) => xml.match(new RegExp(`<(?:[\\w.-]+:)?${etiqueta}[^>]*>([^<]*)<`))?.[1];
        return { existe: valor("success") === "true", home: valor("homeDirectory") || null };
    }
}

function crearDirectorio(config) {
    if (config.modoDirectorio === "soap") {
        if (!config.urlAuthSoap) throw new Error("MODO_DIRECTORIO=soap requiere URL_AUTH_SOAP");
        return new DirectorioSoap(config.urlAuthSoap, config.namespaceAuth, config.plantillaHome);
    }
    return new DirectorioSimulado(config.plantillaHome);
}

module.exports = { DirectorioUsuarios, DirectorioSimulado, DirectorioSoap, crearDirectorio };
