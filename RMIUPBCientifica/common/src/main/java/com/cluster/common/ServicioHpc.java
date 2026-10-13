package com.cluster.common;

import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

/**
 * Contrato RMI del HPC Service (Contrato_HPC, interfaz HPCServiceRemote).
 *
 * Se publica con {@code UnicastRemoteObject.exportObject(impl, 2100)} y se
 * registra en el Registry (2099) como {@code "ServicioHpc"}.
 *
 * ANTES ({@code JobService}): submitJob(token, nombre, comando, prioridad 1-10)
 * y el gestor ejecutaba ese comando con {@code bash -c} en su propia máquina.
 * AHORA el trabajo es código fuente y dataset del Home del usuario; el gestor
 * los valida contra Storage, los planifica (prioridad con envejecimiento),
 * asigna nodos según su carga y los ejecuta con mpirun en el clúster a través
 * de job-runner ({@link EjecutorMpi}). El resultado vuelve al Home.
 *
 * Todos los métodos reciben el token como primer parámetro: el uid sale SIEMPRE
 * de él, nunca de un argumento aparte. Errores de negocio: {@link ErrorHpc}
 * (códigos HPC-xxx del contrato); identidad: {@link NoAutorizadoException}.
 */
public interface ServicioHpc extends Remote {

    /** EnviarTrabajo (§3.1). Valida token, código/dataset en Storage y cuota de cómputo; encola. */
    RespuestaEnvio enviarTrabajo(String token, SolicitudTrabajo solicitud)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** ConsultarEstadoTrabajo (§3.2): el trabajo completo (estado, nodos, error...). */
    TrabajoHpc consultarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** ListarTrabajosUsuario (§3.5). {@code filtroEstado} puede ser null. */
    List<TrabajoHpc> listarTrabajosUsuario(String token, EstadoTrabajo filtroEstado)
            throws RemoteException, NoAutorizadoException;

    /** ObtenerResultado (§3.3): solo la ruta en el Home, nunca el contenido. */
    ResultadoTrabajo obtenerResultado(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** ObtenerLogsTrabajo (§3.5): salida estándar y de error (las últimas líneas). */
    String obtenerLogsTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** CancelarTrabajo (§3.4). Si está ejecutando, termina los procesos MPI y libera los nodos. */
    TrabajoHpc cancelarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** DefinirPrioridadTrabajo (§3.6). Solo si sigue EN_COLA; ALTA exige "hpcadmin". */
    TrabajoHpc definirPrioridadTrabajo(String token, String trabajoId, Prioridad nuevaPrioridad)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** ReintentarTrabajo (§3.6). Crea un trabajo nuevo enlazado al fallido. */
    RespuestaEnvio reintentarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** ObtenerEstadoCluster + ObtenerEstadoCola (§3.9). */
    EstadoCluster obtenerEstadoCluster(String token)
            throws RemoteException, NoAutorizadoException;

    /**
     * Suma un equipo a la malla (Grid). Exige "hpcadmin" en el mapa de servicios.
     * El equipo debe tener OpenMPI, la llave SSH del clúster y /srv/home montado.
     */
    NodoCluster registrarNodo(String token, String host, int capacidadProcesos, boolean externo)
            throws RemoteException, NoAutorizadoException, ErrorHpc;

    /** Retira un nodo de la malla. Los trabajos que ya lo usan terminan normalmente. */
    void retirarNodo(String token, String host)
            throws RemoteException, NoAutorizadoException, ErrorHpc;
}
