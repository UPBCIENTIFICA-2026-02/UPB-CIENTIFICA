package com.cluster.api;

import com.cluster.api.controller.JobController;
import com.cluster.api.service.JobFacadeService;
import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.JobStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Prueba la capa HTTP de forma aislada (sin RMI real), verificando que cada
 * respuesta de JobFacadeService se traduzca al código HTTP correcto.
 */
@WebMvcTest(JobController.class)
class JobControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private JobFacadeService jobFacadeService;

    @Test
    void crearTrabajoRetorna201ConId() throws Exception {
        when(jobFacadeService.submitJob(anyString(), anyString(), anyInt())).thenReturn("id-123");

        mockMvc.perform(post("/jobs")
                        .contentType("application/json")
                        .content("{\"nombre\":\"prueba\",\"comando\":\"echo hola\",\"prioridad\":5}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("id-123"));
    }

    @Test
    void crearTrabajoSinNombreRetorna400() throws Exception {
        mockMvc.perform(post("/jobs")
                        .contentType("application/json")
                        .content("{\"comando\":\"echo hola\",\"prioridad\":5}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void obtenerTrabajoInexistenteRetorna404() throws Exception {
        when(jobFacadeService.getJob("no-existe")).thenThrow(new JobNoEncontradoException("no-existe"));

        mockMvc.perform(get("/jobs/no-existe"))
                .andExpect(status().isNotFound());
    }

    @Test
    void obtenerTrabajoExistenteRetorna200() throws Exception {
        Job job = new Job("id-1", "prueba", "echo hola", 5);
        when(jobFacadeService.getJob("id-1")).thenReturn(job);

        mockMvc.perform(get("/jobs/id-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("id-1"))
                .andExpect(jsonPath("$.estado").value("QUEUED"));
    }

    @Test
    void obtenerEstadoRetorna200() throws Exception {
        when(jobFacadeService.getJobStatus("id-1")).thenReturn(JobStatus.RUNNING);

        mockMvc.perform(get("/jobs/id-1/estado"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("RUNNING"));
    }

    @Test
    void cancelarTrabajoEnEstadoTerminalRetorna409() throws Exception {
        when(jobFacadeService.cancelJob("id-1")).thenThrow(new EstadoInvalidoException("id-1", JobStatus.COMPLETED));

        mockMvc.perform(delete("/jobs/id-1"))
                .andExpect(status().isConflict());
    }

    @Test
    void cancelarTrabajoValidoRetorna200() throws Exception {
        when(jobFacadeService.cancelJob("id-1")).thenReturn(true);

        mockMvc.perform(delete("/jobs/id-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cancelado").value(true));
    }

    @Test
    void listarTrabajosRetorna200() throws Exception {
        when(jobFacadeService.listJobs()).thenReturn(java.util.List.of(new Job("id-1", "a", "echo a", 1)));

        mockMvc.perform(get("/jobs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("id-1"));
    }
}
