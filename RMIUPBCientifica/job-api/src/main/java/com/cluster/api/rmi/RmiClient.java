package com.cluster.api.rmi;

import com.cluster.api.exception.RmiNoDisponibleException;
import com.cluster.common.JobService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.rmi.NotBoundException;
import java.rmi.RemoteException;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;

/**
 * Única clase de {@code job-api} que conoce los tipos de {@code java.rmi}
 * ({@link Registry}, {@link Naming}-equivalente vía {@code LocateRegistry},
 * {@code Remote}). El resto de la aplicación (Controller, Service) solo
 * conoce {@link JobService}, la interfaz de dominio, nunca los detalles de
 * cómo se localiza o conecta el stub.
 *
 * Estrategia de resolución: se busca el stub en CADA invocación en lugar de
 * cachearlo de forma permanente. Esto es intencional: si gestor-cluster se
 * reinicia, un stub cacheado indefinidamente seguiría apuntando a una
 * referencia remota obsoleta y fallaría en cada llamada. Volver a resolverlo
 * (operación barata: solo consulta el Registry en el puerto 1099) garantiza
 * que job-api siempre invoque contra el proceso vivo actual, con el coste de
 * una consulta adicional al Registry por request, aceptable para el volumen
 * de este proyecto.
 */
@Component
public class RmiClient {

    private final String host;
    private final int registryPort;
    private final String serviceName;

    public RmiClient(
            @Value("${rmi.gestor.host}") String host,
            @Value("${rmi.gestor.registryPort}") int registryPort,
            @Value("${rmi.gestor.serviceName}") String serviceName) {
        this.host = host;
        this.registryPort = registryPort;
        this.serviceName = serviceName;
    }

    /**
     * Resuelve el stub de {@link JobService} contra el RMI Registry.
     *
     * @throws RmiNoDisponibleException si el Registry no está accesible o el
     *         servicio no está publicado bajo el nombre esperado
     */
    public JobService obtenerServicio() {
        try {
            Registry registry = LocateRegistry.getRegistry(host, registryPort);
            return (JobService) registry.lookup(serviceName);
        } catch (RemoteException e) {
            throw new RmiNoDisponibleException(
                    "No se pudo contactar al RMI Registry en " + host + ":" + registryPort, e);
        } catch (NotBoundException e) {
            throw new RmiNoDisponibleException(
                    "El servicio '" + serviceName + "' no está publicado en el Registry", e);
        }
    }
}
