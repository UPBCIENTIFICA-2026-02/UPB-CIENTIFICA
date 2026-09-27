package com.cluster.api;

import com.cluster.gestor.JobServiceImpl;
import com.cluster.common.JobService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Prueba de integración real de extremo a extremo: levanta un
 * gestor-cluster (RMI Registry + JobServiceImpl exportado en el puerto 2100)
 * embebido dentro del propio proceso de pruebas, y verifica que job-api,
 * arrancado como aplicación Spring Boot completa, sea capaz de recibir una
 * petición HTTP real y completarla a través de una invocación RMI real
 * (sin mocks) contra ese servidor.
 *
 * Usa un puerto de Registry alternativo (11099) para no colisionar con una
 * instancia real de gestor-cluster que pudiera estar corriendo en la máquina
 * de desarrollo durante la ejecución de `mvn test`.
 *
 * El JobServiceImpl embebido usa su constructor sin argumentos, que instala el
 * validador SIMULADO: por eso los tokens de aquí tienen la forma
 * "mock-token-<uid>-...". Con el validador SOAP haría falta node-soap levantado,
 * que no es lo que esta prueba quiere ejercitar.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "rmi.gestor.registryPort=11099"
        }
)
class HttpToRmiIntegrationTest {

    private static Registry registry;
    private static JobServiceImpl implementacion;
    private static final int PUERTO_REGISTRY_PRUEBA = 11099;
    private static final int PUERTO_OBJETO_REMOTO_PRUEBA = 12100;

    private static final String TOKEN = "mock-token-jperez-e2e";
    private static final String TOKEN_OTRO = "mock-token-otrousuario-e2e";

    @Autowired
    private TestRestTemplate restTemplate;

    @BeforeAll
    static void iniciarGestorClusterEmbebido() throws Exception {
        registry = LocateRegistry.createRegistry(PUERTO_REGISTRY_PRUEBA);
        implementacion = new JobServiceImpl();
        JobService stub = (JobService) UnicastRemoteObject.exportObject(implementacion, PUERTO_OBJETO_REMOTO_PRUEBA);
        registry.rebind("JobService", stub);
    }

    @AfterAll
    static void detenerGestorClusterEmbebido() throws Exception {
        registry.unbind("JobService");
        UnicastRemoteObject.unexportObject(implementacion, true);
        implementacion.shutdown();
    }

    /** Cabeceras con el token de sesión, que ahora exigen todos los endpoints. */
    private static HttpHeaders conToken(String token) {
        HttpHeaders cabeceras = new HttpHeaders();
        cabeceras.setBearerAuth(token);
        return cabeceras;
    }

    private ResponseEntity<Map> crear(String token, Map<String, Object> cuerpo) {
        return restTemplate.exchange(
                "/jobs", HttpMethod.POST, new HttpEntity<>(cuerpo, conToken(token)), Map.class);
    }

    @Test
    void flujoCompletoCrearConsultarYListarTrabajo() {
        Map<String, Object> cuerpo = Map.of("nombre", "integracion", "comando", "echo hola-e2e", "prioridad", 5);

        ResponseEntity<Map> creacion = crear(TOKEN, cuerpo);
        assertEquals(HttpStatus.CREATED, creacion.getStatusCode());
        String id = (String) creacion.getBody().get("id");
        assertNotNull(id);

        ResponseEntity<Map> consulta = restTemplate.exchange(
                "/jobs/" + id, HttpMethod.GET, new HttpEntity<>(conToken(TOKEN)), Map.class);
        assertEquals(HttpStatus.OK, consulta.getStatusCode());
        assertEquals(id, consulta.getBody().get("id"));

        ResponseEntity<Map[]> listado = restTemplate.exchange(
                "/jobs", HttpMethod.GET, new HttpEntity<>(conToken(TOKEN)), Map[].class);
        assertEquals(HttpStatus.OK, listado.getStatusCode());
        assertTrue(listado.getBody().length >= 1);
    }

    @Test
    void consultarTrabajoInexistenteRetorna404ViaHttp() {
        ResponseEntity<Map> respuesta = restTemplate.exchange(
                "/jobs/no-existe-123", HttpMethod.GET, new HttpEntity<>(conToken(TOKEN)), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, respuesta.getStatusCode());
    }

    @Test
    void crearYCancelarTrabajoDevuelveConfirmacion() {
        Map<String, Object> cuerpo = Map.of("nombre", "cancelable", "comando", "sleep 5", "prioridad", 1);
        String id = (String) crear(TOKEN, cuerpo).getBody().get("id");

        ResponseEntity<Map> cancelacion = restTemplate.exchange(
                "/jobs/" + id, HttpMethod.DELETE, new HttpEntity<>(conToken(TOKEN)), Map.class);

        assertEquals(HttpStatus.OK, cancelacion.getStatusCode());
        assertEquals(Boolean.TRUE, cancelacion.getBody().get("cancelado"));
    }

    // --- autenticación de extremo a extremo ---

    @Test
    void sinCabeceraDeAutorizacionRetorna401ViaHttp() {
        ResponseEntity<Map> respuesta = restTemplate.getForEntity("/jobs", Map.class);
        assertEquals(HttpStatus.UNAUTHORIZED, respuesta.getStatusCode());
    }

    @Test
    void tokenInvalidoRetorna401ViaHttp() {
        ResponseEntity<Map> respuesta = restTemplate.exchange(
                "/jobs", HttpMethod.GET, new HttpEntity<>(conToken("esto-no-es-un-token")), Map.class);
        assertEquals(HttpStatus.UNAUTHORIZED, respuesta.getStatusCode());
    }

    @Test
    void unUsuarioNoVeNiCancelaElTrabajoDeOtroViaHttp() {
        Map<String, Object> cuerpo = Map.of("nombre", "ajeno", "comando", "sleep 5", "prioridad", 1);
        String id = (String) crear(TOKEN_OTRO, cuerpo).getBody().get("id");

        ResponseEntity<Map> consulta = restTemplate.exchange(
                "/jobs/" + id, HttpMethod.GET, new HttpEntity<>(conToken(TOKEN)), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, consulta.getStatusCode());

        ResponseEntity<Map> cancelacion = restTemplate.exchange(
                "/jobs/" + id, HttpMethod.DELETE, new HttpEntity<>(conToken(TOKEN)), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, cancelacion.getStatusCode());
    }
}
