package com.cluster.api.exception;

import com.cluster.api.dto.ErrorResponse;
import com.cluster.common.ErrorHpc;
import com.cluster.common.NoAutorizadoException;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.stream.Collectors;

/**
 * Único sitio que traduce excepciones a HTTP:
 *
 * ErrorHpc (HPC-xxx)           → el estado de su código (404, 409, 422, 403, 400)
 * NoAutorizadoException        → 401 sin identidad / 403 con identidad
 * IllegalArgumentException     → 400 (p. ej. prioridad o estado desconocidos)
 * validación @Valid / JSON     → 400
 * RmiNoDisponibleException     → 503 (gestor, Storage o Auth caídos)
 * ruta inexistente             → 404
 * cualquier otra               → 500 sin detalles internos
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ErrorHpc.class)
    public ResponseEntity<ErrorResponse> errorHpc(ErrorHpc e) {
        HttpStatus estado = HttpStatus.valueOf(e.getCodigo().estadoHttp());
        return construir(estado, e.getCodigo().codigo(), e.getMessage());
    }

    @ExceptionHandler(NoAutorizadoException.class)
    public ResponseEntity<ErrorResponse> noAutorizado(NoAutorizadoException e) {
        return construir(e.isSinIdentidad() ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN, null, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> argumentoInvalido(IllegalArgumentException e) {
        return construir(HttpStatus.BAD_REQUEST, null, e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> validacion(MethodArgumentNotValidException e) {
        String mensaje = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return construir(HttpStatus.BAD_REQUEST, null, mensaje);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> cuerpoIlegible(HttpMessageNotReadableException e) {
        return construir(HttpStatus.BAD_REQUEST, null, "El cuerpo de la petición no es JSON válido");
    }

    @ExceptionHandler(RmiNoDisponibleException.class)
    public ResponseEntity<ErrorResponse> rmiNoDisponible(RmiNoDisponibleException e) {
        return construir(HttpStatus.SERVICE_UNAVAILABLE, null,
                "Servicio HPC no disponible en este momento: " + e.getMessage());
    }

    /** ANTES una ruta inexistente caía en el genérico: 500 con detalle interno (G2). */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> rutaInexistente(Exception e) {
        return construir(HttpStatus.NOT_FOUND, null, "Ruta no encontrada");
    }

    /** El detalle va solo al registro del servidor, nunca al cliente. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> errorInterno(Exception e) {
        LoggerFactory.getLogger(GlobalExceptionHandler.class).error("Error no controlado", e);
        return construir(HttpStatus.INTERNAL_SERVER_ERROR, null, "Error interno inesperado");
    }

    private ResponseEntity<ErrorResponse> construir(HttpStatus status, String codigo, String mensaje) {
        return ResponseEntity.status(status)
                .body(new ErrorResponse(status.value(), status.getReasonPhrase(), codigo, mensaje));
    }
}
