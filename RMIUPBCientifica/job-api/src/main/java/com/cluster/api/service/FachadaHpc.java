package com.cluster.api.service;

import com.cluster.api.exception.RmiNoDisponibleException;
import com.cluster.api.rmi.RmiClient;
import com.cluster.common.ErrorHpc;
import com.cluster.common.EstadoCluster;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NoAutorizadoException;
import com.cluster.common.NodoCluster;
import com.cluster.common.Prioridad;
import com.cluster.common.RespuestaEnvio;
import com.cluster.common.ResultadoTrabajo;
import com.cluster.common.ServicioHpc;
import com.cluster.common.SolicitudTrabajo;
import com.cluster.common.TrabajoHpc;
import org.springframework.stereotype.Service;

import java.rmi.RemoteException;
import java.util.List;

/**
 * Capa de servicio de job-api: obtiene el stub, invoca y convierte los fallos
 * de infraestructura (RemoteException) en {@link RmiNoDisponibleException}
 * (503). Las excepciones de negocio ({@link ErrorHpc}, {@link NoAutorizadoException})
 * pasan tal cual para que GlobalExceptionHandler las traduzca.
 *
 * El token se reenvía como primer argumento, igual que en el contrato RMI;
 * job-api no lo interpreta.
 */
@Service
public class FachadaHpc {

    private final RmiClient rmiClient;

    public FachadaHpc(RmiClient rmiClient) {
        this.rmiClient = rmiClient;
    }

    @FunctionalInterface
    private interface Llamada<T> {
        T ejecutar(ServicioHpc s) throws RemoteException, NoAutorizadoException, ErrorHpc;
    }

    private <T> T invocar(Llamada<T> llamada) throws NoAutorizadoException, ErrorHpc {
        ServicioHpc servicio = rmiClient.obtenerServicio();
        try {
            return llamada.ejecutar(servicio);
        } catch (RemoteException e) {
            Throwable causa = e.getCause() != null && e.getCause() instanceof RemoteException ? e.getCause() : e;
            throw new RmiNoDisponibleException(causa.getMessage(), e);
        }
    }

    public RespuestaEnvio enviar(String token, SolicitudTrabajo s) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.enviarTrabajo(token, s));
    }

    public TrabajoHpc consultar(String token, String id) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.consultarTrabajo(token, id));
    }

    public List<TrabajoHpc> listar(String token, EstadoTrabajo filtro) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.listarTrabajosUsuario(token, filtro));
    }

    public ResultadoTrabajo resultado(String token, String id) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.obtenerResultado(token, id));
    }

    public String logs(String token, String id) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.obtenerLogsTrabajo(token, id));
    }

    public TrabajoHpc cancelar(String token, String id) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.cancelarTrabajo(token, id));
    }

    public TrabajoHpc definirPrioridad(String token, String id, Prioridad p) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.definirPrioridadTrabajo(token, id, p));
    }

    public RespuestaEnvio reintentar(String token, String id) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.reintentarTrabajo(token, id));
    }

    public EstadoCluster estadoCluster(String token) throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.obtenerEstadoCluster(token));
    }

    public NodoCluster registrarNodo(String token, String host, int capacidad, boolean externo)
            throws NoAutorizadoException, ErrorHpc {
        return invocar(x -> x.registrarNodo(token, host, capacidad, externo));
    }

    public void retirarNodo(String token, String host) throws NoAutorizadoException, ErrorHpc {
        invocar(x -> {
            x.retirarNodo(token, host);
            return null;
        });
    }
}
