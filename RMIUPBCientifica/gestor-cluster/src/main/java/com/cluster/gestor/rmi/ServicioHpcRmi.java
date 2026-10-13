package com.cluster.gestor.rmi;

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
import com.cluster.gestor.auth.AuthNoDisponibleException;
import com.cluster.gestor.auth.Usuario;
import com.cluster.gestor.auth.ValidadorToken;
import com.cluster.gestor.dominio.Almacenamiento;
import com.cluster.gestor.dominio.GestorTrabajos;

import java.rmi.RemoteException;
import java.util.List;

/**
 * Capa de presentación RMI del servicio HPC: valida el token, exige el servicio
 * en el mapa de servicios del perfil y delega en {@link GestorTrabajos}. No
 * contiene reglas de negocio.
 *
 * ANTES ({@code JobServiceImpl}) esta clase validaba, encolaba y ejecutaba
 * cada comando con {@code bash -c} en la máquina del gestor. La ejecución pasó
 * a job-runner en el clúster y la lógica a {@code dominio/}.
 *
 * Permisos (mapa de servicios de Authentication):
 *   hpc      — usar el servicio (enviar, consultar, cancelar sus trabajos)
 *   hpcadmin — prioridad ALTA ("hpc:prioridad-alta" del contrato) y
 *              registrar/retirar nodos de la malla
 */
public final class ServicioHpcRmi implements ServicioHpc {

    private static final String SERVICIO = "hpc";
    private static final String SERVICIO_ADMIN = "hpcadmin";

    private final ValidadorToken validador;
    private final GestorTrabajos gestor;

    public ServicioHpcRmi(ValidadorToken validador, GestorTrabajos gestor) {
        this.validador = validador;
        this.gestor = gestor;
    }

    /**
     * Valida el token y el servicio "hpc". Un fallo de Auth se envuelve en
     * RemoteException: job-api ya la traduce a 503, que es lo correcto cuando
     * Authentication no responde.
     */
    private Usuario autenticar(String token) throws RemoteException, NoAutorizadoException {
        Usuario usuario;
        try {
            usuario = validador.validar(token);
            if (usuario == null) {
                throw NoAutorizadoException.tokenInvalido();
            }
            if (!validador.autorizarServicio(usuario, SERVICIO)) {
                throw new NoAutorizadoException(
                        "Tu perfil no tiene acceso al servicio \"" + SERVICIO + "\"", false);
            }
        } catch (AuthNoDisponibleException e) {
            throw new RemoteException(e.getMessage(), e);
        }
        gestor.recordarToken(usuario.uid(), token);
        return usuario;
    }

    private boolean esAdmin(Usuario u) throws RemoteException {
        try {
            return validador.autorizarServicio(u, SERVICIO_ADMIN);
        } catch (AuthNoDisponibleException e) {
            throw new RemoteException(e.getMessage(), e);
        }
    }

    private static RemoteException storageCaido(Almacenamiento.NoDisponible e) {
        return new RemoteException("Distributed Storage no disponible: " + e.getMessage(), e);
    }

    @Override
    public RespuestaEnvio enviarTrabajo(String token, SolicitudTrabajo solicitud)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        Usuario u = autenticar(token);
        if (solicitud == null) {
            throw new ErrorHpc(ErrorHpc.Codigo.DATOS_INVALIDOS, "Falta la solicitud");
        }
        boolean alta = solicitud.getPrioridad() == Prioridad.ALTA && esAdmin(u);
        try {
            return gestor.enviar(u.uid(), token, solicitud, alta, null, null);
        } catch (Almacenamiento.NoDisponible e) {
            throw storageCaido(e);
        }
    }

    @Override
    public TrabajoHpc consultarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        return gestor.consultar(autenticar(token).uid(), trabajoId);
    }

    @Override
    public List<TrabajoHpc> listarTrabajosUsuario(String token, EstadoTrabajo filtroEstado)
            throws RemoteException, NoAutorizadoException {
        return gestor.listar(autenticar(token).uid(), filtroEstado);
    }

    @Override
    public ResultadoTrabajo obtenerResultado(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        return gestor.resultado(autenticar(token).uid(), trabajoId);
    }

    @Override
    public String obtenerLogsTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        return gestor.logs(autenticar(token).uid(), trabajoId);
    }

    @Override
    public TrabajoHpc cancelarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        return gestor.cancelar(autenticar(token).uid(), trabajoId);
    }

    @Override
    public TrabajoHpc definirPrioridadTrabajo(String token, String trabajoId, Prioridad nuevaPrioridad)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        Usuario u = autenticar(token);
        boolean alta = nuevaPrioridad == Prioridad.ALTA && esAdmin(u);
        return gestor.definirPrioridad(u.uid(), trabajoId, nuevaPrioridad, alta);
    }

    @Override
    public RespuestaEnvio reintentarTrabajo(String token, String trabajoId)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        Usuario u = autenticar(token);
        try {
            return gestor.reintentar(u.uid(), token, trabajoId, esAdmin(u));
        } catch (Almacenamiento.NoDisponible e) {
            throw storageCaido(e);
        }
    }

    @Override
    public EstadoCluster obtenerEstadoCluster(String token) throws RemoteException, NoAutorizadoException {
        autenticar(token);
        return gestor.estadoCluster();
    }

    @Override
    public NodoCluster registrarNodo(String token, String host, int capacidadProcesos, boolean externo)
            throws RemoteException, NoAutorizadoException, ErrorHpc {
        exigirAdmin(autenticar(token));
        return gestor.registrarNodo(host, capacidadProcesos, externo);
    }

    @Override
    public void retirarNodo(String token, String host) throws RemoteException, NoAutorizadoException, ErrorHpc {
        exigirAdmin(autenticar(token));
        gestor.retirarNodo(host);
    }

    private void exigirAdmin(Usuario u) throws RemoteException, NoAutorizadoException {
        if (!esAdmin(u)) {
            throw new NoAutorizadoException(
                    "Tu perfil no puede administrar los nodos de la malla (servicio \"" + SERVICIO_ADMIN + "\")", false);
        }
    }
}
