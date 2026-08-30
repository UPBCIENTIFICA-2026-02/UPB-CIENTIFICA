const fs = require("fs");

/**
 * Lee cuotas.conf (archivo que aparece en el diagrama de despliegue).
 * Formato, una línea por usuario:   usuario=bytes
 * Ejemplo:                          jperez=10737418240
 * Las líneas que empiezan con # son comentarios.
 */
class CuotasRepository {
    constructor(rutaArchivo, cuotaPorDefecto) {
        this.rutaArchivo = rutaArchivo;
        this.cuotaPorDefecto = cuotaPorDefecto;
        this.cuotas = new Map();
        this.cargar();
    }

    cargar() {
        if (!fs.existsSync(this.rutaArchivo)) return;
        const contenido = fs.readFileSync(this.rutaArchivo, "utf-8");
        for (const linea of contenido.split("\n")) {
        const limpia = linea.trim();
        if (!limpia || limpia.startsWith("#")) continue;
        const [usuario, valor] = limpia.split("=");
        if (usuario && valor) this.cuotas.set(usuario.trim(), Number(valor.trim()));
        }
    }

    cuotaDe(usuarioId) {
        return this.cuotas.get(usuarioId) ?? this.cuotaPorDefecto;
    }
}

module.exports = CuotasRepository;