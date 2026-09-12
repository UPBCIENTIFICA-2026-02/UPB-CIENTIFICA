package com.cluster.api.exception;

import com.cluster.api.dto.ErrorResponse;
import com.cluster.common.EstadoInvalidoException;
import com.cluster.common.JobNoEncontradoException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

/**
 * Traduce cada tipo de excepción a su código HTTP correspondiente:
 *
 * 404 → Job inexistente               (JobNoEncontradoException)
 * 400 → Datos inválidos               (IllegalArgumentException, validación @Valid)
 * 409 → Conflicto de estado           (EstadoInvalidoException)
 * 503 → Servicio RMI no disponible    (RmiNoDisponibleException)
 * 500 → Error interno                 (cualquier otra excepción no anticipada)
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(JobNoEncontradoException.class)
    public ResponseEntity<ErrorResponse> manejarNoEncontrado(JobNoEncontradoException e) {
        return construir(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(EstadoInvalidoException.class)
    public ResponseEntity<ErrorResponse> manejarEstadoInvalido(EstadoInvalidoException e) {
        return construir(HttpStatus.CONFLICT, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> manejarArgumentoInvalido(IllegalArgumentException e) {
        return construir(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> manejarValidacion(MethodArgumentNotValidException e) {
        String mensaje = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return construir(HttpStatus.BAD_REQUEST, mensaje);
    }

    @ExceptionHandler(RmiNoDisponibleException.class)
    public ResponseEntity<ErrorResponse> manejarRmiNoDisponible(RmiNoDisponibleException e) {
        return construir(HttpStatus.SERVICE_UNAVAILABLE,
                "El servicio gestor-cluster no está disponible en este momento: " + e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> manejarErrorInterno(Exception e) {
        return construir(HttpStatus.INTERNAL_SERVER_ERROR, "Error interno inesperado: " + e.getMessage());
    }

    private ResponseEntity<ErrorResponse> construir(HttpStatus status, String mensaje) {
        return ResponseEntity.status(status)
                .body(new ErrorResponse(status.value(), status.getReasonPhrase(), mensaje));
    }
}
