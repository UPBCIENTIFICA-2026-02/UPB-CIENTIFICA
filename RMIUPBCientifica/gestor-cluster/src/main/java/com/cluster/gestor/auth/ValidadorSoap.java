package com.cluster.gestor.auth;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Valida el token contra la operación {@code validarToken} del WSDL de
 * node-soap.
 *
 * Se construye el sobre SOAP a mano con el {@code HttpClient} del JDK para no
 * añadir dependencias (JAX-WS ya no viene en el JDK desde Java 11). Es una sola
 * operación con dos campos de entrada; un stack SOAP completo no se justifica.
 *
 * CACHÉ: la propuesta de arquitectura advierte que validar contra Auth en cada
 * invocación convierte al Authentication Service en un cuello de botella. Se
 * cachea unos segundos: es el tiempo máximo que un token revocado seguiría
 * siendo aceptado.
 */
public class ValidadorSoap implements ValidadorToken {

    private record EnCache(Usuario usuario, Instant vence) {
    }

    private final URI endpoint;
    private final String namespace;
    private final Duration ttlCache;
    private final HttpClient cliente;
    private final Map<String, EnCache> cache = new ConcurrentHashMap<>();

    public ValidadorSoap(String endpoint, String namespace, Duration ttlCache) {
        this.endpoint = URI.create(endpoint);
        this.namespace = namespace;
        this.ttlCache = ttlCache;
        this.cliente = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    @Override
    public Usuario validar(String token) throws AuthNoDisponibleException {
        if (token == null || token.isBlank()) {
            return null;
        }

        EnCache enCache = cache.get(token);
        if (enCache != null) {
            if (Instant.now().isBefore(enCache.vence())) {
                return enCache.usuario();   // puede ser null: también se cachea el rechazo
            }
            cache.remove(token);
        }

        String xml = invocar(token);

        if (!"true".equals(extraer(xml, "valido"))) {
            guardar(token, null);
            return null;
        }

        String uid = extraer(xml, "uid");
        if (uid == null || uid.isBlank()) {
            // valido=true sin uid es un contrato roto, no un token malo.
            throw new AuthNoDisponibleException("node-soap devolvió valido=true sin uid");
        }

        Usuario usuario = new Usuario(uid, extraerLista(xml, "roles"), extraerLista(xml, "grupos"));
        guardar(token, usuario);
        return usuario;
    }

    private void guardar(String token, Usuario usuario) {
        // Tope simple para que la caché no crezca sin límite.
        if (cache.size() > 1000) {
            cache.clear();
        }
        cache.put(token, new EnCache(usuario, Instant.now().plus(ttlCache)));
    }

    private String invocar(String token) throws AuthNoDisponibleException {
        String cuerpo = """
                <?xml version="1.0" encoding="UTF-8"?>
                <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
                  <soap:Body>
                    <validarToken xmlns="%s">
                      <token>%s</token>
                    </validarToken>
                  </soap:Body>
                </soap:Envelope>""".formatted(namespace, escapar(token));

        HttpRequest peticion = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "text/xml; charset=utf-8")
                .header("SOAPAction", namespace + "/validarToken")
                .POST(HttpRequest.BodyPublishers.ofString(cuerpo))
                .build();

        HttpResponse<String> respuesta;
        try {
            respuesta = cliente.send(peticion, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AuthNoDisponibleException("interrumpido al consultar Auth", e);
        } catch (Exception e) {
            throw new AuthNoDisponibleException(e.getMessage(), e);
        }

        if (respuesta.statusCode() != 200) {
            throw new AuthNoDisponibleException("node-soap respondió " + respuesta.statusCode());
        }

        return respuesta.body();
    }

    /*
     * PHP SoapServer devuelve prefijos de namespace que cambian entre peticiones
     * (ns1:, SOAP-ENV:...), así que los patrones los ignoran.
     */
    private static String extraer(String xml, String etiqueta) {
        Matcher m = patron(etiqueta).matcher(xml);
        return m.find() ? m.group(1) : null;
    }

    private static List<String> extraerLista(String xml, String etiqueta) {
        Matcher m = patron(etiqueta).matcher(xml);
        List<String> valores = new ArrayList<>();
        while (m.find()) {
            if (!m.group(1).isEmpty()) {
                valores.add(m.group(1));
            }
        }
        return valores;
    }

    private static Pattern patron(String etiqueta) {
        return Pattern.compile("<(?:[\\w.-]+:)?" + Pattern.quote(etiqueta) + "[^>]*>([^<]*)<");
    }

    private static String escapar(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
