package com.cluster.common;

/**
 * Error de negocio del servicio HPC con su código de Contrato_HPC (HPC-001...).
 *
 * Una sola excepción con código en vez de una clase por error: el contrato ya
 * los enumera y job-api los traduce a HTTP mirando el código. ANTES había dos
 * (JobNoEncontradoException, EstadoInvalidoException) y el resto de errores
 * del contrato no existían.
 */
public class ErrorHpc extends Exception {

    private static final long serialVersionUID = 1L;

    /** Código del contrato y estado HTTP con el que lo responde job-api. */
    public enum Codigo {
        CODIGO_NO_ENCONTRADO("HPC-001", 404),
        DATASET_NO_ENCONTRADO("HPC-002", 404),
        PROCESOS_EXCEDEN_CUOTA("HPC-003", 422),
        FORMATO_NO_SOPORTADO("HPC-004", 422),
        TIEMPO_EXCEDE_LIMITE("HPC-005", 422),
        PRIORIDAD_SIN_PERMISO("HPC-007", 403),
        TRABAJO_NO_ENCONTRADO("HPC-101", 404),
        RESULTADO_NO_DISPONIBLE("HPC-103", 409),
        TRABAJO_SIN_RESULTADO("HPC-104", 409),
        NO_CANCELABLE("HPC-105", 409),
        LOGS_NO_DISPONIBLES("HPC-106", 409),
        NO_REINTENTABLE("HPC-107", 409),
        PRIORIDAD_NO_MODIFICABLE("HPC-108", 409),
        NODO_INVALIDO("HPC-301", 422),
        NODO_NO_ENCONTRADO("HPC-302", 404),
        DATOS_INVALIDOS("HPC-400", 400);

        private final String codigo;
        private final int estadoHttp;

        Codigo(String codigo, int estadoHttp) {
            this.codigo = codigo;
            this.estadoHttp = estadoHttp;
        }

        public String codigo() {
            return codigo;
        }

        public int estadoHttp() {
            return estadoHttp;
        }
    }

    private final Codigo codigo;

    public ErrorHpc(Codigo codigo, String mensaje) {
        super(mensaje);
        this.codigo = codigo;
    }

    public Codigo getCodigo() {
        return codigo;
    }

    public static ErrorHpc trabajoNoEncontrado(String id) {
        return new ErrorHpc(Codigo.TRABAJO_NO_ENCONTRADO, "No existe el trabajo " + id);
    }
}
