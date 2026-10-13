package com.cluster.common;

import java.io.Serializable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Entidad TrabajoHPC (Contrato_HPC §4). Viaja por valor por RMI: el gestor
 * nunca entrega la instancia viva sino {@link #copia()}, para que serializarla
 * no se cruce con un hilo que la está modificando.
 *
 * ANTES era {@code Job}: nombre + comando de shell + resultado como texto en
 * memoria. Ahora el trabajo es código y dataset de Storage, y el resultado
 * queda en el Home del usuario (aquí solo su ruta).
 */
public class TrabajoHpc implements Serializable {

    private static final long serialVersionUID = 2L;

    private final String id;
    /** uid del token validado; nunca sale del cuerpo de la petición. */
    private final String propietario;
    private final String nombreTrabajo;
    private final String rutaCodigo;
    private final String rutaDataset;
    private final int numeroProcesos;
    private final int tiempoMaximoEjecucion;
    private final LinkedHashMap<String, String> parametrosEjecucion;
    private final String trabajoOriginalId;
    private final Instant fechaEnvio;

    /** Nodos de Storage a los que se resolvieron rutaCodigo y rutaDataset al validar. */
    private String codigoId;
    private String nombreCodigo;
    private String datasetId;
    private String nombreDataset;

    private Prioridad prioridad;
    private EstadoTrabajo estado = EstadoTrabajo.PENDIENTE;
    private Instant fechaInicio;
    private Instant fechaFin;
    private List<String> nodosAsignados = new ArrayList<>();
    private Integer codigoSalida;
    private String rutaResultado;
    private long tamanoResultadoBytes;
    private boolean resultadoIncompleto;
    private String mensajeError;
    /** Se calcula al responder; no es estado del trabajo. */
    private int posicionCola;

    public TrabajoHpc(String id, String propietario, SolicitudTrabajo s, String trabajoOriginalId) {
        this.id = Objects.requireNonNull(id, "id");
        this.propietario = Objects.requireNonNull(propietario, "propietario");
        this.nombreTrabajo = s.getNombreTrabajo();
        this.rutaCodigo = s.getRutaCodigo();
        this.rutaDataset = s.getRutaDataset();
        this.numeroProcesos = s.getNumeroProcesos();
        this.tiempoMaximoEjecucion = s.getTiempoMaximoEjecucion();
        this.prioridad = s.getPrioridad();
        this.parametrosEjecucion = new LinkedHashMap<>(s.getParametrosEjecucion());
        this.trabajoOriginalId = trabajoOriginalId;
        this.fechaEnvio = Instant.now();
    }

    private TrabajoHpc(TrabajoHpc o) {
        this.id = o.id;
        this.propietario = o.propietario;
        this.nombreTrabajo = o.nombreTrabajo;
        this.rutaCodigo = o.rutaCodigo;
        this.rutaDataset = o.rutaDataset;
        this.numeroProcesos = o.numeroProcesos;
        this.tiempoMaximoEjecucion = o.tiempoMaximoEjecucion;
        this.parametrosEjecucion = new LinkedHashMap<>(o.parametrosEjecucion);
        this.trabajoOriginalId = o.trabajoOriginalId;
        this.fechaEnvio = o.fechaEnvio;
        this.codigoId = o.codigoId;
        this.nombreCodigo = o.nombreCodigo;
        this.datasetId = o.datasetId;
        this.nombreDataset = o.nombreDataset;
        this.prioridad = o.prioridad;
        this.estado = o.estado;
        this.fechaInicio = o.fechaInicio;
        this.fechaFin = o.fechaFin;
        this.nodosAsignados = new ArrayList<>(o.nodosAsignados);
        this.codigoSalida = o.codigoSalida;
        this.rutaResultado = o.rutaResultado;
        this.tamanoResultadoBytes = o.tamanoResultadoBytes;
        this.resultadoIncompleto = o.resultadoIncompleto;
        this.mensajeError = o.mensajeError;
        this.posicionCola = o.posicionCola;
    }

    /** Instantánea para entregar por RMI o persistir. */
    public synchronized TrabajoHpc copia() {
        return new TrabajoHpc(this);
    }

    /** Solicitud equivalente, para ReintentarTrabajo (§3.6: usa el código ACTUAL). */
    public SolicitudTrabajo comoSolicitud() {
        return new SolicitudTrabajo(nombreTrabajo, rutaCodigo, rutaDataset, numeroProcesos,
                tiempoMaximoEjecucion, prioridad, parametrosEjecucion);
    }

    public boolean esDe(String uid) {
        return propietario.equals(uid);
    }

    public String getId() { return id; }
    public String getPropietario() { return propietario; }
    public String getNombreTrabajo() { return nombreTrabajo; }
    public String getRutaCodigo() { return rutaCodigo; }
    public String getRutaDataset() { return rutaDataset; }
    public int getNumeroProcesos() { return numeroProcesos; }
    public int getTiempoMaximoEjecucion() { return tiempoMaximoEjecucion; }
    public Map<String, String> getParametrosEjecucion() { return new LinkedHashMap<>(parametrosEjecucion); }
    public String getTrabajoOriginalId() { return trabajoOriginalId; }
    public Instant getFechaEnvio() { return fechaEnvio; }

    public String getCodigoId() { return codigoId; }
    public String getNombreCodigo() { return nombreCodigo; }
    public void setCodigo(String id, String nombre) { this.codigoId = id; this.nombreCodigo = nombre; }
    public String getDatasetId() { return datasetId; }
    public String getNombreDataset() { return nombreDataset; }
    public void setDataset(String id, String nombre) { this.datasetId = id; this.nombreDataset = nombre; }

    public Prioridad getPrioridad() { return prioridad; }
    public void setPrioridad(Prioridad prioridad) { this.prioridad = prioridad; }
    public EstadoTrabajo getEstado() { return estado; }
    public void setEstado(EstadoTrabajo estado) { this.estado = estado; }
    public Instant getFechaInicio() { return fechaInicio; }
    public void setFechaInicio(Instant fechaInicio) { this.fechaInicio = fechaInicio; }
    public Instant getFechaFin() { return fechaFin; }
    public void setFechaFin(Instant fechaFin) { this.fechaFin = fechaFin; }
    public List<String> getNodosAsignados() { return new ArrayList<>(nodosAsignados); }
    public void setNodosAsignados(List<String> nodos) { this.nodosAsignados = new ArrayList<>(nodos); }
    public Integer getCodigoSalida() { return codigoSalida; }
    public void setCodigoSalida(Integer codigoSalida) { this.codigoSalida = codigoSalida; }
    public String getRutaResultado() { return rutaResultado; }
    public void setRutaResultado(String rutaResultado) { this.rutaResultado = rutaResultado; }
    public long getTamanoResultadoBytes() { return tamanoResultadoBytes; }
    public void setTamanoResultadoBytes(long bytes) { this.tamanoResultadoBytes = bytes; }
    public boolean isResultadoIncompleto() { return resultadoIncompleto; }
    public void setResultadoIncompleto(boolean incompleto) { this.resultadoIncompleto = incompleto; }
    public String getMensajeError() { return mensajeError; }
    public void setMensajeError(String mensajeError) { this.mensajeError = mensajeError; }
    public int getPosicionCola() { return posicionCola; }
    public void setPosicionCola(int posicionCola) { this.posicionCola = posicionCola; }

    @Override
    public boolean equals(Object o) {
        return o instanceof TrabajoHpc t && id.equals(t.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }

    @Override
    public String toString() {
        return "TrabajoHpc{id='" + id + "', nombre='" + nombreTrabajo + "', estado=" + estado + "}";
    }
}
