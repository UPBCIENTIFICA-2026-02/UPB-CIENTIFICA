package com.cluster.api.controller;

import com.cluster.api.dto.NodoRequest;
import com.cluster.api.service.FachadaHpc;
import com.cluster.common.ErrorHpc;
import com.cluster.common.EstadoCluster;
import com.cluster.common.NoAutorizadoException;
import com.cluster.common.NodoCluster;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST del clúster / malla Grid.
 *
 * <pre>
 * GET    /cluster/estado        ObtenerEstadoCluster + ObtenerEstadoCola (Contrato_HPC §3.9)
 * POST   /cluster/nodos         RegistrarNodo  (adenda J; exige "hpcadmin")
 * DELETE /cluster/nodos/{host}  RetirarNodo    (adenda J; exige "hpcadmin")
 * </pre>
 *
 * ANTES no existía: node-web ya reenviaba /api/cluster/** y el portal recibía 404.
 */
@RestController
@RequestMapping("/cluster")
public class ClusterController {

    private final FachadaHpc hpc;

    public ClusterController(FachadaHpc hpc) {
        this.hpc = hpc;
    }

    @GetMapping("/estado")
    public EstadoCluster estado(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion)
            throws NoAutorizadoException, ErrorHpc {
        return hpc.estadoCluster(Tokens.de(autorizacion));
    }

    @PostMapping("/nodos")
    public ResponseEntity<NodoCluster> registrar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @Valid @RequestBody NodoRequest nodo) throws NoAutorizadoException, ErrorHpc {
        return ResponseEntity.status(HttpStatus.CREATED).body(
                hpc.registrarNodo(Tokens.de(autorizacion), nodo.host().trim(), nodo.capacidadProcesos(), nodo.esExterno()));
    }

    @DeleteMapping("/nodos/{host}")
    public ResponseEntity<Void> retirar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String autorizacion,
            @PathVariable("host") String host) throws NoAutorizadoException, ErrorHpc {
        hpc.retirarNodo(Tokens.de(autorizacion), host);
        return ResponseEntity.noContent().build();
    }
}
