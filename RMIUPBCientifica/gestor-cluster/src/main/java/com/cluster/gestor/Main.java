package com.cluster.gestor;

import com.cluster.common.JobService;
import com.cluster.gestor.auth.ValidadorSimulado;
import com.cluster.gestor.auth.ValidadorSoap;
import com.cluster.gestor.auth.ValidadorToken;

import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.ExportException;
import java.rmi.server.UnicastRemoteObject;
import java.time.Duration;

/**
 * Punto de entrada del servidor RMI {@code gestor-cluster}.
 *
 * ESTRATEGIA DE REGISTRY (decisión justificada, ver sección 8 del análisis):
 * se usa {@link LocateRegistry#createRegistry(int)} para levantar el RMI
 * Registry EMBEBIDO dentro de este mismo proceso JVM, en lugar de depender
 * del proceso externo {@code rmiregistry}. Razones:
 *   1) Un solo proceso que arrancar/monitorear/detener (más simple para un
 *      proyecto académico y para los scripts de despliegue).
 *   2) Evita que el registry externo quede huérfano si gestor-cluster cae:
 *      con el registry embebido, si el proceso muere, el registry también
 *      desaparece, dejando el estado del sistema consistente.
 *   3) No hay ninguna necesidad de que el registry sobreviva a reinicios del
 *      servicio (no hay más registrantes que este único servicio).
 * Si el registry del puerto ya existe (por ejemplo, un rmiregistry externo
 * lanzado manualmente), se reutiliza con getRegistry en vez de fallar.
 *
 * PUERTO DEL REGISTRY: 2099, como dice el diagrama de despliegue. Antes era
 * 1099 (el puerto por omisión de RMI) y quedaba en desacuerdo con el diagrama y
 * con la tabla de puertos de CLAUDE.md. Si el equipo prefiere 1099, hay que
 * cambiarlo también en job-api (application.properties), en los scripts y en el
 * diagrama: el valor tiene que ser el mismo en los cuatro sitios.
 *
 * COMPOSITION ROOT: este es el único sitio donde se decide qué validador de
 * token se usa y se conectan las dependencias.
 */
public final class Main {

    private static final int PUERTO_REGISTRY = 2099;
    private static final int PUERTO_OBJETO_REMOTO = 2100;
    private static final String NOMBRE_SERVICIO = "JobService";

    /** Endpoint y namespace reales del WSDL de node-soap. */
    private static final String AUTH_URL_POR_DEFECTO = "https://192.168.1.195:8081/soap/user.php";
    private static final String AUTH_NS_POR_DEFECTO = "http://192.168.1.195/soap";

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        System.out.println("=== gestor-cluster: iniciando servidor RMI ===");

        ValidadorToken validador = construirValidador();

        Registry registry;
        try {
            registry = LocateRegistry.createRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry creado en el puerto " + PUERTO_REGISTRY);
        } catch (ExportException e) {
            registry = LocateRegistry.getRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry ya existía en el puerto "
                    + PUERTO_REGISTRY + "; reutilizando");
        }

        JobServiceImpl servicio = new JobServiceImpl(validador);

        JobService stub = (JobService) UnicastRemoteObject.exportObject(servicio, PUERTO_OBJETO_REMOTO);
        System.out.println("[gestor-cluster] Objeto remoto JobService exportado en el puerto " + PUERTO_OBJETO_REMOTO);

        registry.rebind(NOMBRE_SERVICIO, stub);
        System.out.println("[gestor-cluster] Servicio registrado en el Registry como '" + NOMBRE_SERVICIO + "'");

        Registry registryFinal = registry;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("\n[gestor-cluster] Señal de apagado recibida, liberando recursos...");
            try {
                registryFinal.unbind(NOMBRE_SERVICIO);
            } catch (Exception e) {
                System.err.println("[gestor-cluster] No se pudo desregistrar el servicio: " + e.getMessage());
            }
            try {
                UnicastRemoteObject.unexportObject(servicio, true);
            } catch (Exception e) {
                System.err.println("[gestor-cluster] No se pudo des-exportar el objeto remoto: " + e.getMessage());
            }
            servicio.shutdown();
            System.out.println("[gestor-cluster] Recursos liberados. Adiós.");
        }, "shutdown-hook-gestor-cluster"));

        System.out.println("[gestor-cluster] Listo. Escuchando en Registry:" + PUERTO_REGISTRY
                + " / Objeto remoto:" + PUERTO_OBJETO_REMOTO);
        System.out.println("[gestor-cluster] Presiona Ctrl+C para detener el servidor.");

        Thread.currentThread().join();
    }

    /**
     * Elige la estrategia de validación de token.
     *
     * Se configura por variable de entorno para no añadir un archivo de
     * propiedades a un módulo que hoy no tiene ninguno:
     *   AUTH_MODE=soap|simulado   (por omisión: simulado)
     *   AUTH_URL=<endpoint SOAP>
     *   AUTH_NS=<targetNamespace>
     *
     * En producción TIENE que ser soap: el modo simulado acepta cualquier token
     * que empiece por "mock-token-".
     */
    private static ValidadorToken construirValidador() {
        String modo = env("AUTH_MODE", "simulado");

        if (!"soap".equalsIgnoreCase(modo)) {
            System.out.println("[gestor-cluster] ADVERTENCIA: autenticación SIMULADA "
                    + "(solo desarrollo). En producción use AUTH_MODE=soap.");
            return new ValidadorSimulado();
        }

        String url = env("AUTH_URL", AUTH_URL_POR_DEFECTO);
        String ns = env("AUTH_NS", AUTH_NS_POR_DEFECTO);
        System.out.println("[gestor-cluster] Autenticación SOAP contra " + url);
        return new ValidadorSoap(url, ns, Duration.ofSeconds(5));
    }

    private static String env(String clave, String porDefecto) {
        String valor = System.getenv(clave);
        return (valor == null || valor.isBlank()) ? porDefecto : valor;
    }
}
