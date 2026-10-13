package com.cluster.api.controller;

import com.cluster.api.dto.JobIdResponse;
import com.cluster.api.dto.JobResponse;
import com.cluster.api.dto.JobStatusResponse;
import com.cluster.api.dto.SubmitJobRequest;
import com.cluster.api.service.JobFacadeService;
import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.Job;
import com.cluster.common.JobNoEncontradoException;
import com.cluster.common.NoAutorizadoException;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
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
 *
 * AUTENTICACIÓN: el token se lee de la cabecera {@code Authorization: Bearer ...}
 * y se reenvía al gestor, que es quien lo valida contra node-soap. Antes no se
 * pedía nada: cualquiera podía enviar trabajos y cancelar los de los demás.
 *
 * El token NUNCA se acepta en el cuerpo de la petición: el uid tiene que salir
 * de una credencial verificada, no de un campo que el cliente rellena.
 */
@RestController
@RequestMapping("/jobs")
public class JobController {

    private static final String PREFIJO_BEARER = "Bearer ";

    private final JobFacadeService jobFacadeService;

    public JobController(JobFacadeService jobFacadeService) {
        this.jobFacadeService = jobFacadeService;
    }

    /**
     * Extrae el token de la cabecera Authorization.
     *
     * Si falta, se lanza la misma excepción que si fuera inválido: para el
     * cliente el resultado es el mismo (401) y así el gestor es el único que
     * decide qué es un token válido.
     */
    private String token(String cabecera) throws NoAutorizadoException {
        if (cabecera == null || !cabecera.startsWith(PREFIJO_BEARER)) {
            throw NoAutorizadoException.tokenInvalido();
        }
        String token = cabecera.substring(PREFIJO_BEARER.length()).trim();
        if (token.isEmpty()) {
            throw NoAutorizadoException.tokenInvalido();
        }
        return token;
    }

    /** Corresponde a JobService.submitJob */
    @PostMapping
    public ResponseEntity<JobIdResponse> crearTrabajo(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @Valid @RequestBody SubmitJobRequest request) throws NoAutorizadoException {
        String id = jobFacadeService.submitJob(
                token(autorizacion), request.getNombre(), request.getComando(), request.getPrioridad());
        return ResponseEntity.status(HttpStatus.CREATED).body(new JobIdResponse(id));
    }

    /** Corresponde a JobService.getJob */
    @GetMapping("/{id}")
    public ResponseEntity<JobResponse> obtenerTrabajo(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws JobNoEncontradoException, NoAutorizadoException {
        Job job = jobFacadeService.getJob(token(autorizacion), id);
        return ResponseEntity.ok(JobResponse.desde(job));
    }

    /** Corresponde a JobService.getJobStatus */
    @GetMapping("/{id}/estado")
    public ResponseEntity<JobStatusResponse> obtenerEstado(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws JobNoEncontradoException, NoAutorizadoException {
        var estado = jobFacadeService.getJobStatus(token(autorizacion), id);
        return ResponseEntity.ok(new JobStatusResponse(id, estado));
    }

    /** Corresponde a JobService.listJobs (solo los trabajos del usuario) */
    @GetMapping
    public ResponseEntity<List<JobResponse>> listarTrabajos(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion)
            throws NoAutorizadoException {
        List<JobResponse> respuesta = jobFacadeService.listJobs(token(autorizacion)).stream()
                .map(JobResponse::desde)
                .collect(Collectors.toList());
        return ResponseEntity.ok(respuesta);
    }

    /** Corresponde a JobService.cancelJob */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> cancelarTrabajo(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id)
            throws JobNoEncontradoException, EstadoInvalidoException, NoAutorizadoException {
        boolean cancelado = jobFacadeService.cancelJob(token(autorizacion), id);
        return ResponseEntity.ok(Map.of("id", id, "cancelado", cancelado));
    }
}
