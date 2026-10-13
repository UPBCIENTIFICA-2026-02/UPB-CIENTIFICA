package com.cluster.gestor.dominio;

import java.util.Map;

/**
 * Lo que el servicio HPC necesita de Distributed Storage (Contrato_HPC:
 * "lectura de código/dataset, escritura de resultados"). La implementación
 * (datos/StorageHttp) habla REST con node-repository usando el token del
 * usuario: Storage aplica sus permisos y su cuota, el gestor no los reimplementa.
 */
public interface Almacenamiento {

    /** Un archivo o directorio de Storage visto por el usuario del token. */
    record Elemento(String id, String nombre, boolean esDirectorio, long tamanoBytes) {
    }

    /** Storage no responde o rechazó la operación (no es "no existe"). */
    class NoDisponible extends Exception {
        public NoDisponible(String mensaje, Throwable causa) {
            super(mensaje, causa);
        }
    }

    /** El token ya no vale (venció la sesión mientras el trabajo esperaba). */
    class SesionVencida extends Exception {
        public SesionVencida() {
            super("La sesión del usuario venció");
        }
    }

    /**
     * Ruta del Home ("/Proyectos/pi.c") o id de nodo -> elemento; null si no
     * existe o el usuario no tiene permiso de lectura (Storage no distingue).
     */
    Elemento resolver(String token, String rutaOId) throws NoDisponible, SesionVencida;

    /** Contenido de un archivo; null si ya no existe o no hay permiso. */
    byte[] descargar(String token, String id) throws NoDisponible, SesionVencida;

    /**
     * Guarda los archivos en el Home, en la carpeta indicada (la crea si hace
     * falta; p. ej. "Resultados HPC/pi-1a2b3c4d").
     *
     * @return la ruta de la carpeta dentro del Home
     */
    String guardar(String token, String carpeta, Map<String, byte[]> archivos)
            throws NoDisponible, SesionVencida;
}
