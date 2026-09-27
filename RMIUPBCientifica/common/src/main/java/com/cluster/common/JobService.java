package com.cluster.common;

import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

/**
 * Contrato RMI del gestor del clúster.
 *
 * Se publica como objeto remoto mediante
 * {@code UnicastRemoteObject.exportObject(impl, 2100)} y se registra en el
 * Registry con el nombre {@code "JobService"}.
 *
 * -------------------------------------------------------------------------
 * AUTENTICACIÓN (cambio de contrato)
 *
 * Todos los métodos reciben ahora el token de sesión como PRIMER parámetro.
 * Antes ninguno lo recibía: el servicio no tenía forma de saber quién llamaba,
 * así que cualquiera con acceso al puerto 2100 podía enviar trabajos, verlos
 * todos y cancelar los de los demás. Y como el contrato no tenía un hueco para
 * la identidad, no se podía arreglar sin tocarlo.
 *
 * El uid sale SIEMPRE del token validado, nunca de un parámetro aparte: un
 * cliente no puede afirmar quién es.
 *
 * Al cambiar esta interfaz hay que recompilar los tres módulos (common,
 * gestor-cluster y job-api), porque `common` se comparte como dependencia.
 * -------------------------------------------------------------------------
 */
public interface JobService extends Remote {

    /**
     * Encola un trabajo a nombre del usuario dueño del token.
     *
     * @param token     token de sesión emitido por Authentication Service
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws NoAutorizadoException si el token es inválido
     * @throws IllegalArgumentException (no checked, puede propagarse por RMI) si
     *         el nombre o el comando están vacíos, o la prioridad está fuera de rango
     */
    String submitJob(String token, String nombre, String comando, int prioridad)
            throws RemoteException, NoAutorizadoException;

    /**
     * Estado de un trabajo propio.
     *
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     * @throws NoAutorizadoException si el token es inválido o el trabajo es de otro
     */
    JobStatus getJobStatus(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, NoAutorizadoException;

    /**
     * Trabajo completo, si es del usuario del token.
     *
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     * @throws NoAutorizadoException si el token es inválido o el trabajo es de otro
     */
    Job getJob(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, NoAutorizadoException;

    /**
     * Trabajos DEL USUARIO del token.
     *
     * Antes devolvía los de todos los usuarios, sin filtro alguno.
     *
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws NoAutorizadoException si el token es inválido
     */
    List<Job> listJobs(String token) throws RemoteException, NoAutorizadoException;

    /**
     * Cancela un trabajo propio.
     *
     * @throws RemoteException si ocurre un fallo de comunicación RMI
     * @throws JobNoEncontradoException si no existe un trabajo con ese id
     * @throws EstadoInvalidoException si el trabajo ya está en un estado terminal
     * @throws NoAutorizadoException si el token es inválido o el trabajo es de otro
     */
    boolean cancelJob(String token, String jobId)
            throws RemoteException, JobNoEncontradoException, EstadoInvalidoException,
            NoAutorizadoException;
}
