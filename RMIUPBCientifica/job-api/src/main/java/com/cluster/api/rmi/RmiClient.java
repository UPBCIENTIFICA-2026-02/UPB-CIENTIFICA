package com.cluster.api.rmi;

import com.cluster.api.exception.RmiNoDisponibleException;
import com.cluster.common.ServicioHpc;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.rmi.NotBoundException;
import java.rmi.RemoteException;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;

/**
 * Única clase de job-api que conoce java.rmi. El resto solo ve la interfaz
 * {@link ServicioHpc}.
 *
 * El stub se busca en cada invocación: si gestor-cluster se reinicia, un stub
 * guardado apuntaría a un objeto que ya no existe. Consultar el Registry es
 * barato para el volumen de este proyecto.
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

    /** @throws RmiNoDisponibleException si el Registry no responde o el servicio no está publicado */
    public ServicioHpc obtenerServicio() {
        try {
            Registry registry = LocateRegistry.getRegistry(host, registryPort);
            return (ServicioHpc) registry.lookup(serviceName);
        } catch (RemoteException e) {
            throw new RmiNoDisponibleException(
                    "No se pudo contactar al RMI Registry en " + host + ":" + registryPort, e);
        } catch (NotBoundException e) {
            throw new RmiNoDisponibleException(
                    "El servicio '" + serviceName + "' no está publicado en el Registry", e);
        }
    }
}
