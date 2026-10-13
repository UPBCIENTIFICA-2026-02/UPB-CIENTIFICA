package com.cluster.common;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;

/**
 * Representa un trabajo gestionado por {@code gestor-cluster}.
 *
 * Este objeto viaja por valor a través de RMI (implementa {@link Serializable}),
 * por lo que cada invocación remota que lo retorna entrega una copia
 * serializada/deserializada, nunca una referencia compartida entre JVMs.
 *
 * Se declara {@code serialVersionUID} explícito porque {@code common} se
 * compila una única vez y se comparte como dependencia entre
 * {@code gestor-cluster} y {@code job-api}; fijar el UID evita
 * {@code InvalidClassException} si en el futuro ambos módulos se despliegan
 * con versiones ligeramente distintas del artefacto {@code common}.
 *
 * Cada atributo tiene un uso concreto en el contrato de {@link JobService}:
 * no se agregan campos sin una razón de negocio.
 */
public class Job implements Serializable {

    private static final long serialVersionUID = 1L;

    private final String id;
    private final String nombre;
    private final String comando;
    private final int prioridad;
    /**
     * uid del usuario que envió el trabajo, tomado del token validado.
     *
     * Sin este campo no había forma de filtrar {@code listJobs} por usuario ni
     * de impedir que alguien cancelara el trabajo de otro: el contrato no
     * registraba de quién era cada trabajo.
     */
    private final String propietario;
    private volatile JobStatus estado;
    private final Instant fechaCreacion;
    private volatile Instant fechaInicio;
    private volatile Instant fechaFin;
    private volatile String resultado;
    private volatile String mensajeError;

    public Job(String id, String nombre, String comando, int prioridad, String propietario) {
        this.id = Objects.requireNonNull(id, "id no puede ser nulo");
        this.nombre = Objects.requireNonNull(nombre, "nombre no puede ser nulo");
        this.comando = Objects.requireNonNull(comando, "comando no puede ser nulo");
        this.prioridad = prioridad;
        this.propietario = Objects.requireNonNull(propietario, "propietario no puede ser nulo");
        this.estado = JobStatus.QUEUED;
        this.fechaCreacion = Instant.now();
    }

    /**
     * Constructor sin propietario, solo para pruebas del modelo.
     *
     * El servicio SIEMPRE usa el constructor de cinco argumentos: el propietario
     * sale del token validado, nunca del cuerpo de la petición.
     */
    public Job(String id, String nombre, String comando, int prioridad) {
        this(id, nombre, comando, prioridad, "desconocido");
    }

    public String getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public String getComando() {
        return comando;
    }

    public int getPrioridad() {
        return prioridad;
    }

    public String getPropietario() {
        return propietario;
    }

    /** true si el uid dado es el dueño del trabajo. */
    public boolean esDe(String uid) {
        return propietario.equals(uid);
    }

    public JobStatus getEstado() {
        return estado;
    }

    public void setEstado(JobStatus estado) {
        this.estado = estado;
    }

    public Instant getFechaCreacion() {
        return fechaCreacion;
    }

    public Instant getFechaInicio() {
        return fechaInicio;
    }

    public void setFechaInicio(Instant fechaInicio) {
        this.fechaInicio = fechaInicio;
    }

    public Instant getFechaFin() {
        return fechaFin;
    }

    public void setFechaFin(Instant fechaFin) {
        this.fechaFin = fechaFin;
    }

    public String getResultado() {
        return resultado;
    }

    public void setResultado(String resultado) {
        this.resultado = resultado;
    }

    public String getMensajeError() {
        return mensajeError;
    }

    public void setMensajeError(String mensajeError) {
        this.mensajeError = mensajeError;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Job)) return false;
        Job job = (Job) o;
        return id.equals(job.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }

    @Override
    public String toString() {
        return "Job{id='" + id + "', nombre='" + nombre + "', estado=" + estado
                + ", prioridad=" + prioridad + "}";
    }
}
