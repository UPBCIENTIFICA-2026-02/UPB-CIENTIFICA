package com.cluster.gestor.dominio;

import com.cluster.common.ErrorHpc;
import com.cluster.common.ErrorHpc.Codigo;
import com.cluster.common.SolicitudTrabajo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Validaciones de EnviarTrabajo (Contrato_HPC §3.1, "ValidarTrabajo"). Reglas
 * puras: no saben de RMI, de Storage ni del clúster.
 *
 * Los límites son la "política institucional" del contrato y se fijan en el
 * composition root (HPC_MAX_PROCESOS, HPC_MAX_TIEMPO).
 */
public final class ReglasTrabajo {

    /** Lenguajes que job-runner sabe compilar o lanzar con mpirun. */
    public enum Lenguaje { C, CPP, PYTHON }

    /** Nombre de parámetro seguro: se pasa como "clave=valor" en argv, sin shell. */
    private static final Pattern CLAVE = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    private final int maxProcesos;
    private final int maxTiempoSegundos;

    public ReglasTrabajo(int maxProcesos, int maxTiempoSegundos) {
        this.maxProcesos = maxProcesos;
        this.maxTiempoSegundos = maxTiempoSegundos;
    }

    /** Formato y límites. Que el código exista lo comprueba Storage. */
    public void validar(SolicitudTrabajo s) throws ErrorHpc {
        String nombre = s.getNombreTrabajo();
        if (nombre == null || nombre.isBlank() || nombre.length() > 128) {
            throw new ErrorHpc(Codigo.DATOS_INVALIDOS, "nombreTrabajo debe tener entre 1 y 128 caracteres");
        }
        if (s.getRutaCodigo() == null || s.getRutaCodigo().isBlank()) {
            throw new ErrorHpc(Codigo.CODIGO_NO_ENCONTRADO, "Falta rutaCodigo");
        }
        if (s.getNumeroProcesos() < 1) {
            throw new ErrorHpc(Codigo.DATOS_INVALIDOS, "numeroProcesos debe ser al menos 1");
        }
        if (s.getNumeroProcesos() > maxProcesos) {
            throw new ErrorHpc(Codigo.PROCESOS_EXCEDEN_CUOTA,
                    "numeroProcesos excede la cuota de cómputo (máximo " + maxProcesos + ")");
        }
        if (s.getTiempoMaximoEjecucion() < 1) {
            throw new ErrorHpc(Codigo.DATOS_INVALIDOS, "tiempoMaximoEjecucion debe ser al menos 1 segundo");
        }
        if (s.getTiempoMaximoEjecucion() > maxTiempoSegundos) {
            throw new ErrorHpc(Codigo.TIEMPO_EXCEDE_LIMITE,
                    "tiempoMaximoEjecucion excede el límite institucional (" + maxTiempoSegundos + " s)");
        }
        for (String clave : s.getParametrosEjecucion().keySet()) {
            if (!CLAVE.matcher(clave).matches()) {
                throw new ErrorHpc(Codigo.DATOS_INVALIDOS, "Nombre de parámetro no válido: " + clave);
            }
        }
    }

    /** HPC-004 si la extensión no es un programa MPI que el clúster sepa ejecutar. */
    public Lenguaje lenguajeDe(String nombreArchivo) throws ErrorHpc {
        String n = nombreArchivo == null ? "" : nombreArchivo.toLowerCase(Locale.ROOT);
        if (n.endsWith(".c")) return Lenguaje.C;
        if (n.endsWith(".cpp") || n.endsWith(".cc") || n.endsWith(".cxx")) return Lenguaje.CPP;
        if (n.endsWith(".py")) return Lenguaje.PYTHON;
        throw new ErrorHpc(Codigo.FORMATO_NO_SOPORTADO, "Formato de código no soportado: '" + nombreArchivo
                + "'. Se aceptan .c, .cpp/.cc/.cxx (MPI) y .py (mpi4py)");
    }

    /** parametrosEjecucion -> argumentos del programa, en orden: "clave=valor". */
    public static List<String> argumentos(Map<String, String> parametros) {
        List<String> args = new ArrayList<>();
        parametros.forEach((k, v) -> args.add(v == null || v.isEmpty() ? k : k + "=" + v));
        return args;
    }
}
