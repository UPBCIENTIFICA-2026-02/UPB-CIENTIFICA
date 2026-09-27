package com.cluster.api.service;

import com.cluster.api.exception.RmiNoDisponibleException;
import com.cluster.api.rmi.RmiClient;
import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.JobService;
import com.cluster.common.JobStatus;
import com.cluster.common.NoAutorizadoException;
import org.springframework.stereotype.Service;

import java.rmi.RemoteException;
import java.util.List;

/**
 * Capa de servicio de job-api. Encapsula el patrón "obtener stub + invocar +
 * traducir fallo de infraestructura" para que ni el Controller ni nada fuera
 * de este paquete tenga que lidiar con {@link RemoteException} directamente.
 *
 * Las excepciones de DOMINIO ({@link JobNoEncontradoException},
 * {@link EstadoInvalidoException}, {@link NoAutorizadoException}) se dejan
 * propagar tal cual: son parte del contrato de negocio y el Controller las
 * declara explícitamente para que {@code GlobalExceptionHandler} las traduzca a
 * 404/409/401/403.
 *
 * El token viaja como primer argumento de cada método, igual que en el contrato
 * RMI. job-api no lo interpreta: solo lo reenvía.
 */
@Service
public class JobFacadeService {

    private final RmiClient rmiClient;

    public JobFacadeService(RmiClient rmiClient) {
        this.rmiClient = rmiClient;
    }

    public String submitJob(String token, String nombre, String comando, int prioridad)
            throws NoAutorizadoException {
        return invocar(servicio -> servicio.submitJob(token, nombre, comando, prioridad));
    }

    public JobStatus getJobStatus(String token, String jobId)
            throws JobNoEncontradoException, NoAutorizadoException {
        return invocarConDominio(servicio -> servicio.getJobStatus(token, jobId));
    }

    public Job getJob(String token, String jobId)
            throws JobNoEncontradoException, NoAutorizadoException {
        return invocarConDominio(servicio -> servicio.getJob(token, jobId));
    }

    public List<Job> listJobs(String token) throws NoAutorizadoException {
        return invocar(servicio -> servicio.listJobs(token));
    }

    public boolean cancelJob(String token, String jobId)
            throws JobNoEncontradoException, EstadoInvalidoException, NoAutorizadoException {
        JobService servicio = rmiClient.obtenerServicio();
        try {
            return servicio.cancelJob(token, jobId);
        } catch (RemoteException e) {
            throw new RmiNoDisponibleException("Fallo de comunicación RMI al cancelar el trabajo " + jobId, e);
        }
    }

    // --- utilidades internas para no repetir el manejo de RemoteException ---

    private interface LlamadaSinDominio<T> {
        T ejecutar(JobService servicio) throws RemoteException, NoAutorizadoException;
    }

    private interface LlamadaConDominio<T> {
        T ejecutar(JobService servicio)
                throws RemoteException, JobNoEncontradoException, NoAutorizadoException;
    }

    private <T> T invocar(LlamadaSinDominio<T> llamada) throws NoAutorizadoException {
        JobService servicio = rmiClient.obtenerServicio();
        try {
            return llamada.ejecutar(servicio);
        } catch (RemoteException e) {
            throw new RmiNoDisponibleException("Fallo de comunicación RMI con gestor-cluster", e);
        }
    }

    private <T> T invocarConDominio(LlamadaConDominio<T> llamada)
            throws JobNoEncontradoException, NoAutorizadoException {
        JobService servicio = rmiClient.obtenerServicio();
        try {
            return llamada.ejecutar(servicio);
        } catch (RemoteException e) {
            throw new RmiNoDisponibleException("Fallo de comunicación RMI con gestor-cluster", e);
        }
    }
}
