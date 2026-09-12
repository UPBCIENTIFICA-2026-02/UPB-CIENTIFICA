package com.cluster.common;

import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

/**
 * Contrato remoto expuesto por {@code gestor-cluster} y consumido por
 * {@code job-api} como cliente RMI.
 *
 * El objeto que implementa esta interfaz (JobServiceImpl) se exporta de
 * forma explícita en el puerto fijo 2100 mediante
 * {@code UnicastRemoteObject.exportObject(impl, 2100)} y se publica en el
 * RMI Registry (puerto 1099) bajo el nombre lógico {@code "JobService"}.
 *
 * NOTA DE DISEÑO: este contrato NO incluye un mecanismo de callbacks
 * ({@code JobCallback}). Se evaluó explícitamente en la fase de análisis y
 * se descartó porque el modelo de consulta es de tipo pull (polling vía
 * {@link #getJobStatus}), suficiente para el alcance de este proyecto, y
 * porque introducir callbacks obligaría a {@code job-api} a exportar
 * también un objeto remoto propio sin que exista un requisito de negocio
 * que lo justifique.
 */
public interface JobService extends Remote {

    /**
     * Crea un nuevo trabajo, lo encola en estado {@link JobStatus#QUEUED} y
     * retorna su identificador. Debe retornar de inmediato: la ejecución del
     * comando ocurre de forma asíncrona en un worker de {@code gestor-cluster}.
     *
     * @param nombre   etiqueta legible del trabajo, no puede ser vacía
     * @param comando  comando de shell que el worker ejecutará
     * @param prioridad prioridad de extracción de la cola (mayor valor = mayor prioridad)
     * @return el identificador (UUID) generado por el servidor para este trabajo
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws IllegalArgumentException (no checked, puede propagarse por RMI) si
     *         {@code nombre} o {@code comando} son nulos/vacíos
     */
    String submitJob(String nombre, String comando, int prioridad) throws RemoteException;

    /**
     * Consulta únicamente el estado actual de un trabajo, sin traer el
     * objeto completo. Pensado para sondeo (polling) frecuente y económico.
     *
     * @param jobId identificador del trabajo
     * @return el {@link JobStatus} actual
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     */
    JobStatus getJobStatus(String jobId) throws RemoteException, JobNoEncontradoException;

    /**
     * Consulta el trabajo completo, incluyendo resultado o mensaje de error
     * si ya terminó. Pensado para cuando el cliente ya sabe (por
     * {@link #getJobStatus}) que el trabajo finalizó y quiere el detalle.
     *
     * @param jobId identificador del trabajo
     * @return el {@link Job} completo
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     */
    Job getJob(String jobId) throws RemoteException, JobNoEncontradoException;

    /**
     * Lista todos los trabajos conocidos por el gestor, en cualquier estado.
     *
     * @return copia inmutable de la vista actual de todos los trabajos
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     */
    List<Job> listJobs() throws RemoteException;

    /**
     * Cancela un trabajo si su estado actual lo permite
     * ({@link JobStatus#QUEUED} o {@link JobStatus#RUNNING}).
     *
     * @param jobId identificador del trabajo
     * @return {@code true} si la cancelación se aplicó
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     * @throws EstadoInvalidoException si el trabajo ya está en un estado terminal
     */
    boolean cancelJob(String jobId) throws RemoteException, JobNoEncontradoException, EstadoInvalidoException;
}
