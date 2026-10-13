package com.cluster.common;

import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;
import java.util.Map;

/**
 * Contrato INTERNO entre el gestor (node-rmi) y job-runner (hpc-master).
 *
 * Contrato_HPC §6: "la comunicación Scheduler↔MPI es interna del servicio
 * (puede ser RMI también ...), pero no se expone como contrato externo". Va por
 * RMI, como dibuja el diagrama de despliegue (node-rmi → hpc-master, 2099/2100).
 *
 * job-runner es el único que toca el clúster: escribe el código y el dataset en
 * el directorio compartido por NFS, compila con mpicc/mpicxx y lanza mpirun con
 * el hostfile que le da el gestor. Nada de {@code bash -c}: cada proceso se
 * lanza con su lista de argumentos.
 *
 * El estado se consulta (no hay callback): job-runner no necesita abrir
 * conexiones hacia node-rmi, lo que simplifica el cortafuegos del CCA.
 */
public interface EjecutorMpi extends Remote {

    /** Prepara el directorio del trabajo, compila y lanza mpirun. Vuelve enseguida. */
    void iniciar(OrdenEjecucion orden) throws RemoteException;

    /** Estado actual de la ejecución de un trabajo. */
    EstadoEjecucion consultar(String trabajoId) throws RemoteException;

    /** Últimos bytes de la salida estándar y de error (logs en vivo). */
    String logs(String trabajoId, int maxBytes) throws RemoteException;

    /**
     * Archivos producidos: salida.txt, errores.txt, compilacion.txt y lo que el
     * programa haya escrito en su directorio. No incluye el código, el binario
     * ni el dataset. Tope de tamaño configurable en job-runner.
     */
    Map<String, byte[]> resultados(String trabajoId) throws RemoteException;

    /** Termina mpirun (y con él los procesos remotos). */
    void cancelar(String trabajoId) throws RemoteException;

    /** Borra el directorio del trabajo una vez guardado el resultado. */
    void limpiar(String trabajoId) throws RemoteException;

    /** De los hosts dados, los que NO responden por SSH (comprobación de salud). */
    List<String> nodosSinRespuesta(List<String> hosts) throws RemoteException;
}
