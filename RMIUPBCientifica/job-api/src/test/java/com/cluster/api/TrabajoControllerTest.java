package com.cluster.api;

import com.cluster.api.controller.ClusterController;
import com.cluster.api.controller.TrabajoController;
import com.cluster.api.exception.RmiNoDisponibleException;
import com.cluster.api.service.FachadaHpc;
import com.cluster.common.ErrorHpc;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NoAutorizadoException;
import com.cluster.common.Prioridad;
import com.cluster.common.RespuestaEnvio;
import com.cluster.common.SolicitudTrabajo;
import com.cluster.common.TrabajoHpc;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Capa HTTP aislada (sin RMI): cada respuesta o excepción de la fachada se
 * traduce al código HTTP y al cuerpo del contrato.
 */
@WebMvcTest({TrabajoController.class, ClusterController.class})
class TrabajoControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private FachadaHpc hpc;

    private static final String BEARER = "Bearer mock-token-jperez-pruebas";
    private static final String CUERPO = """
            {"nombreTrabajo":"pi","rutaCodigo":"/Proyectos/pi.c","rutaDataset":"/Proyectos/datos.csv",
             "numeroProcesos":4,"tiempoMaximoEjecucion":120,"prioridad":"BAJA","parametrosEjecucion":{"n":"1000"}}""";

    private static TrabajoHpc trabajo(EstadoTrabajo estado) {
        TrabajoHpc t = new TrabajoHpc("id-1", "jperez",
                new SolicitudTrabajo("pi", "/Proyectos/pi.c", null, 4, 120, Prioridad.NORMAL, Map.of()), null);
        t.setEstado(estado);
        return t;
    }

    @Test
    void enviarTrabajoDevuelve201YPasaLosCamposDelContrato() throws Exception {
        when(hpc.enviar(anyString(), any())).thenReturn(
                new RespuestaEnvio("id-1", EstadoTrabajo.PENDIENTE, 1, Instant.now(), null));

        mvc.perform(post("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER)
                        .contentType("application/json").content(CUERPO))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.trabajoId").value("id-1"))
                .andExpect(jsonPath("$.estadoInicial").value("PENDIENTE"))
                .andExpect(jsonPath("$.posicionEstimadaCola").value(1));

        ArgumentCaptor<SolicitudTrabajo> s = ArgumentCaptor.forClass(SolicitudTrabajo.class);
        verify(hpc).enviar(eq("mock-token-jperez-pruebas"), s.capture());
        assertEquals("/Proyectos/pi.c", s.getValue().getRutaCodigo());
        assertEquals("/Proyectos/datos.csv", s.getValue().getRutaDataset());
        assertEquals(4, s.getValue().getNumeroProcesos());
        assertEquals(Prioridad.BAJA, s.getValue().getPrioridad());
        assertEquals(Map.of("n", "1000"), s.getValue().getParametrosEjecucion());
    }

    @Test
    void sinCamposObligatoriosEs400() throws Exception {
        mvc.perform(post("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER)
                        .contentType("application/json").content("{\"nombreTrabajo\":\"x\",\"numeroProcesos\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void prioridadDesconocidaEs400() throws Exception {
        mvc.perform(post("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER).contentType("application/json")
                        .content(CUERPO.replace("BAJA", "URGENTE")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void sinTokenEs401() throws Exception {
        mvc.perform(get("/jobs")).andExpect(status().isUnauthorized());
        verifyNoInteractions(hpc);
    }

    @Test
    void losErroresDelContratoSeTraducenConSuCodigo() throws Exception {
        when(hpc.enviar(anyString(), any())).thenThrow(
                new ErrorHpc(ErrorHpc.Codigo.CODIGO_NO_ENCONTRADO, "No se encontró el código"));
        mvc.perform(post("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER).contentType("application/json").content(CUERPO))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("HPC-001"));

        when(hpc.cancelar(anyString(), eq("id-1"))).thenThrow(
                new ErrorHpc(ErrorHpc.Codigo.NO_CANCELABLE, "ya terminó"));
        mvc.perform(delete("/jobs/id-1").header(HttpHeaders.AUTHORIZATION, BEARER))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("HPC-105"));

        doThrow(new ErrorHpc(ErrorHpc.Codigo.PROCESOS_EXCEDEN_CUOTA, "cuota")).when(hpc).enviar(anyString(), any());
        mvc.perform(post("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER).contentType("application/json").content(CUERPO))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.codigo").value("HPC-003"));
    }

    @Test
    void consultarYEstado() throws Exception {
        when(hpc.consultar(anyString(), eq("id-1"))).thenReturn(trabajo(EstadoTrabajo.EJECUTANDO));
        mvc.perform(get("/jobs/id-1").header(HttpHeaders.AUTHORIZATION, BEARER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("id-1"))
                .andExpect(jsonPath("$.estado").value("EJECUTANDO"))
                .andExpect(jsonPath("$.numeroProcesos").value(4));
        mvc.perform(get("/jobs/id-1/estado").header(HttpHeaders.AUTHORIZATION, BEARER))
                .andExpect(jsonPath("$.trabajoId").value("id-1"))
                .andExpect(jsonPath("$.estado").value("EJECUTANDO"));
    }

    @Test
    void cancelarDevuelveElEstadoFinal() throws Exception {
        when(hpc.cancelar(anyString(), eq("id-1"))).thenReturn(trabajo(EstadoTrabajo.CANCELADO));
        mvc.perform(delete("/jobs/id-1").header(HttpHeaders.AUTHORIZATION, BEARER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estadoFinal").value("CANCELADO"));
    }

    @Test
    void perfilSinPermisoEs403YGestorCaidoEs503() throws Exception {
        when(hpc.listar(anyString(), any())).thenThrow(new NoAutorizadoException("sin hpc", false));
        mvc.perform(get("/jobs").header(HttpHeaders.AUTHORIZATION, BEARER)).andExpect(status().isForbidden());

        when(hpc.estadoCluster(anyString())).thenThrow(new RmiNoDisponibleException("caído", null));
        mvc.perform(get("/cluster/estado").header(HttpHeaders.AUTHORIZATION, BEARER))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void registrarNodoValidaElCuerpo() throws Exception {
        mvc.perform(post("/cluster/nodos").header(HttpHeaders.AUTHORIZATION, BEARER)
                        .contentType("application/json").content("{\"host\":\"\",\"capacidadProcesos\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rutaInexistenteEs404() throws Exception {
        mvc.perform(get("/no-existe").header(HttpHeaders.AUTHORIZATION, BEARER)).andExpect(status().isNotFound());
    }
}
