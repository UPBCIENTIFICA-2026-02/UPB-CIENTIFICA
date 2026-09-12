package com.cluster.api.controller;

import com.cluster.api.dto.JobIdResponse;
import com.cluster.api.dto.JobResponse;
import com.cluster.api.dto.JobStatusResponse;
import com.cluster.api.dto.SubmitJobRequest;
import com.cluster.api.service.JobFacadeService;
import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controlador REST. Deliberadamente NO conoce {@code Remote}, {@code Registry}
 * ni {@code RemoteException}: solo conoce {@link JobFacadeService} y los DTOs
 * HTTP. Cada endpoint corresponde exactamente a un método del contrato
 * {@code JobService}; no se agregan endpoints sin respaldo en el contrato.
 */
@RestController
@RequestMapping("/jobs")
public class JobController {

    private final JobFacadeService jobFacadeService;

    public JobController(JobFacadeService jobFacadeService) {
        this.jobFacadeService = jobFacadeService;
    }

    /** Corresponde a JobService.submitJob */
    @PostMapping
    public ResponseEntity<JobIdResponse> crearTrabajo(@Valid @RequestBody SubmitJobRequest request) {
        String id = jobFacadeService.submitJob(request.getNombre(), request.getComando(), request.getPrioridad());
        return ResponseEntity.status(HttpStatus.CREATED).body(new JobIdResponse(id));
    }

    /** Corresponde a JobService.getJob */
    @GetMapping("/{id}")
    public ResponseEntity<JobResponse> obtenerTrabajo(@PathVariable String id) throws JobNoEncontradoException {
        Job job = jobFacadeService.getJob(id);
        return ResponseEntity.ok(JobResponse.desde(job));
    }

    /** Corresponde a JobService.getJobStatus */
    @GetMapping("/{id}/estado")
    public ResponseEntity<JobStatusResponse> obtenerEstado(@PathVariable String id) throws JobNoEncontradoException {
        var estado = jobFacadeService.getJobStatus(id);
        return ResponseEntity.ok(new JobStatusResponse(id, estado));
    }

    /** Corresponde a JobService.listJobs */
    @GetMapping
    public ResponseEntity<List<JobResponse>> listarTrabajos() {
        List<JobResponse> respuesta = jobFacadeService.listJobs().stream()
                .map(JobResponse::desde)
                .collect(Collectors.toList());
        return ResponseEntity.ok(respuesta);
    }

    /** Corresponde a JobService.cancelJob */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> cancelarTrabajo(@PathVariable String id)
            throws JobNoEncontradoException, EstadoInvalidoException {
        boolean cancelado = jobFacadeService.cancelJob(id);
        return ResponseEntity.ok(Map.of("id", id, "cancelado", cancelado));
    }
}
