package com.cluster.gestor;

import com.cluster.common.ServicioHpc;
import com.cluster.gestor.auth.ValidadorSimulado;
import com.cluster.gestor.auth.ValidadorSoap;
import com.cluster.gestor.auth.ValidadorToken;
import com.cluster.gestor.datos.ArchivoPersistencia;
import com.cluster.gestor.datos.EjecutorRmi;
import com.cluster.gestor.datos.StorageHttp;
import com.cluster.gestor.dominio.GestorTrabajos;
import com.cluster.gestor.dominio.RegistroNodos;
import com.cluster.gestor.dominio.ReglasTrabajo;
import com.cluster.gestor.metricas.MetricasHpc;
import com.cluster.gestor.rmi.ServicioHpcRmi;

import java.nio.file.Path;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.ExportException;
import java.rmi.server.UnicastRemoteObject;
import java.time.Duration;

/**
 * Punto de entrada y COMPOSITION ROOT de gestor-cluster (node-rmi): único sitio
 * donde se eligen y conectan las dependencias.
 *
 * Registry RMI EMBEBIDO (createRegistry) en el 2099 y objeto remoto fijado en
 * el 2100, como el diagrama de despliegue: un solo proceso que arrancar y un
 * puerto fijo que abrir en el cortafuegos del CCA.
 *
 * Configuración (variables de entorno):
 *   AUTH_MODE=soap|simulado, AUTH_URL, AUTH_NS   validación de token
 *   URL_STORAGE        Distributed Storage (http://node-repository:8084)
 *   EJECUTOR_HOST      job-runner en hpc-master (por defecto hpc-master)
 *   EJECUTOR_PUERTO    su Registry RMI (2099; 2199 si comparte máquina con el gestor)
 *   HPC_NODOS          nodos del laboratorio "host:procesos,..." (hpc-master:2,hpc-worker1:2,...)
 *   HPC_MAX_PROCESOS   cuota de procesos por trabajo (64)
 *   HPC_MAX_TIEMPO     tiempo máximo institucional en segundos (86400)
 *   HPC_ENVEJECIMIENTO segundos de espera que suben un punto de prioridad (60)
 *   ESTADO_HPC         archivo de estado persistido (estado-hpc/trabajos.ser)
 *   METRICAS_PUERTO    métricas Prometheus (9102)
 */
public final class Main {

    private static final int PUERTO_REGISTRY = 2099;
    private static final int PUERTO_OBJETO_REMOTO = 2100;
    private static final String NOMBRE_SERVICIO = "ServicioHpc";

    private static final String AUTH_URL_POR_DEFECTO = "https://192.168.1.195:8081/soap/user.php";
    private static final String AUTH_NS_POR_DEFECTO = "http://192.168.1.195/soap";

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        System.out.println("=== gestor-cluster: iniciando servidor RMI ===");

        ValidadorToken validador = construirValidador();
        String urlStorage = env("URL_STORAGE", "http://node-repository:8084");
        String hostEjecutor = env("EJECUTOR_HOST", "hpc-master");
        int puertoEjecutor = Integer.parseInt(env("EJECUTOR_PUERTO", "2099"));
        String listaNodos = env("HPC_NODOS",
                "hpc-master:2,hpc-worker1:2,hpc-worker2:2,hpc-worker3:2,hpc-worker4:2");

        GestorTrabajos gestor = new GestorTrabajos(
                new StorageHttp(urlStorage),
                new EjecutorRmi(hostEjecutor, puertoEjecutor),
                RegistroNodos.desdeConfiguracion(listaNodos),
                new ReglasTrabajo(Integer.parseInt(env("HPC_MAX_PROCESOS", "64")),
                        Integer.parseInt(env("HPC_MAX_TIEMPO", "86400"))),
                new ArchivoPersistencia(Path.of(env("ESTADO_HPC", "estado-hpc/trabajos.ser"))),
                Duration.ofSeconds(Long.parseLong(env("HPC_ENVEJECIMIENTO", "60"))),
                Duration.ofSeconds(2));
        MetricasHpc metricas = new MetricasHpc(gestor::todos, gestor::estadoCluster);
        gestor.setObservador(metricas);
        gestor.arrancar();
        System.out.println("[gestor-cluster] Storage: " + urlStorage + " | job-runner: "
                + hostEjecutor + ":" + puertoEjecutor + " | nodos: " + listaNodos);

        Registry registry;
        try {
            registry = LocateRegistry.createRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry creado en el puerto " + PUERTO_REGISTRY);
        } catch (ExportException e) {
            registry = LocateRegistry.getRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry ya existía en el puerto " + PUERTO_REGISTRY);
        }

        ServicioHpcRmi servicio = new ServicioHpcRmi(validador, gestor);
        ServicioHpc stub = (ServicioHpc) UnicastRemoteObject.exportObject(servicio, PUERTO_OBJETO_REMOTO);
        registry.rebind(NOMBRE_SERVICIO, stub);
        System.out.println("[gestor-cluster] '" + NOMBRE_SERVICIO + "' exportado en el puerto " + PUERTO_OBJETO_REMOTO);

        int puertoMetricas = Integer.parseInt(env("METRICAS_PUERTO", "9102"));
        metricas.servir(puertoMetricas);
        System.out.println("[gestor-cluster] Métricas Prometheus en http://0.0.0.0:" + puertoMetricas + "/metrics");

        Registry registryFinal = registry;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("\n[gestor-cluster] Apagando: se guarda el estado de los trabajos");
            try {
                registryFinal.unbind(NOMBRE_SERVICIO);
                UnicastRemoteObject.unexportObject(servicio, true);
            } catch (Exception e) {
                System.err.println("[gestor-cluster] " + e.getMessage());
            }
            gestor.detener();
        }, "apagado-gestor-cluster"));

        System.out.println("[gestor-cluster] Listo. Registry:" + PUERTO_REGISTRY + " / objeto:" + PUERTO_OBJETO_REMOTO);
        Thread.currentThread().join();
    }

    /** AUTH_MODE=soap en producción; simulado acepta cualquier "mock-token-<uid>-...". */
    private static ValidadorToken construirValidador() {
        if (!"soap".equalsIgnoreCase(env("AUTH_MODE", "simulado"))) {
            System.out.println("[gestor-cluster] ADVERTENCIA: autenticación SIMULADA (solo desarrollo).");
            return new ValidadorSimulado();
        }
        String url = env("AUTH_URL", AUTH_URL_POR_DEFECTO);
        System.out.println("[gestor-cluster] Autenticación SOAP contra " + url);
        return new ValidadorSoap(url, env("AUTH_NS", AUTH_NS_POR_DEFECTO), Duration.ofSeconds(5));
    }

    private static String env(String clave, String porDefecto) {
        String valor = System.getenv(clave);
        return (valor == null || valor.isBlank()) ? porDefecto : valor;
    }
}
