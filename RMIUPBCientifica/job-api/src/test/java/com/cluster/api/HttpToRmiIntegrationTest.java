package com.cluster.api;

import com.cluster.common.EstadoEjecucion;
import com.cluster.common.OrdenEjecucion;
import com.cluster.common.ServicioHpc;
import com.cluster.gestor.auth.ValidadorSimulado;
import com.cluster.gestor.dominio.Almacenamiento;
import com.cluster.gestor.dominio.Ejecutor;
import com.cluster.gestor.dominio.GestorTrabajos;
import com.cluster.gestor.dominio.Persistencia;
import com.cluster.gestor.dominio.RegistroNodos;
import com.cluster.gestor.dominio.ReglasTrabajo;
import com.cluster.gestor.rmi.ServicioHpcRmi;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * HTTP real -> job-api -> RMI real -> gestor-cluster (embebido en el proceso)
 * -> dominio. Storage y job-runner son dobles en memoria: lo que se prueba aquí
 * es el contrato HTTP/RMI, no el clúster (ver EjecutorMpiImplTest).
 *
 * Registry en 11099 para no chocar con un gestor real en la máquina.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"rmi.gestor.registryPort=11099"})
class HttpToRmiIntegrationTest {

    private static final String TOKEN = "mock-token-jperez-e2e";
    private static final String TOKEN_OTRO = "mock-token-otrousuario-e2e";

    private static Registry registry;
    private static ServicioHpcRmi servicio;
    private static GestorTrabajos gestor;

    @Autowired
    private TestRestTemplate rest;

    @BeforeAll
    static void iniciarGestorEmbebido() throws Exception {
        Almacenamiento storage = new Almacenamiento() {
            public Elemento resolver(String token, String ruta) {
                return ruta.endsWith("pi.c") ? new Elemento("id-pi", "pi.c", false, 10) : null;
            }

            public byte[] descargar(String token, String id) {
                return "int main(){}".getBytes(StandardCharsets.UTF_8);
            }

            public String guardar(String token, String carpeta, Map<String, byte[]> archivos) {
                return "/" + carpeta;
            }
        };
        Ejecutor ejecutor = new Ejecutor() {
            public boolean disponible() { return true; }
            public void iniciar(OrdenEjecucion o) { }
            public EstadoEjecucion consultar(String id) {
                return new EstadoEjecucion(EstadoEjecucion.TERMINADO, 0, false, false, false, null);
            }
            public String logs(String id, int max) { return "rango 0: pi = 3.1416"; }
            public Map<String, byte[]> resultados(String id) {
                return Map.of("salida.txt", "pi".getBytes(StandardCharsets.UTF_8));
            }
            public void cancelar(String id) { }
            public void limpiar(String id) { }
            public List<String> nodosSinRespuesta(List<String> hosts) { return List.of(); }
        };
        Persistencia memoria = new Persistencia() {
            public void guardar(Instantanea i) { }
            public Instantanea cargar() { return null; }
        };
        gestor = new GestorTrabajos(storage, ejecutor, RegistroNodos.desdeConfiguracion("nodo1:4"),
                new ReglasTrabajo(8, 3600), memoria, Duration.ofSeconds(60), Duration.ofMillis(20));
        gestor.arrancar();
        servicio = new ServicioHpcRmi(new ValidadorSimulado(), gestor);
        registry = LocateRegistry.createRegistry(11099);
        registry.rebind("ServicioHpc", (ServicioHpc) UnicastRemoteObject.exportObject(servicio, 12100));
    }

    @AfterAll
    static void detener() throws Exception {
        registry.unbind("ServicioHpc");
        UnicastRemoteObject.unexportObject(servicio, true);
        UnicastRemoteObject.unexportObject(registry, true);
        gestor.detener();
    }

    private static HttpHeaders conToken(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        return h;
    }

    private ResponseEntity<Map> llamar(HttpMethod metodo, String ruta, String token, Object cuerpo) {
        return rest.exchange(ruta, metodo, new HttpEntity<>(cuerpo, conToken(token)), Map.class);
    }

    private static Map<String, Object> solicitud(String codigo) {
        return Map.of("nombreTrabajo", "integracion", "rutaCodigo", codigo,
                "numeroProcesos", 2, "tiempoMaximoEjecucion", 60);
    }

    @Test
    void flujoCompletoEnviarConsultarResultadoYLogs() throws Exception {
        ResponseEntity<Map> envio = llamar(HttpMethod.POST, "/jobs", TOKEN, solicitud("/Proyectos/pi.c"));
        assertEquals(HttpStatus.CREATED, envio.getStatusCode());
        String id = (String) envio.getBody().get("trabajoId");

        String estado = "";
        for (int i = 0; i < 100 && !"COMPLETADO".equals(estado); i++) {
            Thread.sleep(50);
            estado = (String) llamar(HttpMethod.GET, "/jobs/" + id + "/estado", TOKEN, null).getBody().get("estado");
        }
        assertEquals("COMPLETADO", estado);

        Map<?, ?> resultado = llamar(HttpMethod.GET, "/jobs/" + id + "/resultado", TOKEN, null).getBody();
        assertTrue(((String) resultado.get("rutaResultado")).startsWith("/Resultados HPC/integracion-"));
        assertEquals("rango 0: pi = 3.1416",
                llamar(HttpMethod.GET, "/jobs/" + id + "/logs", TOKEN, null).getBody().get("logsEjecucion"));

        ResponseEntity<Map[]> lista = rest.exchange("/jobs", HttpMethod.GET, new HttpEntity<>(conToken(TOKEN)), Map[].class);
        assertTrue(lista.getBody().length >= 1);

        Map<?, ?> cluster = llamar(HttpMethod.GET, "/cluster/estado", TOKEN, null).getBody();
        assertEquals(1, cluster.get("nodosTotales"));
        assertEquals(true, cluster.get("ejecutorConectado"));
    }

    @Test
    void codigoInexistenteEs404ConCodigoDelContrato() {
        ResponseEntity<Map> r = llamar(HttpMethod.POST, "/jobs", TOKEN, solicitud("/no-existe.c"));
        assertEquals(HttpStatus.NOT_FOUND, r.getStatusCode());
        assertEquals("HPC-001", r.getBody().get("codigo"));
    }

    @Test
    void unUsuarioNoVeElTrabajoDeOtro() {
        String id = (String) llamar(HttpMethod.POST, "/jobs", TOKEN_OTRO, solicitud("/Proyectos/pi.c")).getBody().get("trabajoId");
        ResponseEntity<Map> r = llamar(HttpMethod.GET, "/jobs/" + id, TOKEN, null);
        assertEquals(HttpStatus.NOT_FOUND, r.getStatusCode());
        assertEquals("HPC-101", r.getBody().get("codigo"));
    }

    @Test
    void tokenInvalidoEs401() {
        assertEquals(HttpStatus.UNAUTHORIZED, llamar(HttpMethod.GET, "/jobs", "no-es-un-token", null).getStatusCode());
    }

    @Test
    void nodosDeLaMalla() {
        ResponseEntity<Map> r = llamar(HttpMethod.POST, "/cluster/nodos", TOKEN,
                Map.of("host", "equipo-externo-1", "capacidadProcesos", 2));
        assertEquals(HttpStatus.CREATED, r.getStatusCode());
        assertEquals("EXTERNO", r.getBody().get("origen"));
        assertEquals(HttpStatus.NO_CONTENT,
                llamar(HttpMethod.DELETE, "/cluster/nodos/equipo-externo-1", TOKEN, null).getStatusCode());
    }
}
