# Análisis de vulnerabilidades — UPB-CIENTÍFICA

**Requisito:** *"La aplicación web debe contar con un análisis de vulnerabilidades
en su ambiente de producción y deben ser claros los niveles de riesgo asumidos."*

| | |
|---|---|
| Fecha | 2026-10-12 |
| Objetivo | Portal web (node-web, :8080) y los servicios que expone la pasarela |
| Ambiente analizado | Despliegue local de integración (script 7, autenticación en modo `soap`, node-sync en VM). Mismo código y configuración que producción salvo TLS/Nginx, que se revisaron por configuración (`node-web/despliegue/nginx-node-web.conf`) |
| Herramientas | OWASP ZAP 2.17.0 (spider + escaneo activo), Nmap 7.99 (`-sV`), `npm audit`, pruebas manuales con `curl` y navegador sin ventana |

> **Alcance y límite.** El ambiente de producción (VMs del CCA) aún no está
> desplegado. El análisis se hizo sobre el despliegue de integración y debe
> **repetirse en producción** con los comandos de la sección 5 cuando exista.

## 1. Resumen

| Nivel | Encontrados | Corregidos | Asumidos / pendientes |
|---|---|---|---|
| Crítico | 2 | 1 | 1 (V-17, solo si se despliega en modo simulado) |
| Alto | 4 | 2 | 2 |
| Medio | 8 | 4 | 4 |
| Bajo / Informativo | 5 | 3 | 2 |

Escala: **Crítico** — compromiso directo de datos o del servidor sin autenticación;
**Alto** — compromiso con condiciones razonables; **Medio** — facilita otros
ataques o expone información sensible; **Bajo** — información o endurecimiento.

## 2. Hallazgos corregidos

| # | Hallazgo | Fuente | Nivel | Corrección (verificada) |
|---|---|---|---|---|
| V-01 | `proxy-addr` con suplantación de IP vía IPv6 mapeada (GHSA-jqcg-44mw-7w3h) en node-web y node-repository | npm audit | **Crítico** | `npm audit fix`: 0 vulnerabilidades en node-web |
| V-02 | `/.git/config` y todo el repositorio descargables desde el portal | ZAP (*Hidden File Found*) | **Alto** | node-web responde 404 a cualquier segmento que empiece por `.` (`src/seguridad.js`) y `express.static` con `dotfiles: 'ignore'` |
| V-03 | Inicio de sesión sin límite de intentos (30 contraseñas falsas y luego la buena entraba) | Manual | **Alto** | 5 fallos por usuario+IP o 20 por IP en 15 min → **429** con `Retry-After` (`src/limiteIntentos.js`) |
| V-04 | Sin Content-Security-Policy | ZAP | Medio | CSP estricta: `script-src 'self'` + hash del único script en línea, `frame-ancestors 'none'`, `object-src 'none'`. El portal completo funciona sin violaciones (prueba en Edge: login, archivos, fotos, streaming con video, compartidos, trabajos) |
| V-05 | Sin protección anti-clickjacking | ZAP | Medio | `X-Frame-Options: DENY` y `frame-ancestors 'none'` |
| V-06 | `express`, `body-parser`, `qs` (DoS por `isBuffer`), `morgan` (inyección en logs) | npm audit | Medio | Actualizados con `npm audit fix` (sin cambios de versión mayor) |
| V-07 | job-api respondía **500** con detalle interno (`No static resource …`) a rutas inexistentes, y devolvía `e.getMessage()` en cualquier error | Nmap / manual | Medio | 404 "Ruta no encontrada"; los errores no controlados se registran en el servidor y el cliente recibe un mensaje genérico (`GlobalExceptionHandler`) |
| V-08 | Falta `X-Content-Type-Options` | ZAP | Bajo | `nosniff` en todas las respuestas, más `Referrer-Policy`, `Permissions-Policy` y `Cross-Origin-Opener-Policy` |
| V-09 | `X-Powered-By: Express` en Storage, Media y Shared File | Manual | Bajo | `app.disable('x-powered-by')` |

Re-escaneo con ZAP tras las correcciones: solo quedaban V-10 (asumido) y V-15 (corregido después con el módulo de monitoreo).

## 3. Riesgos asumidos y pendientes

| # | Riesgo | Nivel | Decisión y justificación | Control compensatorio / acción |
|---|---|---|---|---|
| V-10 | CSP con `style-src 'unsafe-inline'` | Medio (ZAP) → **residual Bajo** | **Asumido.** La interfaz usa atributos `style="…"`. Los estilos en línea no ejecutan código, y los scripts siguen limitados a archivos propios + un hash | Migrar los `style=` a clases CSS en una versión futura |
| V-11 | **El gestor RMI ejecuta comandos con `bash -c`** enviados por el usuario | **Alto** | **Pendiente** (pendiente crítico 3 del proyecto). Es la naturaleza del servicio HPC, pero hoy corre en el host del gestor, no en un entorno aislado | Ya exige token y que el perfil tenga `hpc` (D2). Falta ejecutar en el clúster MPI con un usuario sin privilegios (`job-runner.jar`) |
| V-12 | PostgreSQL (5432) escucha en la red local | **Alto** en el PC de desarrollo | **Asumido en desarrollo**, no aceptable en producción | Producción: cada base solo en `localhost` de su VM (`listen_addresses = 'localhost'`) y `pg_hba.conf` sin acceso remoto |
| V-13 | Servicios internos (8082–8085, RMI 2099, gRPC 9090) accesibles directamente, sin pasar por node-web | Medio | **Asumido en desarrollo**: la app móvil los necesita en una sola IP | Producción: cortafuegos de las VMs según el diagrama de despliegue. Igualmente cada servicio valida el token y el mapa de servicios por su cuenta |
| V-14 | Tráfico interno sin cifrar (HTTP entre servicios, RMI, NFS) | Medio | **Asumido** (RNF-02 parcial). Hacia el usuario hay TLS (Nginx en 443) | Red interna aislada del CCA; TLS en node-soap (LDAPS + HTTPS) y gRPC con TLS disponible (`-tls-cert`) |
| V-15 | IP privada del monitoreo visible en el HTML (`URL_MONITOREO`, en un comentario de ejemplo) | Bajo | **Corregido** con el módulo de monitoreo: Grafana se sirve en el mismo origen, bajo `/monitoreo/` (node-web lo reenvía), y el ejemplo ya no lleva IP | — |
| V-18 | `/metrics` (servicios) y 9100 (exportadores) sin autenticación | Bajo | **Asumido**: Prometheus los lee sin credenciales; solo exponen contadores y uso de recursos, no datos de usuarios (salvo el nombre de usuario en la ocupación de Storage) | Cortafuegos: solo node-monitoreo puede leerlos (`instalar-exportador.sh <ip>`) |
| V-16 | `uuid` < 14 (GHSA-w5hq-g745-h8pq) en Storage, Media y Shared File | Medio (npm) → **residual nulo** | **Asumido**: el fallo está en v3/v5/v6 con buffer; el código solo usa `v4()` | Actualizar a `uuid` 14 cuando se migre a ESM |
| V-17 | Modo `simulado` de autenticación acepta cualquier `mock-token-<uid>` | **Crítico** si se despliega así | Solo desarrollo | Producción **obligatoriamente** `MODO_AUTENTICACION=soap`; cada servicio lo advierte en consola al arrancar |
| — | El contador de intentos de login vive en memoria | Bajo | Asumido: un reinicio de node-web lo pone a cero | Aceptable para un solo proceso; Nginx `limit_req` como segunda capa |

## 4. Controles verificados (sin hallazgos)

- **Control de acceso entre usuarios:** un usuario no lista ni descarga archivos
  ajenos (Storage responde 404, no 403, para no confirmar que existen); File Sync y
  el catálogo de medios están aislados por usuario (pruebas de integración).
- **Recorrido de rutas (`../`)** en File Sync: rechazado (SYNC-002 / ruta inválida).
- **Inyección SQL:** todas las consultas usan parámetros (`$1`, `$2`) de `pg`.
- **Token en la URL** (`?access_token=` del `<video>`): node-web lo pasa a cabecera,
  lo quita antes de reenviar y lo oculta en sus logs; Nginx registra sin query.
- **CORS:** la pasarela no devuelve `Access-Control-Allow-Origin` a orígenes ajenos.
- **Autorización por servicio (D2):** un perfil sin `hpc` recibe 403 en la HPC.
- **Respaldos (RF-11):** cifrados con GPG; sin la llave privada no se pueden leer.

## 5. Cómo repetirlo (en producción)

```bash
# Dependencias (en cada servicio Node)
npm audit --omit=dev
# Puertos expuestos, desde una máquina de la red de usuarios
nmap -sV -p 22,2049,2099,3000,5432,8080-8085,9090,9100 <ip-servidor>
# Escaneo web (ZAP sin interfaz; -port distinto del de la aplicación)
java -jar zap-2.17.0.jar -cmd -port 8099 -quickurl https://node-web.cca.upb.edu.co/ -quickout zap.json
# Cabeceras y fuerza bruta
curl -sI https://node-web.cca.upb.edu.co/
for i in $(seq 1 7); do curl -s -o /dev/null -w "%{http_code} " -X POST https://node-web.cca.upb.edu.co/api/sesion \
  -H "Content-Type: application/json" -d '{"usuario":"prueba","contrasena":"mala","origenCliente":"web"}'; done
```

Resultado esperado: 0 vulnerabilidades altas/críticas en `npm audit`; desde la red
de usuarios solo 443 (y 80 → redirección) abiertos; ZAP sin hallazgos Medio o
superiores salvo V-10; el séptimo intento de login responde 429.
