/**
 * Patrón Strategy para la validación de token.
 *
 * Authentication Service (node-soap) todavía no existe, así que el servicio
 * arranca con el validador SIMULADO y se cambia a SOAP con una variable de
 * entorno, sin tocar el resto del código.
 */

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
}

/**
 * TODO (cuando node-soap esté listo): invocar la operación validarToken del WSDL
 * y mapear la respuesta a { id, roles, grupos }.
 *
 * >>> NOTA PARA EL RESPONSABLE DE AUTHENTICATION SERVICE <
 * Este servicio necesita que validarToken(token) devuelva, además de si el token
 * es válido: el identificador del usuario, sus roles y sus grupos. Los grupos son
 * imprescindibles para evaluar los permisos Unix del segmento "grupo".
 *
 * Recomendación de rendimiento: cachear el resultado unos segundos. La propuesta
 * de arquitectura advierte que validar contra Auth en CADA petición convierte al
 * Authentication Service en un cuello de botella.
 */
class ValidadorSoap extends ValidadorToken {
    constructor(urlServicio, namespace) {
        super();
        this.urlServicio = urlServicio;
        this.namespace = namespace;
    }

    async validar(_token) {
        throw new Error(
        "ValidadorSoap pendiente: implementar cuando node-soap publique su WSDL"
        );
    }
}

function crearValidador(config) {
    if (config.modoAutenticacion === "soap") {
        return new ValidadorSoap(config.urlAuthSoap, config.namespaceAuth);
    }
    return new ValidadorSimulado();
}

module.exports = { ValidadorToken, ValidadorSimulado, ValidadorSoap, crearValidador };