package com.cluster.runner;

import com.cluster.common.EstadoEjecucion;
import com.cluster.common.OrdenEjecucion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * job-runner de punta a punta con MpirunSimulado como mpirun y ProgramaPrueba
 * como programa del usuario: preparación del directorio, hostfile, argumentos,
 * resultados, tiempo máximo, cancelación y fallos de compilación.
 */
class EjecutorMpiImplTest {

    @TempDir
    Path dir;
    private EjecutorMpiImpl ejecutor;

    @BeforeEach
    void iniciar() {
        String java = ProcessHandle.current().info().command().orElse("java");
        String cp = System.getProperty("java.class.path");
        Configuracion cfg = new Configuracion(dir,
                List.of("mpicc-que-no-existe"), List.of("mpicxx-que-no-existe"),
                List.of(java, "-cp", cp, MpirunSimulado.class.getName()), List.of(),
                List.of(java, "-cp", cp, ProgramaPrueba.class.getName()),
                List.of("ssh"), Set.of("localhost"), 1024 * 1024);
        ejecutor = new EjecutorMpiImpl(cfg);
    }

    private static OrdenEjecucion orden(String id, String codigo, int np, int tiempo, String... args) {
        Map<String, Integer> hosts = new LinkedHashMap<>();
        hosts.put("localhost", np);
        return new OrdenEjecucion(id, codigo, "print('hola')".getBytes(StandardCharsets.UTF_8),
                "datos.csv", "1,2,3".getBytes(StandardCharsets.UTF_8), np, hosts, List.of(args), tiempo);
    }

    private EstadoEjecucion esperar(String id) throws Exception {
        for (int i = 0; i < 600; i++) {
            EstadoEjecucion e = ejecutor.consultar(id);
            if (e.terminado()) return e;
            Thread.sleep(50);
        }
        fail("no terminó");
        return null;
    }

    @Test
    @Timeout(60)
    void ejecutaNProcesosConElDatasetYDevuelveLoProducido() throws Exception {
        ejecutor.iniciar(orden("t1", "pi.py", 3, 60, "n=10"));
        EstadoEjecucion e = esperar("t1");
        assertEquals(0, e.codigoSalida());
        assertFalse(e.tiempoAgotado());

        Map<String, byte[]> r = ejecutor.resultados("t1");
        String salida = new String(r.get("salida.txt"), StandardCharsets.UTF_8);
        assertTrue(salida.contains("rango 0 de 3 dataset=1,2,3"), salida);
        assertTrue(salida.contains("rango 2 de 3"), salida);
        assertTrue(r.containsKey("parcial-1.txt"), "lo que escribe el programa vuelve como resultado");
        assertFalse(r.containsKey("pi.py"), "el código no es resultado");
        assertFalse(r.containsKey("datos.csv"), "el dataset no es resultado");
        assertFalse(r.containsKey("hostfile"));
        assertEquals("localhost slots=3\n", Files.readString(dir.resolve("t1/hostfile")));
        assertTrue(ejecutor.logs("t1", 4096).contains("rango 1 de 3"));

        ejecutor.limpiar("t1");
        assertFalse(Files.exists(dir.resolve("t1")));
        assertEquals(EstadoEjecucion.DESCONOCIDO, ejecutor.consultar("t1").fase());
    }

    @Test
    @Timeout(60)
    void unProgramaQueFallaDevuelveSuCodigo() throws Exception {
        ejecutor.iniciar(orden("t2", "pi.py", 2, 60, "modo=fallar"));
        assertEquals(3, esperar("t2").codigoSalida());
    }

    @Test
    @Timeout(60)
    void seCortaAlAgotarElTiempoMaximo() throws Exception {
        ejecutor.iniciar(orden("t3", "lento.py", 1, 2, "modo=dormir"));
        EstadoEjecucion e = esperar("t3");
        assertTrue(e.tiempoAgotado());
        assertNotEquals(0, e.codigoSalida());
        assertTrue(ejecutor.resultados("t3").containsKey("salida.txt"), "la salida parcial se conserva");
    }

    @Test
    @Timeout(60)
    void cancelarTerminaLosProcesos() throws Exception {
        ejecutor.iniciar(orden("t4", "lento.py", 2, 120, "modo=dormir"));
        Thread.sleep(1500);
        ejecutor.cancelar("t4");
        EstadoEjecucion e = esperar("t4");
        assertTrue(e.cancelado());
    }

    @Test
    @Timeout(60)
    void sinCompiladorEsErrorDeCompilacion() throws Exception {
        ejecutor.iniciar(orden("t5", "pi.c", 1, 60));
        EstadoEjecucion e = esperar("t5");
        assertTrue(e.errorCompilacion());
        assertTrue(new String(ejecutor.resultados("t5").get("compilacion.txt"), StandardCharsets.UTF_8)
                .contains("No se encontró el compilador"));
    }

    @Test
    void losNombresDeArchivoSeSanean() {
        assertEquals("passwd", Ejecucion.nombreSeguro("../../etc/passwd", "x"));
        assertEquals("mi_codigo.c", Ejecucion.nombreSeguro("mi código.c", "x"));
        assertEquals("codigo_programa", Ejecucion.nombreSeguro("programa", "codigo"));
        assertEquals("x_", Ejecucion.nombreSeguro("...", "x"));
    }

    @Test
    void losNodosLocalesNoSeCompruebanPorSsh() {
        assertEquals(List.of(), ejecutor.nodosSinRespuesta(List.of("localhost")));
    }
}
