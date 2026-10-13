package com.cluster.api.controller;

import com.cluster.api.dto.EstadoTrabajoResponse;
import com.cluster.api.dto.SolicitudTrabajoRequest;
import com.cluster.api.dto.TrabajoResponse;
import com.cluster.api.service.FachadaHpc;
import com.cluster.common.ErrorHpc;
import com.cluster.common.EstadoTrabajo;
import com.cluster.common.NoAutorizadoException;
import com.cluster.common.Prioridad;
import com.cluster.common.RespuestaEnvio;
import com.cluster.common.ResultadoTrabajo;
import com.cluster.common.TrabajoHpc;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST de trabajos HPC. Cada ruta corresponde a una operación de Contrato_HPC;
 * el controlador solo traduce HTTP ↔ RMI (FachadaHpc), sin reglas de negocio.
 *
 * <pre>
 * POST   /jobs                 EnviarTrabajo            201 RespuestaEnvio
 * GET    /jobs[?estado=]       ListarTrabajosUsuario    200 TrabajoResponse[]
 * GET    /jobs/{id}            ConsultarEstadoTrabajo   200 TrabajoResponse
 * GET    /jobs/{id}/estado     ConsultarEstadoTrabajo   200 EstadoTrabajoResponse
 * GET    /jobs/{id}/resultado  ObtenerResultado         200 ResultadoTrabajo
 * GET    /jobs/{id}/logs       ObtenerLogsTrabajo       200 { logsEjecucion }
 * DELETE /jobs/{id}            CancelarTrabajo          200 { trabajoId, estadoFinal }
 * PUT    /jobs/{id}/prioridad  DefinirPrioridadTrabajo  200 TrabajoResponse
 * POST   /jobs/{id}/reintento  ReintentarTrabajo        201 RespuestaEnvio
 * </pre>
 *
 * El token se lee de {@code Authorization: Bearer ...} y lo valida el gestor;
 * nunca se acepta en el cuerpo.
 */
@RestController
@RequestMapping("/jobs")
public class TrabajoController {

    private final FachadaHpc hpc;

    public TrabajoController(FachadaHpc hpc) {
        this.hpc = hpc;
    }

    @PostMapping
    public ResponseEntity<RespuestaEnvio> enviar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @Valid @RequestBody SolicitudTrabajoRequest solicitud) throws NoAutorizadoException, ErrorHpc {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(hpc.enviar(Tokens.de(autorizacion), solicitud.aSolicitud()));
    }

    @GetMapping
    public List<TrabajoResponse> listar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @RequestParam(value = "estado", required = false) String estado) throws NoAutorizadoException, ErrorHpc {
        EstadoTrabajo filtro = estado == null || estado.isBlank() ? null : EstadoTrabajo.valueOf(estado.trim().toUpperCase());
        return hpc.listar(Tokens.de(autorizacion), filtro).stream().map(TrabajoResponse::desde).toList();
    }

    @GetMapping("/{id}")
    public TrabajoResponse consultar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        return TrabajoResponse.desde(hpc.consultar(Tokens.de(autorizacion), id));
    }

    @GetMapping("/{id}/estado")
    public EstadoTrabajoResponse estado(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        return EstadoTrabajoResponse.desde(hpc.consultar(Tokens.de(autorizacion), id));
    }

    @GetMapping("/{id}/resultado")
    public ResultadoTrabajo resultado(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        return hpc.resultado(Tokens.de(autorizacion), id);
    }

    @GetMapping("/{id}/logs")
    public Map<String, String> logs(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        return Map.of("trabajoId", id, "logsEjecucion", hpc.logs(Tokens.de(autorizacion), id));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> cancelar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        TrabajoHpc t = hpc.cancelar(Tokens.de(autorizacion), id);
        return Map.of("trabajoId", t.getId(), "estadoFinal", t.getEstado());
    }

    @PutMapping("/{id}/prioridad")
    public TrabajoResponse prioridad(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id,
            @RequestBody Map<String, String> cuerpo) throws NoAutorizadoException, ErrorHpc {
        Prioridad nueva = Prioridad.desde(cuerpo == null ? null : cuerpo.get("nuevaPrioridad"));
        return TrabajoResponse.desde(hpc.definirPrioridad(Tokens.de(autorizacion), id, nueva));
    }

    @PostMapping("/{id}/reintento")
    public ResponseEntity<RespuestaEnvio> reintentar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("id") String id) throws NoAutorizadoException, ErrorHpc {
        return ResponseEntity.status(HttpStatus.CREATED).body(hpc.reintentar(Tokens.de(autorizacion), id));
    }
}
