package com.cluster.common;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * Lo que el gestor le entrega a job-runner para ejecutar un trabajo.
 *
 * El código y el dataset viajan como bytes: el gestor los descargó de Storage
 * con el token del usuario, que es quien comprueba los permisos. job-runner no
 * habla con Storage ni conoce tokens.
 *
 * @param hosts       asignación del planificador: host -> procesos en ese host
 * @param argumentos  parametrosEjecucion convertidos a "clave=valor"
 */
public record OrdenEjecucion(String trabajoId, String nombreCodigo, byte[] codigo,
                             String nombreDataset, byte[] dataset, int numeroProcesos,
                             Map<String, Integer> hosts, List<String> argumentos,
                             int tiempoMaximoSegundos) implements Serializable {
}
