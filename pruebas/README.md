# pruebas/ — pruebas de punta a punta, seguridad, carga y unitarias

Scripts para comprobar que UPB-CIENTÍFICA funciona **contra los servicios reales**,
en el PC de desarrollo o en las VPS. Sin frameworks: Node 20+ con `fetch` y
`node:test`. La única dependencia (`@grpc/grpc-js`) es para File Sync.

```bash
cd pruebas
npm install                       # solo hace falta para la suite 08 (gRPC)
node ejecutar.js --lista          # qué suites hay
node ejecutar.js                  # todas las E2E contra el PC (entorno local)
node unitarias.js                 # todas las unitarias (Node + JUnit + Go)
node carga/carga.js               # prueba de carga (10 usuarios, 30 s)
```

## Qué hay

| Tipo | Archivo | Qué comprueba |
|---|---|---|
| Humo | `e2e/01-salud.js` | `/health`, `/salud`, `/metrics`, puerto gRPC, Prometheus y Grafana |
| E2E | `e2e/02-autenticacion.js` | SOAP `iniciarSesion`/`login`/`validarToken`/`cerrarSesion`, mapa de servicios aplicado por job-api y Storage |
| E2E | `e2e/03-storage.js` | subida multipart, Home, Range (206/416), versionado, carpetas, cuota, nivel efectivo, privacidad (404 a extraños) |
| E2E | `e2e/04-compartir.js` | códigos SHR-001…004/201, efecto real en Storage, revocación inmediata, carpetas (herencia), grupos, caducidad |
| E2E | `e2e/05-album-streaming.js` | indexación, fotos, miniaturas, álbumes, lo compartido en el álbum del destinatario, video con Range, sesiones y `MAS_VISTOS` |
| E2E | `e2e/06-hpc.js` | validaciones HPC-001…005, trabajo MPI real con dataset, resultado en "Resultados HPC", FALLIDO, timeout, cancelar, reintentar, prioridad |
| E2E | `e2e/07-pasarela-web.js` | portal, cabeceras de seguridad, `/api/sesion`, reenvío a cada servicio (multipart y Range), logout |
| E2E | `e2e/08-filesync.js` | gRPC: SUBIR/BAJAR/IGUAL/CONFLICTO/BORRAR/BORRAR_SERVIDOR, persistencia en Storage, rutas `../`, uid del mensaje ignorado |
| Seguridad | `e2e/09-seguridad.js` | 401 en todos los servicios, tokens falsificados y cerrados, uid del cuerpo ignorado, 404 a extraños, inyección SQL, errores sin trazas |
| E2E | `e2e/10-recorrido-usuario.js` | **la historia completa por el portal**: login → subir → compartir → el otro lo ve en su álbum → trabajo HPC → resultado en el Home → revocar → logout |
| E2E | `e2e/11-mpi-distribuido.js` | trabajo MPI en C en el **clúster real**: reparto en varias máquinas (`MPI_Get_processor_name`), anillo `MPI_Send/Recv`, dataset compartido por NFS con suma repartida exacta, resultado en el Home. Si el clúster está apagado, falla la primera y omite el resto |
| E2E | `e2e/12-clientes.js` | **los tres clientes**: la SPA real en Edge sin ventana (login, 5 pestañas, solo habla con node-web); el código de la app de escritorio (`clientes/escritorio.py`, incluido File Sync gRPC/TLS); el móvil (Configuracion.kt, CA en `network_security_config` y en el APK, certificados válidos para Android, cada ruta Retrofit contra el servidor) |
| E2E | `e2e/13-telemetria.js` | **precisión** de Prometheus/Grafana: N peticiones → contador +N exacto, bytes subidos = métrica de espacio, memoria/CPU de node_exporter = `/proc/meminfo` y `nproc`, métricas del gestor = `/cluster/estado`, alertas coherentes con el estado real (túnel SSH de solo lectura) |
| Seguridad | `e2e/14-seguridad-despliegue.js` | TLS con la CA interna en 443/8081/9090 y LDAPS, TLS 1.0/1.1 rechazados, 80→443 y HSTS, puertos internos cerrados desde fuera, ufw activo, perfil estudiante sin HPC, respaldos `.gpg` fuera del nodo |
| Carga | `carga/carga.js` | p50/p95/p99, op/s y errores por operación con N usuarios virtuales |
| Unitarias | `node-repository/test/`, `node-shared-file/test/`, `node-web/test/`, `unitarias/` | permisos Unix y permiso efectivo, reglas de Shared File con dobles, límite de intentos de login, que las copias deliberadas (`ValidadorToken.js`, `permisos.js`) no se separen |

Las suites 01–10 se pueden correr sueltas (`node e2e/03-storage.js`) o filtradas
(`node ejecutar.js storage compartir`, `node ejecutar.js 05 06`).

## Validación del objetivo (para evidencias)

`validar-objetivo.ps1` ejecuta contra las VPS un bloque por cada parte del
objetivo de validación y se detiene tras cada uno para tomar el pantallazo;
al final muestra la tabla de cumplimiento:

| Bloque | Suites |
|---|---|
| Ejecución distribuida MPI | 11 |
| Clientes Web, Escritorio y Móvil | 12 |
| Precisión de la telemetría | 13 |
| Esquemas de seguridad | 02, 09, 14 |

```powershell
cd pruebas
.\validar-objetivo.ps1                       # pide las claves de prueba si no están en UPBC_CLAVE_*
.\validar-objetivo.ps1 -Bloques mpi          # solo uno (p. ej. al encender el clúster)
```

Requisitos: red de la universidad, `pruebas/.env` con las direcciones de las
VPS, los usuarios SSH y la llave (copiar de `.env.example`; no se versiona), una
llave autorizada en las VPS (las suites 13 y 14 las consultan por SSH en solo
lectura), Edge o Chrome (cliente web),
Python con `grpcio` (cliente de escritorio) y el repositorio hermano de cada
cliente. Para el bloque MPI, las 4 VMs del clúster encendidas.

## Entornos

`entornos.json` tiene tres:

| Entorno | Para qué |
|---|---|
| `local` (por defecto) | PC con `7-iniciar-servicios-windows.ps1 -HpcLocal -ModoAuth soap -Monitoreo`. Usuarios de `auth-local` |
| `vps` | las tres VPS, cada servicio directo. Solo si ufw deja pasar a tu equipo |
| `vps-pasarela` | las VPS como las ve el navegador: todo por Nginx 443 `/api/*` |

Los entornos `vps` y `vps-pasarela` no guardan direcciones ni usuarios en
`entornos.json`: usan `${UPBC_VPS_NODO1}`, `${UPBC_SSH_USUARIO_NODO1}`… que se
leen de `pruebas/.env` (plantilla en `.env.example`). En las VPS hay que pasar
además la CA interna y las claves de los usuarios de prueba (nunca van en el
repositorio):

```powershell
$env:UPBC_CLAVE_user1 = '...'; $env:UPBC_CLAVE_investigador = '...'; $env:UPBC_CLAVE_estudiante = '...'
node ejecutar.js --entorno vps-pasarela --ca C:\ruta\upbc-ca.crt
```

Opciones útiles (todas en la cabecera de `lib/config.js`):

- `--modo-auth simulado`: si los servicios corren con `MODO_AUTENTICACION=simulado`. Se omiten las pruebas que dependen de Authentication y del mapa de servicios.
- `--hpc-lenguaje c`: programa MPI en C (compila con `mpicc`); úsalo en el clúster real. En el PC el mpirun es simulado y solo ejecuta `.py`.
- `--hpc-espera 300`: segundos máximos por trabajo HPC (por defecto 180).
- `--video ruta.mp4`: video para Streaming. Si no se da, se genera con `ffmpeg` (si está en el PATH o en `UPBC_FFMPEG`); si no hay, esas pruebas se omiten.
- `--incluir-limite-login`: prueba el 429 de node-web. Está apagada porque suma al límite **por IP** (20 fallos en 15 min): repetirla bloquearía los inicios de sesión desde tu equipo.
- `--sin-limpiar`: deja lo creado para inspeccionarlo. `--detalle`: muestra cuerpos de respuesta en los fallos.

## Resultados

Cada ejecución deja en `pruebas/resultados/` un `.json` y un `.xml` (JUnit),
útiles como evidencia en el informe. El código de salida es 0 solo si no hubo fallas.

Resultados posibles de cada prueba: **OK**, **FALLA** y **OMITIDA** (falta algo
que no depende del servicio: ffmpeg, modo simulado, un entorno sin acceso directo…).

## Qué queda en el Home tras las pruebas

Todo lo creado lleva el prefijo `e2e-<fecha>-` y se borra al final, **salvo las
carpetas**: la API de Storage no borra directorios (`DELETE /storage/archivos`
solo acepta archivos). Quedan vacías en el Home de `user1`, igual que las
carpetas de `Resultados HPC/e2e-…`.

## Fallas que estas pruebas ya detectan en el código actual

- **09 · "No confirmar a un extraño que algo existe"**: `ArchivoService` comprueba
  el TIPO del nodo antes que el permiso. Un extraño que usa el id de un archivo
  ajeno como carpeta (o al revés) recibe **400** en vez de **404**, y con eso sabe
  que el id existe. La adenda B pide 404 en todos los casos.
  (`node-repository/src/dominio/ArchivoService.js`: `listarDirectorio`,
  `descargarArchivo`, `eliminarArchivo`, `subirArchivo`).
- **09 · "JSON mal formado → 4xx"**: Storage (`POST /storage/directorios`) y
  Media (`POST /album/albumes`) responden **500** a un cuerpo JSON inválido; el
  `SyntaxError` de `express.json()` no llega traducido al middleware de errores
  (debería ser 400).
- **14 · respaldos GPG**: no hay ningún `.gpg` en las VPS. Los scripts existen
  (`node-repository/respaldo/`), pero falta generar la llave del custodio
  (`generar-llaves-respaldo.sh`) y programar la copia.
- **11 · MPI distribuido**: necesita las 4 VMs del clúster encendidas; con el
  clúster apagado el gestor marca 3 nodos EN_FALLA y el ejecutor desconectado
  (la suite 13 comprueba que las alertas lo reflejan).
