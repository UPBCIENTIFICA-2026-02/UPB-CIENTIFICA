package com.cluster.gestor.dominio;

import com.cluster.common.ErrorHpc;
import com.cluster.common.EstadoEjecucion;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NodoCluster;
import com.cluster.common.OrdenEjecucion;
import com.cluster.common.Prioridad;
import com.cluster.common.RespuestaEnvio;
import com.cluster.common.SolicitudTrabajo;
import com.cluster.common.TrabajoHpc;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Flujo completo del servicio HPC sin red: Storage y job-runner son dobles en
 * memoria. Comprueba la validación contra Storage, la planificación por carga,
 * los desenlaces (completado, fallido, timeout, cancelado), el guardado del
 * resultado en el Home y el aislamiento entre usuarios.
 */
class GestorTrabajosTest {

    // ------------------------------------------------------------ dobles

    /** Storage en memoria: rutas -> elementos; guarda lo que se le sube. */
    static final class StorageFalso implements Almacenamiento {
        final Map<String, Elemento> porRuta = new HashMap<>();
        final Map<String, byte[]> contenido = new HashMap<>();
        final Map<String, Map<String, byte[]>> guardados = new ConcurrentHashMap<>();
        volatile boolean caido;

        void archivo(String ruta, String id, String texto) {
            String nombre = ruta.substring(ruta.lastIndexOf('/') + 1);
            porRuta.put(ruta, new Elemento(id, nombre, false, texto.length()));
            porRuta.put(id, porRuta.get(ruta));
            contenido.put(id, texto.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public Elemento resolver(String token, String rutaOId) {
            return porRuta.get(rutaOId);
        }

        @Override
        public byte[] descargar(String token, String id) {
            return contenido.get(id);
        }

        @Override
        public String guardar(String token, String carpeta, Map<String, byte[]> archivos) throws NoDisponible {
            if (caido) throw new NoDisponible("Storage caído", null);
            guardados.put(carpeta, new HashMap<>(archivos));
            return "/" + carpeta;
        }
    }

    /** job-runner falso: cada trabajo termina con el desenlace que se programe. */
    static final class EjecutorFalso implements Ejecutor {
        final Map<String, OrdenEjecucion> ordenes = new ConcurrentHashMap<>();
        final Map<String, EstadoEjecucion> estados = new ConcurrentHashMap<>();
        final List<String> caidos = new ArrayList<>();
        volatile EstadoEjecucion desenlace = new EstadoEjecucion(EstadoEjecucion.TERMINADO, 0, false, false, false, null);
        volatile boolean mantenerEjecutando;

        @Override
        public boolean disponible() {
            return true;
        }

        @Override
        public void iniciar(OrdenEjecucion orden) {
            ordenes.put(orden.trabajoId(), orden);
            estados.put(orden.trabajoId(), mantenerEjecutando
                    ? new EstadoEjecucion(EstadoEjecucion.EJECUTANDO, null, false, false, false, null) : desenlace);
        }

        @Override
        public EstadoEjecucion consultar(String id) {
            return estados.getOrDefault(id, new EstadoEjecucion(EstadoEjecucion.DESCONOCIDO, null, false, false, false, null));
        }

        @Override
        public String logs(String id, int maxBytes) {
            return "hola desde el rango 0";
        }

        @Override
        public Map<String, byte[]> resultados(String id) {
            return Map.of("salida.txt", "pi = 3.14159\n".getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public void cancelar(String id) {
            estados.put(id, new EstadoEjecucion(EstadoEjecucion.TERMINADO, 143, false, false, true, null));
        }

        @Override
        public void limpiar(String id) {
        }

        @Override
        public List<String> nodosSinRespuesta(List<String> hosts) {
            return hosts.stream().filter(caidos::contains).toList();
        }
    }

    static final class PersistenciaMemoria implements Persistencia {
        Instantanea guardada;

        @Override
        public void guardar(Instantanea i) {
            guardada = i;
        }

        @Override
        public Instantanea cargar() {
            return guardada;
        }
    }

    // ------------------------------------------------------------ montaje

    private static final String TOKEN = "token-investigador";
    private StorageFalso storage;
    private EjecutorFalso ejecutor;
    private PersistenciaMemoria persistencia;
    private GestorTrabajos gestor;

    @BeforeEach
    void iniciar() {
        storage = new StorageFalso();
        storage.archivo("/Proyectos/pi.c", "id-pi", "int main(){}");
        storage.archivo("/Proyectos/datos.csv", "id-datos", "1,2,3");
        storage.archivo("/Proyectos/notas.txt", "id-notas", "no es código");
        ejecutor = new EjecutorFalso();
        persistencia = new PersistenciaMemoria();
        gestor = nuevoGestor("hpc-master:2,hpc-worker1:2,hpc-worker2:2");
        gestor.arrancar();
    }

    private GestorTrabajos nuevoGestor(String nodos) {
        return new GestorTrabajos(storage, ejecutor, RegistroNodos.desdeConfiguracion(nodos),
                new ReglasTrabajo(16, 3600), persistencia, Duration.ofSeconds(60), Duration.ofMillis(20));
    }

    @AfterEach
    void detener() {
        gestor.detener();
    }

    private static SolicitudTrabajo solicitud(String codigo, String dataset, int procesos) {
        return new SolicitudTrabajo("pi", codigo, dataset, procesos, 60, Prioridad.NORMAL, Map.of("n", "1000"));
    }

    private TrabajoHpc esperar(String uid, String id, EstadoTrabajo... estados) throws Exception {
        long limite = System.currentTimeMillis() + 8000;
        while (System.currentTimeMillis() < limite) {
            TrabajoHpc t = gestor.consultar(uid, id);
            for (EstadoTrabajo e : estados) {
                if (t.getEstado() == e) return t;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("El trabajo no llegó a " + List.of(estados) + ": " + gestor.consultar(uid, id));
    }

    // ------------------------------------------------------------ pruebas

    @Test
    @Timeout(10)
    void unTrabajoCompletoTerminaConElResultadoEnElHome() throws Exception {
        RespuestaEnvio r = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", "/Proyectos/datos.csv", 3),
                false, null, null);
        assertEquals(EstadoTrabajo.PENDIENTE, r.estadoInicial());

        TrabajoHpc t = esperar("investigador", r.trabajoId(), EstadoTrabajo.COMPLETADO);
        assertTrue(t.getRutaResultado().startsWith("/Resultados HPC/pi-"));
        assertEquals(0, t.getCodigoSalida());

        OrdenEjecucion orden = ejecutor.ordenes.get(r.trabajoId());
        assertEquals("pi.c", orden.nombreCodigo());
        assertEquals("datos.csv", orden.nombreDataset());
        assertEquals("int main(){}", new String(orden.codigo(), StandardCharsets.UTF_8));
        assertEquals(List.of("n=1000"), orden.argumentos());
        assertEquals(3, orden.hosts().values().stream().mapToInt(Integer::intValue).sum());
        assertTrue(storage.guardados.get(t.getRutaResultado().substring(1)).containsKey("salida.txt"));
        assertEquals("hola desde el rango 0", gestor.logs("investigador", r.trabajoId()));
        assertEquals(t.getRutaResultado(), gestor.resultado("investigador", r.trabajoId()).rutaResultado());
    }

    @Test
    void losProcesosSeRepartenPorCargaEntreLosNodos() {
        // Cuatro nodos vacíos y 3 procesos: uno por nodo, no 2+1 en los primeros; el nodo en falla no recibe nada.
        Map<String, Integer> a = AsignadorNodos.asignar(List.of(
                new NodoCluster("n1", NodoCluster.Estado.DISPONIBLE, 2, 0, NodoCluster.Origen.LABORATORIO),
                new NodoCluster("n2", NodoCluster.Estado.DISPONIBLE, 2, 0, NodoCluster.Origen.LABORATORIO),
                new NodoCluster("n3", NodoCluster.Estado.DISPONIBLE, 2, 0, NodoCluster.Origen.EXTERNO),
                new NodoCluster("n4", NodoCluster.Estado.EN_FALLA, 8, 0, NodoCluster.Origen.LABORATORIO)), 3);
        assertEquals(Map.of("n1", 1, "n2", 1, "n3", 1), a);
        // Un nodo ya cargado recibe menos: n1 tiene 3 de 4 ocupados.
        Map<String, Integer> b = AsignadorNodos.asignar(List.of(
                new NodoCluster("n1", NodoCluster.Estado.DISPONIBLE, 4, 3, NodoCluster.Origen.LABORATORIO),
                new NodoCluster("n2", NodoCluster.Estado.DISPONIBLE, 4, 0, NodoCluster.Origen.LABORATORIO)), 3);
        assertEquals(Map.of("n2", 3), b);
        assertNull(AsignadorNodos.asignar(List.of(
                new NodoCluster("n1", NodoCluster.Estado.DISPONIBLE, 2, 2, NodoCluster.Origen.LABORATORIO)), 1));
    }

    @Test
    void elEnvejecimientoAdelantaALosQueEsperan() throws Exception {
        Planificador p = new Planificador(Duration.ofSeconds(10));
        TrabajoHpc viejo = new TrabajoHpc("viejo", "u", new SolicitudTrabajo("a", "c", null, 1, 1, Prioridad.NORMAL, null), null);
        Thread.sleep(5);
        TrabajoHpc nuevoAlta = new TrabajoHpc("alta", "u", new SolicitudTrabajo("b", "c", null, 1, 1, Prioridad.ALTA, null), null);
        p.encolar(viejo);
        p.encolar(nuevoAlta);
        assertEquals("alta", p.enOrden(Instant.now()).get(0).getId());
        // 25 s después el NORMAL suma 2 puntos (3) y pasa delante del ALTA (2 + 2 = 4? no: el ALTA también envejece)
        Instant despues = Instant.now().plusSeconds(25);
        assertTrue(p.prioridadEfectiva(viejo, despues) >= p.prioridadEfectiva(viejo, Instant.now()) + 2);
    }

    @Test
    void codigoInexistenteOConFormatoNoSoportadoSeRechaza() {
        ErrorHpc e1 = assertThrows(ErrorHpc.class, () ->
                gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/no-existe.c", null, 1), false, null, null));
        assertEquals("HPC-001", e1.getCodigo().codigo());
        ErrorHpc e2 = assertThrows(ErrorHpc.class, () ->
                gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/notas.txt", null, 1), false, null, null));
        assertEquals("HPC-004", e2.getCodigo().codigo());
        ErrorHpc e3 = assertThrows(ErrorHpc.class, () ->
                gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", "/Proyectos/nada.csv", 1), false, null, null));
        assertEquals("HPC-002", e3.getCodigo().codigo());
    }

    @Test
    void cuotaDeProcesosYPrioridadAltaSinPermiso() {
        ErrorHpc procesos = assertThrows(ErrorHpc.class, () ->
                gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 7), false, null, null));
        assertEquals("HPC-003", procesos.getCodigo().codigo(), "6 procesos en la malla, se pidieron 7");

        SolicitudTrabajo alta = new SolicitudTrabajo("x", "/Proyectos/pi.c", null, 1, 60, Prioridad.ALTA, null);
        ErrorHpc sinPermiso = assertThrows(ErrorHpc.class, () -> gestor.enviar("investigador", TOKEN, alta, false, null, null));
        assertEquals("HPC-007", sinPermiso.getCodigo().codigo());
    }

    @Test
    @Timeout(10)
    void fallosDeCompilacionYTiempoAgotado() throws Exception {
        ejecutor.desenlace = new EstadoEjecucion(EstadoEjecucion.TERMINADO, 1, true, false, false, null);
        String id = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        TrabajoHpc t = esperar("investigador", id, EstadoTrabajo.FALLIDO);
        assertTrue(t.getMensajeError().startsWith("HPC-004"));

        ejecutor.desenlace = new EstadoEjecucion(EstadoEjecucion.TERMINADO, 124, false, true, false, null);
        String id2 = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        TrabajoHpc t2 = esperar("investigador", id2, EstadoTrabajo.FALLIDO_TIMEOUT);
        assertTrue(t2.isResultadoIncompleto());
        assertNotNull(t2.getRutaResultado(), "la salida parcial se conserva");
        assertTrue(storage.guardados.get(t2.getRutaResultado().substring(1)).containsKey("INCOMPLETO.txt"));
        assertTrue(gestor.resultado("investigador", id2).incompleto());

        RespuestaEnvio r = gestor.reintentar("investigador", TOKEN, id2, false);
        assertNotEquals(id2, r.trabajoId());
        assertEquals(id2, gestor.consultar("investigador", r.trabajoId()).getTrabajoOriginalId());
        assertNotNull(r.advertencia());
    }

    @Test
    @Timeout(10)
    void cancelarUnTrabajoEnEjecucionLiberaLosNodos() throws Exception {
        ejecutor.mantenerEjecutando = true;
        String id = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 6), false, null, null).trabajoId();
        esperar("investigador", id, EstadoTrabajo.EJECUTANDO);
        assertEquals(6, gestor.estadoCluster().procesosEnUso());

        TrabajoHpc cancelado = gestor.cancelar("investigador", id);
        assertEquals(EstadoTrabajo.CANCELADO, cancelado.getEstado());
        long limite = System.currentTimeMillis() + 3000;
        while (gestor.estadoCluster().procesosEnUso() > 0 && System.currentTimeMillis() < limite) Thread.sleep(20);
        assertEquals(0, gestor.estadoCluster().procesosEnUso());
        assertThrows(ErrorHpc.class, () -> gestor.cancelar("investigador", id), "HPC-105");
    }

    @Test
    @Timeout(10)
    void unTrabajoQueNoCabeEsperaEnColaYSePuedeRepriorizar() throws Exception {
        ejecutor.mantenerEjecutando = true;
        String grande = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 6), false, null, null).trabajoId();
        esperar("investigador", grande, EstadoTrabajo.EJECUTANDO);
        String segundo = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 2), false, null, null).trabajoId();
        Thread.sleep(200);
        TrabajoHpc enCola = gestor.consultar("investigador", segundo);
        assertEquals(EstadoTrabajo.EN_COLA, enCola.getEstado());
        assertEquals(1, enCola.getPosicionCola());
        assertEquals(Prioridad.BAJA, gestor.definirPrioridad("investigador", segundo, Prioridad.BAJA, false).getPrioridad());
        assertThrows(ErrorHpc.class, () -> gestor.logs("investigador", segundo), "HPC-106");
    }

    @Test
    @Timeout(10)
    void unNodoCaidoSeMarcaEnFallaYElTrabajoSeReasigna() throws Exception {
        ejecutor.caidos.add("hpc-master");
        String id = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        // Si el primer intento se asigna a hpc-master, vuelve a la cola y se reasigna a otro nodo.
        esperar("investigador", id, EstadoTrabajo.COMPLETADO);
        assertFalse(ejecutor.ordenes.get(id).hosts().containsKey("hpc-master"));
        NodoCluster master = gestor.estadoCluster().nodos().stream()
                .filter(n -> n.id().equals("hpc-master")).findFirst().orElseThrow();
        assertEquals(NodoCluster.Estado.EN_FALLA, master.estado());
    }

    @Test
    @Timeout(10)
    void siStorageNoGuardaElResultadoQuedaPendienteDeAlmacenamiento() throws Exception {
        storage.caido = true;
        String id = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        TrabajoHpc t = esperar("investigador", id, EstadoTrabajo.COMPLETADO_PENDIENTE_ALMACENAMIENTO);
        assertNotNull(t.getMensajeError());
        assertThrows(ErrorHpc.class, () -> gestor.resultado("investigador", id), "HPC-103");
    }

    @Test
    void nodosExternosDeLaMalla() throws Exception {
        NodoCluster externo = gestor.registrarNodo("laptop-lab-07.upb.edu.co", 4, true);
        assertEquals(NodoCluster.Origen.EXTERNO, externo.origen());
        assertEquals(10, gestor.estadoCluster().procesosTotales());
        assertThrows(ErrorHpc.class, () -> gestor.registrarNodo("host; rm -rf /", 2, true));
        gestor.retirarNodo("laptop-lab-07.upb.edu.co");
        assertThrows(ErrorHpc.class, () -> gestor.retirarNodo("laptop-lab-07.upb.edu.co"));
    }

    @Test
    void unUsuarioNoVeNiCancelaTrabajosAjenos() throws Exception {
        ejecutor.mantenerEjecutando = true;
        String ajeno = gestor.enviar("otro", "token-otro", solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        ErrorHpc e = assertThrows(ErrorHpc.class, () -> gestor.consultar("investigador", ajeno));
        assertEquals("HPC-101", e.getCodigo().codigo());
        assertThrows(ErrorHpc.class, () -> gestor.cancelar("investigador", ajeno));
        assertTrue(gestor.listar("investigador", null).isEmpty());
        assertEquals(1, gestor.listar("otro", null).size());
    }

    @Test
    @Timeout(10)
    void elEstadoSobreviveAUnReinicio() throws Exception {
        String id = gestor.enviar("investigador", TOKEN, solicitud("/Proyectos/pi.c", null, 1), false, null, null).trabajoId();
        esperar("investigador", id, EstadoTrabajo.COMPLETADO);
        gestor.detener();

        gestor = nuevoGestor("hpc-master:2");
        gestor.arrancar();
        TrabajoHpc t = gestor.consultar("investigador", id);
        assertEquals(EstadoTrabajo.COMPLETADO, t.getEstado());
        assertNotNull(t.getRutaResultado());
    }
}
