package com.cluster.runner;

import com.cluster.common.EjecutorMpi;

import java.nio.file.Files;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;

/**
 * job-runner: corre en hpc-master como mpiuser (OpenMPI no arranca como root).
 * Composition root: lee la configuración y publica {@link EjecutorMpi} por RMI.
 *
 * Puertos: Registry 2099 y objeto 2100, como el diagrama (node-rmi → hpc-master).
 * Si el gestor corre en la MISMA máquina (clúster local de VirtualBox) esos
 * puertos ya son suyos: RUNNER_PUERTO_REGISTRY=2199 y RUNNER_PUERTO_OBJETO=2200.
 * Arrancar con -Djava.rmi.server.hostname=<IP que ve el gestor>.
 */
public final class Main {

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        int puertoRegistry = Integer.parseInt(env("RUNNER_PUERTO_REGISTRY", "2099"));
        int puertoObjeto = Integer.parseInt(env("RUNNER_PUERTO_OBJETO", "2100"));
        Configuracion cfg = Configuracion.desdeEntorno();
        Files.createDirectories(cfg.dirTrabajos());

        EjecutorMpiImpl ejecutor = new EjecutorMpiImpl(cfg);
        Registry registry = LocateRegistry.createRegistry(puertoRegistry);
        EjecutorMpi stub = (EjecutorMpi) UnicastRemoteObject.exportObject(ejecutor, puertoObjeto);
        registry.rebind("EjecutorMpi", stub);

        System.out.println("[job-runner] Listo. Registry " + puertoRegistry + ", objeto " + puertoObjeto);
        System.out.println("[job-runner] Trabajos en " + cfg.dirTrabajos() + " | mpirun: " + cfg.mpirun()
                + " " + cfg.opcionesMpirun() + " | mpicc: " + cfg.mpicc() + " | locales: " + cfg.nodosLocales());
        Thread.currentThread().join();
    }

    private static String env(String clave, String porDefecto) {
        String v = System.getenv(clave);
        return v == null || v.isBlank() ? porDefecto : v;
    }
}
