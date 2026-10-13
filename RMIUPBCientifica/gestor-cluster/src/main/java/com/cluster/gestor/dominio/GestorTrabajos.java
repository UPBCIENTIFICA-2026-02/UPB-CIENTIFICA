package com.cluster.gestor.dominio;

import com.cluster.common.ErrorHpc;
import com.cluster.common.ErrorHpc.Codigo;
import com.cluster.common.EstadoCluster;
import com.cluster.common.EstadoEjecucion;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NodoCluster;
import com.cluster.common.OrdenEjecucion;
import com.cluster.common.Prioridad;
import com.cluster.common.RespuestaEnvio;
import com.cluster.common.ResultadoTrabajo;
import com.cluster.common.SolicitudTrabajo;
import com.cluster.common.TrabajoHpc;
import com.cluster.common.TransicionesTrabajo;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import static com.cluster.common.EstadoTrabajo.*;

/**
 * HPC Service + Scheduler (Contrato_HPC). Orquesta el flujo de negocio central:
 *
 * <pre>
 *  EnviarTrabajo: reglas -> código/dataset existen en Storage (con el token del
 *                 usuario) -> TrabajoHPC PENDIENTE -> EN_COLA
 *  Planificador:  cola con envejecimiento -> AsignarNodos según la carga
 *  Ejecución:     descarga código/dataset -> job-runner compila y lanza mpirun
 *                 en los nodos asignados -> espera (con tiempo máximo)
 *  Finalización:  resultado al Home ("Resultados HPC/...") -> LiberarNodos ->
 *                 COMPLETADO / FALLIDO / FALLIDO_TIMEOUT
 * </pre>
 *
 * No conoce RMI ni HTTP: Storage y el clúster le llegan como {@link Almacenamiento}
 * y {@link Ejecutor}. El uid lo pasa siempre la capa RMI, sacado del token.
 *
 * CONCURRENCIA: un candado para la cola y el monitor de cada trabajo para su
 * estado. Orden fijo para no bloquearse: primero la cola, después el trabajo.
 *
 * TOKENS: para leer el código y guardar el resultado en nombre del usuario hace
 * falta su token; se recuerda el último con el que hizo cualquier operación. Si
 * vence mientras el trabajo espera, el trabajo sigue en cola hasta que vuelva.
 */
public final class GestorTrabajos {

    /** Lo que el monitoreo quiere saber (MetricasHpc). */
    public interface Observador {
        void trabajoEnviado(TrabajoHpc t);

        void trabajoTerminado(TrabajoHpc t);

        void nodoEnFalla(String nodo);
    }

    private static final int MAX_LOGS = 64 * 1024;
    private static final Pattern HOST = Pattern.compile("[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?");
    private static final Duration ESPERA_REINTENTO = Duration.ofSeconds(15);

    private final Almacenamiento almacen;
    private final Ejecutor ejecutor;
    private final RegistroNodos nodos;
    private final ReglasTrabajo reglas;
    private final Persistencia persistencia;
    private final Planificador planificador;
    private final Duration sondeo;
    private volatile Observador observador = new Observador() {
        public void trabajoEnviado(TrabajoHpc t) { }
        public void trabajoTerminado(TrabajoHpc t) { }
        public void nodoEnFalla(String nodo) { }
    };

    private final Map<String, TrabajoHpc> trabajos = new ConcurrentHashMap<>();
    private final Map<String, String> logs = new ConcurrentHashMap<>();
    private final Map<String, String> tokens = new ConcurrentHashMap<>();
    private final Map<String, Instant> noAntesDe = new ConcurrentHashMap<>();
    private final Set<String> pendientesGuardar = ConcurrentHashMap.newKeySet();
    private final Object candado = new Object();

    private final ExecutorService ejecuciones = Executors.newCachedThreadPool(hilos("hpc-ejecucion"));
    private final ScheduledExecutorService tareas = Executors.newScheduledThreadPool(2, hilos("hpc-tareas"));
    private volatile boolean ejecutorConectado;
    private volatile boolean sucio;

    public GestorTrabajos(Almacenamiento almacen, Ejecutor ejecutor, RegistroNodos nodos,
                          ReglasTrabajo reglas, Persistencia persistencia,
                          Duration envejecimiento, Duration sondeo) {
        this.almacen = almacen;
        this.ejecutor = ejecutor;
        this.nodos = nodos;
        this.reglas = reglas;
        this.persistencia = persistencia;
        this.planificador = new Planificador(envejecimiento);
        this.sondeo = sondeo;
    }

    public void setObservador(Observador observador) {
        this.observador = observador;
    }

    /** Restaura lo persistido y arranca el planificador y las tareas periódicas. */
    public void arrancar() {
        restaurar();
        tareas.execute(this::comprobarSalud);
        tareas.scheduleWithFixedDelay(this::planificar, 1, 1, TimeUnit.SECONDS);
        tareas.scheduleWithFixedDelay(this::comprobarSalud, 30, 30, TimeUnit.SECONDS);
        tareas.scheduleWithFixedDelay(this::reintentarGuardados, 30, 30, TimeUnit.SECONDS);
        tareas.scheduleWithFixedDelay(this::persistirSiHaceFalta, 5, 5, TimeUnit.SECONDS);
    }

    public void detener() {
        tareas.shutdownNow();
        ejecuciones.shutdownNow();
        persistir();
    }

    /** La capa RMI lo llama en cada operación autenticada. */
    public void recordarToken(String uid, String token) {
        tokens.put(uid, token);
    }

    // =====================================================================
    // Operaciones del contrato
    // =====================================================================

    /** EnviarTrabajo (§3.1). {@code originalId}/{@code advertencia} solo en reintentos. */
    public RespuestaEnvio enviar(String uid, String token, SolicitudTrabajo s, boolean puedePrioridadAlta,
                                 String originalId, String advertencia)
            throws ErrorHpc, Almacenamiento.NoDisponible {
        reglas.validar(s);
        if (s.getPrioridad() == Prioridad.ALTA && !puedePrioridadAlta) {
            throw new ErrorHpc(Codigo.PRIORIDAD_SIN_PERMISO,
                    "La prioridad ALTA requiere el permiso hpc:prioridad-alta (servicio hpcadmin)");
        }
        int instalada = nodos.capacidadInstalada();
        if (s.getNumeroProcesos() > instalada) {
            throw new ErrorHpc(Codigo.PROCESOS_EXCEDEN_CUOTA,
                    "El clúster tiene " + instalada + " procesos en total; se pidieron " + s.getNumeroProcesos());
        }

        Almacenamiento.Elemento codigo = resolverArchivo(token, s.getRutaCodigo(),
                Codigo.CODIGO_NO_ENCONTRADO, "el código");
        reglas.lenguajeDe(codigo.nombre());
        Almacenamiento.Elemento dataset = s.getRutaDataset() == null ? null
                : resolverArchivo(token, s.getRutaDataset(), Codigo.DATASET_NO_ENCONTRADO, "el dataset");

        TrabajoHpc t = new TrabajoHpc(UUID.randomUUID().toString(), uid, s, originalId);
        t.setCodigo(codigo.id(), codigo.nombre());
        if (dataset != null) {
            t.setDataset(dataset.id(), dataset.nombre());
        }
        trabajos.put(t.getId(), t);
        tokens.put(uid, token);
        int posicion;
        synchronized (candado) {
            synchronized (t) {
                cambiar(t, EN_COLA);
            }
            planificador.encolar(t);
            posicion = planificador.posicion(t, Instant.now());
        }
        observador.trabajoEnviado(t.copia());
        sucio = true;
        tareas.execute(this::planificar);
        // El contrato fija estadoInicial = PENDIENTE "al momento de la respuesta".
        return new RespuestaEnvio(t.getId(), PENDIENTE, posicion, t.getFechaEnvio(), advertencia);
    }

    /** ConsultarEstadoTrabajo (§3.2). */
    public TrabajoHpc consultar(String uid, String id) throws ErrorHpc {
        return vista(propio(uid, id));
    }

    /** ListarTrabajosUsuario (§3.5), del más reciente al más antiguo. */
    public List<TrabajoHpc> listar(String uid, EstadoTrabajo filtro) {
        List<TrabajoHpc> lista = new ArrayList<>();
        for (TrabajoHpc t : trabajos.values()) {
            if (t.esDe(uid) && (filtro == null || t.getEstado() == filtro)) {
                lista.add(vista(t));
            }
        }
        lista.sort(Comparator.comparing(TrabajoHpc::getFechaEnvio).reversed());
        return lista;
    }

    /** ObtenerResultado (§3.3): la ruta en el Home, no el contenido. */
    public ResultadoTrabajo resultado(String uid, String id) throws ErrorHpc {
        TrabajoHpc t = propio(uid, id).copia();
        boolean conResultado = t.getRutaResultado() != null
                && (t.getEstado() == COMPLETADO || t.getEstado() == FALLIDO_TIMEOUT);
        if (conResultado) {
            return new ResultadoTrabajo(t.getId(), t.getRutaResultado(), t.getTamanoResultadoBytes(),
                    t.getFechaFin(), t.getCodigoSalida(), t.isResultadoIncompleto());
        }
        if (t.getEstado() == FALLIDO || t.getEstado() == CANCELADO) {
            String donde = t.getRutaResultado() == null ? "" : " Los registros están en " + t.getRutaResultado();
            throw new ErrorHpc(Codigo.TRABAJO_SIN_RESULTADO, "El trabajo terminó como " + t.getEstado()
                    + " y no produjo un resultado válido." + donde);
        }
        throw new ErrorHpc(Codigo.RESULTADO_NO_DISPONIBLE,
                "El trabajo aún no tiene resultado (estado " + t.getEstado() + ")");
    }

    /** ObtenerLogsTrabajo (§3.5). En vivo mientras se ejecuta; guardados después. */
    public String logs(String uid, String id) throws ErrorHpc {
        TrabajoHpc t = propio(uid, id);
        EstadoTrabajo e = t.getEstado();
        if (e == PENDIENTE || e == EN_COLA) {
            throw new ErrorHpc(Codigo.LOGS_NO_DISPONIBLES, "El trabajo todavía no ha empezado a ejecutarse");
        }
        if (e == EJECUTANDO) {
            try {
                return ejecutor.logs(id, MAX_LOGS);
            } catch (Ejecutor.NoDisponible ex) {
                return "(job-runner no responde en este momento)";
            }
        }
        return logs.getOrDefault(id, "");
    }

    /** CancelarTrabajo (§3.4). */
    public TrabajoHpc cancelar(String uid, String id) throws ErrorHpc {
        TrabajoHpc t = propio(uid, id);
        boolean enEjecucion = false;
        synchronized (candado) {
            synchronized (t) {
                if (!TransicionesTrabajo.esCancelable(t.getEstado())) {
                    throw new ErrorHpc(Codigo.NO_CANCELABLE,
                            "El trabajo ya terminó (" + t.getEstado() + "); no se puede cancelar");
                }
                if (t.getEstado() == EJECUTANDO) {
                    enEjecucion = true;
                } else {
                    planificador.quitar(t);
                    cambiar(t, CANCELADO);
                    t.setFechaFin(Instant.now());
                }
            }
        }
        if (enEjecucion) {
            try {
                // §8: si el resultado ya está calculado, prima la finalización.
                EstadoEjecucion e = ejecutor.consultar(id);
                if (e.terminado() && e.codigoSalida() != null && e.codigoSalida() == 0 && !e.cancelado()) {
                    throw new ErrorHpc(Codigo.NO_CANCELABLE,
                            "El trabajo ya terminó y su resultado se está guardando; no se puede cancelar");
                }
                ejecutor.cancelar(id);
            } catch (Ejecutor.NoDisponible ex) {
                // Se marca igual: cuando job-runner vuelva, el hilo de ejecución verá CANCELADO.
            }
            synchronized (t) {
                if (t.getEstado() == EJECUTANDO) {
                    cambiar(t, CANCELADO);
                    t.setFechaFin(Instant.now());
                }
            }
        }
        sucio = true;
        return vista(t);
    }

    /** DefinirPrioridadTrabajo (§3.6). Solo mientras sigue EN_COLA. */
    public TrabajoHpc definirPrioridad(String uid, String id, Prioridad nueva, boolean puedePrioridadAlta)
            throws ErrorHpc {
        if (nueva == null) {
            throw new ErrorHpc(Codigo.DATOS_INVALIDOS, "Falta nuevaPrioridad");
        }
        if (nueva == Prioridad.ALTA && !puedePrioridadAlta) {
            throw new ErrorHpc(Codigo.PRIORIDAD_SIN_PERMISO,
                    "La prioridad ALTA requiere el permiso hpc:prioridad-alta (servicio hpcadmin)");
        }
        TrabajoHpc t = propio(uid, id);
        synchronized (candado) {
            synchronized (t) {
                if (t.getEstado() != EN_COLA) {
                    throw new ErrorHpc(Codigo.PRIORIDAD_NO_MODIFICABLE,
                            "Solo se cambia la prioridad de un trabajo EN_COLA (está " + t.getEstado() + ")");
                }
                t.setPrioridad(nueva);
            }
        }
        sucio = true;
        return vista(t);
    }

    /** ReintentarTrabajo (§3.6): trabajo NUEVO enlazado al fallido, con el código ACTUAL. */
    public RespuestaEnvio reintentar(String uid, String token, String id, boolean puedePrioridadAlta)
            throws ErrorHpc, Almacenamiento.NoDisponible {
        TrabajoHpc t = propio(uid, id);
        if (!TransicionesTrabajo.esReintentable(t.getEstado())) {
            throw new ErrorHpc(Codigo.NO_REINTENTABLE,
                    "Solo se reintenta un trabajo FALLIDO o FALLIDO_TIMEOUT (está " + t.getEstado() + ")");
        }
        return enviar(uid, token, t.comoSolicitud(), puedePrioridadAlta, t.getId(),
                "El reintento usa la versión ACTUAL del código y del dataset, no la del intento original.");
    }

    /** ObtenerEstadoCluster + ObtenerEstadoCola (§3.9). */
    public EstadoCluster estadoCluster() {
        List<NodoCluster> lista = nodos.instantanea();
        int disponibles = 0;
        int enFalla = 0;
        int total = 0;
        int enUso = 0;
        for (NodoCluster n : lista) {
            if (n.estado() == NodoCluster.Estado.EN_FALLA) {
                enFalla++;
                continue;
            }
            if (n.estado() == NodoCluster.Estado.DISPONIBLE) disponibles++;
            total += n.capacidadProcesos();
            enUso += n.cargaActual();
        }
        int enCola;
        synchronized (candado) {
            enCola = planificador.tamano();
        }
        int ejecutando = (int) trabajos.values().stream().filter(t -> t.getEstado() == EJECUTANDO).count();
        double uso = total == 0 ? 0 : (double) enUso / total;
        return new EstadoCluster(lista.size(), disponibles, enFalla, uso, total, enUso,
                enCola, ejecutando, esperaPromedioSegundos(), ejecutorConectado, lista);
    }

    /** Suma un equipo a la malla. Se comprueba por SSH desde hpc-master. */
    public NodoCluster registrarNodo(String host, int capacidad, boolean externo) throws ErrorHpc {
        if (host == null || !HOST.matcher(host).matches()) {
            throw new ErrorHpc(Codigo.NODO_INVALIDO, "Nombre de host no válido");
        }
        if (capacidad < 1 || capacidad > 256) {
            throw new ErrorHpc(Codigo.NODO_INVALIDO, "capacidadProcesos debe estar entre 1 y 256");
        }
        nodos.registrar(host, capacidad, externo ? NodoCluster.Origen.EXTERNO : NodoCluster.Origen.LABORATORIO);
        boolean responde;
        try {
            responde = ejecutor.nodosSinRespuesta(List.of(host)).isEmpty();
        } catch (Ejecutor.NoDisponible e) {
            responde = false;
        }
        if (nodos.marcarFalla(host, !responde) && !responde) {
            observador.nodoEnFalla(host);
        }
        sucio = true;
        tareas.execute(this::planificar);
        return nodos.instantanea().stream().filter(n -> n.id().equals(host)).findFirst().orElseThrow();
    }

    public void retirarNodo(String host) throws ErrorHpc {
        if (!nodos.retirar(host)) {
            throw new ErrorHpc(Codigo.NODO_NO_ENCONTRADO, "No hay ningún nodo " + host);
        }
        sucio = true;
    }

    /** Copia de todos los trabajos, para las métricas. */
    public List<TrabajoHpc> todos() {
        List<TrabajoHpc> lista = new ArrayList<>();
        trabajos.values().forEach(t -> lista.add(t.copia()));
        return lista;
    }

    // =====================================================================
    // Planificador y ejecución
    // =====================================================================

    /** Asigna nodos a los trabajos de la cola, en orden de prioridad efectiva. */
    void planificar() {
        try {
            if (!ejecutorConectado) {
                ejecutorConectado = ejecutor.disponible();
                if (!ejecutorConectado) return;
            }
            Instant ahora = Instant.now();
            synchronized (candado) {
                for (TrabajoHpc t : planificador.enOrden(ahora)) {
                    Instant espera = noAntesDe.get(t.getId());
                    if (espera != null && ahora.isBefore(espera)) continue;
                    String token = tokens.get(t.getPropietario());
                    if (token == null) continue;      // espera a que el usuario vuelva a iniciar sesión
                    Map<String, Integer> asignacion =
                            AsignadorNodos.asignar(nodos.instantanea(), t.getNumeroProcesos());
                    if (asignacion == null) continue; // HPC-201: no cabe ahora, sigue en cola

                    synchronized (t) {
                        if (t.getEstado() != EN_COLA) {
                            planificador.quitar(t);
                            continue;
                        }
                        cambiar(t, EJECUTANDO);
                        t.setFechaInicio(ahora);
                        t.setNodosAsignados(new ArrayList<>(asignacion.keySet()));
                        t.setMensajeError(null);
                    }
                    planificador.quitar(t);
                    noAntesDe.remove(t.getId());
                    nodos.reservar(asignacion);
                    sucio = true;
                    ejecuciones.submit(() -> ejecutar(t, asignacion, token));
                }
            }
        } catch (RuntimeException e) {
            System.err.println("[gestor-cluster] Error en el planificador: " + e);
        }
    }

    private void ejecutar(TrabajoHpc t, Map<String, Integer> asignacion, String token) {
        String id = t.getId();
        boolean nodosLiberados = false;
        boolean iniciado = false;
        try {
            // 1. Re-validar y descargar: el código pudo borrarse tras validarlo (§8).
            byte[] codigo;
            byte[] dataset = null;
            try {
                codigo = almacen.descargar(token, t.getCodigoId());
                if (codigo == null) {
                    terminar(t, FALLIDO, "HPC-001: el código ya no existe o perdiste el permiso de lectura");
                    return;
                }
                if (t.getDatasetId() != null) {
                    dataset = almacen.descargar(token, t.getDatasetId());
                    if (dataset == null) {
                        terminar(t, FALLIDO, "HPC-002: el dataset ya no existe o perdiste el permiso de lectura");
                        return;
                    }
                }
            } catch (Almacenamiento.SesionVencida e) {
                tokens.remove(t.getPropietario(), token);
                devolverACola(t, "Esperando a que el usuario vuelva a iniciar sesión (la sesión venció)");
                return;
            } catch (Almacenamiento.NoDisponible e) {
                devolverACola(t, "Storage no responde; se reintentará en breve");
                return;
            }

            // 2. Un nodo puede caer entre la asignación y el arranque: se reasigna (§8).
            List<String> caidos = ejecutor.nodosSinRespuesta(new ArrayList<>(asignacion.keySet()));
            if (!caidos.isEmpty()) {
                for (String n : caidos) {
                    if (nodos.marcarFalla(n, true)) observador.nodoEnFalla(n);
                }
                // Sin espera: el nodo ya quedó EN_FALLA y el siguiente ciclo elige otros.
                devolverACola(t, "Nodo sin respuesta " + caidos + "; se reasigna a otros nodos", Duration.ZERO);
                return;
            }

            // 3. Lanzar en el clúster.
            ejecutor.iniciar(new OrdenEjecucion(id, t.getNombreCodigo(), codigo, t.getNombreDataset(), dataset,
                    t.getNumeroProcesos(), asignacion, ReglasTrabajo.argumentos(t.getParametrosEjecucion()),
                    t.getTiempoMaximoEjecucion()));
            iniciado = true;

            // 4. Esperar. job-runner corta por tiempo; el gestor solo vigila que no se cuelgue.
            Instant limite = Instant.now().plusSeconds(t.getTiempoMaximoEjecucion() + 120L);
            EstadoEjecucion estado;
            int fallos = 0;
            while (true) {
                Thread.sleep(sondeo.toMillis());
                try {
                    estado = ejecutor.consultar(id);
                    fallos = 0;
                } catch (Ejecutor.NoDisponible e) {
                    if (++fallos >= 30) {
                        terminar(t, FALLIDO, "job-runner dejó de responder durante la ejecución");
                        return;
                    }
                    continue;
                }
                if (estado.terminado()) break;
                if (Instant.now().isAfter(limite)) ejecutor.cancelar(id);
            }

            // 5. Desenlace.
            guardarLogs(id);
            synchronized (t) {
                t.setCodigoSalida(estado.codigoSalida());
            }
            nodos.liberar(asignacion);
            nodosLiberados = true;

            if (t.getEstado() == CANCELADO) {
                limpiarEnEjecutor(id);
                return;
            }
            if (EstadoEjecucion.DESCONOCIDO.equals(estado.fase())) {
                terminar(t, FALLIDO, "job-runner no reconoce el trabajo (¿se reinició hpc-master?). Usa Reintentar");
                return;
            }
            if (estado.cancelado()) {
                terminar(t, CANCELADO, null);
                limpiarEnEjecutor(id);
                return;
            }
            EstadoTrabajo destino;
            String mensaje = null;
            boolean incompleto = false;
            if (estado.errorCompilacion()) {
                destino = FALLIDO;
                mensaje = "HPC-004: el código no compiló. El detalle está en compilacion.txt";
            } else if (estado.tiempoAgotado()) {
                destino = FALLIDO_TIMEOUT;
                incompleto = true;
                mensaje = "Superó tiempoMaximoEjecucion (" + t.getTiempoMaximoEjecucion()
                        + " s); la salida parcial se guardó marcada como incompleta";
            } else if (estado.codigoSalida() != null && estado.codigoSalida() == 0) {
                destino = COMPLETADO;
                mensaje = "Terminó; guardando el resultado en tu Home";
            } else {
                destino = FALLIDO;
                mensaje = "mpirun terminó con código " + estado.codigoSalida()
                        + (estado.mensaje() == null ? "" : ": " + estado.mensaje());
            }
            synchronized (t) {
                if (!TransicionesTrabajo.esValida(t.getEstado(), destino)) {
                    return; // lo cancelaron justo ahora
                }
                t.setResultadoIncompleto(incompleto);
                t.setMensajeError(mensaje);
                cambiar(t, destino == COMPLETADO ? COMPLETADO_PENDIENTE_ALMACENAMIENTO : destino);
                t.setFechaFin(Instant.now());
            }
            observador.trabajoTerminado(t.copia());
            pendientesGuardar.add(id);
            intentarGuardar(t);
        } catch (Ejecutor.NoDisponible e) {
            if (!iniciado) {
                ejecutorConectado = false;
                devolverACola(t, "job-runner (hpc-master) no responde; el trabajo espera en cola");
            } else {
                terminar(t, FALLIDO, "Se perdió la conexión con job-runner: " + e.getMessage());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            terminar(t, FALLIDO, "Error interno del gestor: " + e.getMessage());
        } finally {
            if (!nodosLiberados) nodos.liberar(asignacion);
            sucio = true;
            if (!tareas.isShutdown()) tareas.execute(this::planificar);
        }
    }

    /**
     * Guarda en el Home la salida del trabajo. Si Storage no responde o la sesión
     * venció, el trabajo queda en COMPLETADO_PENDIENTE_ALMACENAMIENTO y se
     * reintenta: nunca se pierde un resultado ya calculado (§3.10).
     */
    private void intentarGuardar(TrabajoHpc t) {
        String id = t.getId();
        String token = tokens.get(t.getPropietario());
        if (token == null) return;
        Map<String, byte[]> archivos;
        try {
            archivos = new HashMap<>(ejecutor.resultados(id));
        } catch (Ejecutor.NoDisponible e) {
            return;
        }
        if (t.isResultadoIncompleto()) {
            archivos.put("INCOMPLETO.txt", ("Resultado INCOMPLETO: el trabajo superó su tiempo máximo de "
                    + t.getTiempoMaximoEjecucion() + " s y se detuvo. Estos archivos son la salida parcial.\n")
                    .getBytes(StandardCharsets.UTF_8));
        }
        String ruta;
        try {
            ruta = almacen.guardar(token, "Resultados HPC/" + nombreCarpeta(t), archivos);
        } catch (Almacenamiento.SesionVencida e) {
            tokens.remove(t.getPropietario(), token);
            return;
        } catch (Almacenamiento.NoDisponible e) {
            synchronized (t) {
                if (t.getEstado() == COMPLETADO_PENDIENTE_ALMACENAMIENTO) {
                    t.setMensajeError("El resultado está calculado pero no se pudo guardar en tu Home ("
                            + e.getMessage() + "); se reintenta cada 30 s");
                }
            }
            return;
        }
        long tamano = archivos.values().stream().mapToLong(b -> b.length).sum();
        synchronized (t) {
            t.setRutaResultado(ruta);
            t.setTamanoResultadoBytes(tamano);
            if (t.getEstado() == COMPLETADO_PENDIENTE_ALMACENAMIENTO) {
                cambiar(t, COMPLETADO);
                t.setMensajeError(null);
            }
        }
        pendientesGuardar.remove(id);
        limpiarEnEjecutor(id);
        sucio = true;
    }

    private void reintentarGuardados() {
        for (String id : List.copyOf(pendientesGuardar)) {
            TrabajoHpc t = trabajos.get(id);
            if (t == null) {
                pendientesGuardar.remove(id);
            } else {
                intentarGuardar(t);
            }
        }
    }

    private void comprobarSalud() {
        try {
            ejecutorConectado = ejecutor.disponible();
            if (!ejecutorConectado) return;
            List<String> ids = nodos.ids();
            List<String> caidos = ejecutor.nodosSinRespuesta(ids);
            for (String n : ids) {
                boolean falla = caidos.contains(n);
                if (nodos.marcarFalla(n, falla) && falla) {
                    observador.nodoEnFalla(n);
                    System.err.println("[gestor-cluster] NodoEnFalla: " + n);
                }
            }
        } catch (Ejecutor.NoDisponible e) {
            ejecutorConectado = false;
        } catch (RuntimeException e) {
            System.err.println("[gestor-cluster] Error comprobando nodos: " + e);
        }
    }

    // =====================================================================
    // Utilidades
    // =====================================================================

    private Almacenamiento.Elemento resolverArchivo(String token, String ruta, Codigo siFalta, String que)
            throws ErrorHpc, Almacenamiento.NoDisponible {
        Almacenamiento.Elemento e;
        try {
            e = almacen.resolver(token, ruta);
        } catch (Almacenamiento.SesionVencida ex) {
            throw new Almacenamiento.NoDisponible("Storage rechazó el token de la sesión", ex);
        }
        if (e == null) {
            throw new ErrorHpc(siFalta, "No se encontró " + que + " '" + ruta + "' o no tienes permiso de lectura");
        }
        if (e.esDirectorio()) {
            throw new ErrorHpc(siFalta, "'" + ruta + "' es un directorio; " + que + " tiene que ser un archivo");
        }
        return e;
    }

    private TrabajoHpc propio(String uid, String id) throws ErrorHpc {
        TrabajoHpc t = id == null ? null : trabajos.get(id);
        // 404 también si es de otro: no se revela qué identificadores existen.
        if (t == null || !t.esDe(uid)) throw ErrorHpc.trabajoNoEncontrado(id);
        return t;
    }

    private TrabajoHpc vista(TrabajoHpc t) {
        synchronized (candado) {
            TrabajoHpc copia = t.copia();
            if (copia.getEstado() == EN_COLA) {
                copia.setPosicionCola(planificador.posicion(t, Instant.now()));
            }
            return copia;
        }
    }

    private static void cambiar(TrabajoHpc t, EstadoTrabajo nuevo) {
        if (!TransicionesTrabajo.esValida(t.getEstado(), nuevo)) {
            throw new IllegalStateException("Transición inválida " + t.getEstado() + " -> " + nuevo);
        }
        t.setEstado(nuevo);
    }

    private void terminar(TrabajoHpc t, EstadoTrabajo estado, String mensaje) {
        boolean cambio = false;
        synchronized (t) {
            if (TransicionesTrabajo.esValida(t.getEstado(), estado)) {
                t.setEstado(estado);
                t.setFechaFin(Instant.now());
                if (mensaje != null) t.setMensajeError(mensaje);
                cambio = true;
            }
        }
        if (cambio) observador.trabajoTerminado(t.copia());
        sucio = true;
    }

    private void devolverACola(TrabajoHpc t, String motivo) {
        devolverACola(t, motivo, ESPERA_REINTENTO);
    }

    /** Vuelve a la cola; {@code espera} evita reintentar en bucle si Storage o job-runner siguen caídos. */
    private void devolverACola(TrabajoHpc t, String motivo, Duration espera) {
        synchronized (candado) {
            synchronized (t) {
                if (t.getEstado() != EJECUTANDO) return;
                cambiar(t, EN_COLA);
                t.setMensajeError(motivo);
                t.setNodosAsignados(List.of());
                t.setFechaInicio(null);
            }
            planificador.encolar(t);
            noAntesDe.put(t.getId(), Instant.now().plus(espera));
        }
        sucio = true;
    }

    private void guardarLogs(String id) {
        try {
            logs.put(id, ejecutor.logs(id, MAX_LOGS));
        } catch (Ejecutor.NoDisponible e) {
            logs.put(id, "(no se pudieron recuperar los logs: job-runner no respondió)");
        }
    }

    private void limpiarEnEjecutor(String id) {
        try {
            ejecutor.limpiar(id);
        } catch (Ejecutor.NoDisponible ignorado) {
            // Queda el directorio en el clúster; no afecta al usuario.
        }
    }

    /** "Mi simulación" -> "Mi_simulacion-1a2b3c4d": sin caracteres que Storage o el FS rechacen. */
    static String nombreCarpeta(TrabajoHpc t) {
        String base = Normalizer.normalize(t.getNombreTrabajo(), Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .replaceAll("[^A-Za-z0-9._-]+", "_")
                .replaceAll("^[._]+", "");
        if (base.isEmpty()) base = "trabajo";
        if (base.length() > 60) base = base.substring(0, 60);
        return base + "-" + t.getId().substring(0, 8);
    }

    private long esperaPromedioSegundos() {
        return (long) trabajos.values().stream()
                .map(TrabajoHpc::copia)
                .filter(t -> t.getFechaInicio() != null)
                .sorted(Comparator.comparing(TrabajoHpc::getFechaInicio).reversed())
                .limit(50)
                .mapToLong(t -> Duration.between(t.getFechaEnvio(), t.getFechaInicio()).toSeconds())
                .average().orElse(0);
    }

    private void persistirSiHaceFalta() {
        if (sucio) {
            sucio = false;
            persistir();
        }
    }

    private void persistir() {
        try {
            List<NodoCluster> externos = nodos.instantanea().stream()
                    .filter(n -> n.origen() == NodoCluster.Origen.EXTERNO).toList();
            persistencia.guardar(new Persistencia.Instantanea(todos(), new HashMap<>(logs), externos));
        } catch (RuntimeException e) {
            System.err.println("[gestor-cluster] No se pudo guardar el estado: " + e);
        }
    }

    /**
     * Tras un reinicio: lo que estaba en cola vuelve a la cola; lo que se estaba
     * ejecutando se da por fallido (no hay forma de saber si terminó) y se puede
     * reintentar; lo que faltaba guardar se sigue intentando.
     */
    private void restaurar() {
        Persistencia.Instantanea guardado = persistencia.cargar();
        if (guardado == null) return;
        guardado.nodosExternos().forEach(n ->
                nodos.registrar(n.id(), n.capacidadProcesos(), NodoCluster.Origen.EXTERNO));
        logs.putAll(guardado.logs());
        synchronized (candado) {
            for (TrabajoHpc t : guardado.trabajos()) {
                trabajos.put(t.getId(), t);
                switch (t.getEstado()) {
                    case PENDIENTE -> {
                        t.setEstado(EN_COLA);
                        planificador.encolar(t);
                    }
                    case EN_COLA -> planificador.encolar(t);
                    case EJECUTANDO -> {
                        t.setEstado(FALLIDO);
                        t.setFechaFin(Instant.now());
                        t.setMensajeError("El gestor se reinició mientras el trabajo se ejecutaba; usa Reintentar");
                    }
                    case COMPLETADO_PENDIENTE_ALMACENAMIENTO -> pendientesGuardar.add(t.getId());
                    default -> { }
                }
            }
        }
        System.out.println("[gestor-cluster] Restaurados " + guardado.trabajos().size() + " trabajos");
    }

    private static ThreadFactory hilos(String nombre) {
        return r -> {
            Thread h = new Thread(r, nombre);
            h.setDaemon(true);
            return h;
        };
    }
}
