package com.cluster.gestor;

import com.cluster.common.JobService;

import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.ExportException;
import java.rmi.server.UnicastRemoteObject;

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
 * Si el registry del puerto 1099 ya existe (por ejemplo, un rmiregistry
 * externo lanzado manualmente), se reutiliza con getRegistry en vez de fallar.
 */
public final class Main {

    private static final int PUERTO_REGISTRY = 1099;
    private static final int PUERTO_OBJETO_REMOTO = 2100;
    private static final String NOMBRE_SERVICIO = "JobService";

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        System.out.println("=== gestor-cluster: iniciando servidor RMI ===");

        Registry registry;
        try {
            registry = LocateRegistry.createRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry creado en el puerto " + PUERTO_REGISTRY);
        } catch (ExportException e) {
            registry = LocateRegistry.getRegistry(PUERTO_REGISTRY);
            System.out.println("[gestor-cluster] RMI Registry ya existía en el puerto "
                    + PUERTO_REGISTRY + "; reutilizando");
        }

        JobServiceImpl servicio = new JobServiceImpl();

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
}
