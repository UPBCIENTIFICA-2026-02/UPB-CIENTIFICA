# Adendas a los contratos de servicio

Cambios en las APIs que **aún no figuran en los PDF** de `docs/contratos/`. Cada
adenda dice qué se añadió, por qué, y lo que el contrato pide y todavía no está
implementado. Todos los cambios son compatibles hacia atrás: campos y rutas
nuevos; ninguno elimina ni renombra algo existente.

Convención de errores REST de los servicios Node:
`{ "error": "<código>", "mensaje": "<texto>" }`.

---

## A. Transversal (todos los servicios)

| Cambio | Dónde | Motivo |
|---|---|---|
| **Mapa de servicios exigido.** Además de validar el token, cada servicio llama a `validarAccesoServicio(usuario, servicio)` de Authentication. Si el perfil no lo tiene: **403 `SERVICIO_NO_AUTORIZADO`** (REST), `PermissionDenied` (gRPC), `NoAutorizadoException(sinIdentidad=false)` → 403 (RMI/job-api). Respuesta cacheada 1 min. Solo en modo `soap` | Storage `storage`, Shared File `sharedfile`, Media `album` y `streaming`, File Sync `filesync`, gestor HPC `hpc` | Requisito "Perfiles de usuario: autorización y mapa de servicios" (D2) |
| **`GET /metrics`** (formato Prometheus) sin autenticación; el gestor HPC en `:9102/metrics` | node-web, Storage, Media, Shared File, gestor-cluster | Módulo de monitoreo (M1). Protegido por cortafuegos (solo node-monitoreo) |
| `X-Powered-By` eliminado | Servicios Express | Análisis de vulnerabilidades (V-09) |

## B. Distributed Storage (`Contrato Storage.pdf`)

**Operaciones nuevas** (las usa Shared File para aplicar una compartición; Storage
es quien la hace cumplir al servir los bytes):

| Método y ruta | Entrada | Salida |
|---|---|---|
| `GET /storage/nodos/{id}` | — | `200` nodo + `nivelEfectivo` de quien pregunta (`NINGUNO`, `LECTURA`, `LECTURA_ESCRITURA`, `LECTURA_ESCRITURA_COMPARTIR`) |
| `PUT /storage/nodos/{id}/accesos` | `{ destinatarioTipo: USUARIO\|GRUPO, destinatarioId, nivel, expiraEn? }` | `200` el acceso guardado. Exige nivel `LECTURA_ESCRITURA_COMPARTIR` sobre el nodo |
| `DELETE /storage/nodos/{id}/accesos/{tipo}/{destinatario}` | — | `204`; `404` si no había acceso |

- **Permiso efectivo:** bits Unix del nodo + accesos propios + accesos heredados de
  las carpetas que lo contienen; gana el más permisivo; los caducados no cuentan
  (`node-repository/src/dominio/accesos.js`).
- Sin ningún acceso, cualquier operación responde **404**, no 403: no se confirma
  a un extraño que el archivo existe.
- `GET /storage/archivos/{id}/descargar` envía ahora `Content-Type` según la
  extensión (el `<video>` y el `<img>` del portal lo necesitan).
- **"root" es el Home del usuario que pregunta**, no una raíz común.

## C. Streaming (`Contrato Streaming.pdf`)

| Contrato | Implementación |
|---|---|
| ListarCatalogo "propio + compartido con él" | **Implementado.** node-media pregunta a Shared File (`ListarCompartidosConmigo`) y lo indexa; el catálogo incluye lo compartido |
| `ordenPor`: `RECIENTES`, `MAS_VISTOS`, `ALFABETICO` | **Implementado** (`GET /streaming/catalogo?ordenPor=`). Otro valor → `400 SOLICITUD_INVALIDA` |
| Resumen: id, título, duración, miniatura, propietario, fecha | Devuelve `id, titulo, duracionSegundos, fecha, tamanoBytes, tieneMiniatura, visualizaciones, propietario`, y además **`compartido`** (bool) |
| GenerarVistaPrevia | Al indexar, con FFmpeg (fotograma del segundo 1). **Ruta nueva** `GET /streaming/{id}/miniatura` (`image/jpeg`) |
| EliminarContenidoMultimedia | `DELETE /streaming/{id}`: borra el archivo en Storage y del catálogo. Lo compartido no lo puede borrar quien lo recibe (`403 PERMISO_DENEGADO`) |
| `contadorVisualizaciones` / `MAS_VISTOS` | Se cuenta **una visualización por cada sesión iniciada** (`IniciarStream`) |

**Pendiente:** RegistrarVisualizacion y ObtenerHistorialVisualizacion,
SolicitarSegmento (HLS/DASH; se usa streaming por rangos), SubirContenidoMultimedia
(se sube por Storage y se indexa), estados `PROCESANDO`/`DISPONIBLE`, varias
calidades, códigos `STR-xxx` (se devuelven los códigos genéricos de arriba).

**Regla añadida:** la primera página del catálogo refresca el índice si tiene
más de un minuto; así se cumple el caso límite "un contenido compartido eliminado
desaparece del catálogo en la siguiente consulta".

## D. File Sync (`Contrato FileSync.pdf`) — `node-sync/proto/filesync/filesync.proto`

| Cambio en el .proto | Para qué |
|---|---|
| `SyncRequest.carpeta` (string) | Carpeta del Home que sincroniza el dispositivo (`rutaBase` del contrato) |
| `SyncRequest.modo_disparo` | `MANUAL`, `AUTOMATICO_AL_CONECTAR`, `PROGRAMADO` |
| `FileMeta.hash_base`, `FileMeta.eliminado` | Hash de la última sincronización y borrado local: distinguen quién cambió (`NUEVO_LOCAL`, `MODIFICADO_REMOTO`, `ELIMINADO_LOCAL`…) |
| `Accion.CONFLICTO`, `Accion.BORRAR_SERVIDOR`, `AccionArchivo.ruta_conflicto` | Conflicto con MANTENER_AMBOS (`archivo (conflicto - dispositivo - fecha).ext`) y borrado propagado al servidor |
| RPC `EliminarArchivo(EliminarRequest)` | El cliente borra en el servidor lo que borró localmente |
| `option java_package`, `java_multiple_files` | Cliente Android; no afecta a Go ni a Python |

- **La persistencia va por Storage** (REST con el token del usuario), como dice el
  contrato ("delegando en Storage toda la persistencia real"): cuota, permisos y
  versiones de Storage. Antes escribía directo en el NFS.
- Errores con código del contrato: `SYNC-002` ruta fuera de la carpeta o sin
  permiso, `SYNC-004` Storage no disponible, `SYNC-005` checksum inválido.
- "Borrado local + modificado remoto" se clasifica como **CONFLICTO**, nunca como borrado.
- La programación (cada hora, diaria, al conectar a la red del servidor) la
  ejecuta el **cliente**; el servidor recibe `modo_disparo`.

**Pendiente:** sesiones con `sesionId` (IniciarSincronizacion en streaming),
RegistrarDispositivo, ResolverConflicto interactivo, Cancelar/Historial,
ConfigurarPoliticaSincronizacion en el servidor (la exclusión de temporales la
hace el cliente).

## E. Authentication (`Contrato Auth.pdf`) — `node-soap/back/users.wsdl`

| Cambio | Detalle |
|---|---|
| `obtenerUsuarioResponse.homeDirectory` (opcional) | Atributo `homeDirectory` de LDAP: el Home sale del directorio (D3), no de una convención |
| `validarAccesoServicio` | Ya existía; ahora lo **consumen todos los servicios** (adenda A). Nombres de servicio: `storage`, `sharedfile`, `album`, `streaming`, `filesync`, `hpc` (entradas de `ou=services`, ver `despliegue/node-soap/directorio.ldif`) |

Perfil = primer grupo del usuario en orden alfabético (como ya hacía `user.php`).

## F. Shared File (`Contrato SharedFile.pdf`)

- `ObtenerHome.homePath` = `homeDirectory` de Authentication (modo `soap`); la
  convención `/srv/home/<uid>` queda como respaldo.
- Ningún cambio de operaciones. `ListarCompartidosConmigo` lo consume ahora también node-media.

## G. HPC (`Contrato HPC.pdf`)

- `403` si el perfil no tiene `hpc` en su mapa de servicios (antes cualquier usuario autenticado podía).
- job-api: una ruta inexistente responde `404 "Ruta no encontrada"` (antes `500` con detalle interno) y los errores no previstos ya no devuelven el mensaje de la excepción.
- Métricas del gestor para el monitoreo en `:9102/metrics`: `hpc_trabajos{estado}`,
  `hpc_cola_longitud`, `hpc_trabajo_duracion_segundos`, `hpc_trabajo_espera_segundos`…

## H. Portal web (node-web, pasarela)

| Cambio | Detalle |
|---|---|
| `POST /api/sesion` | `429 DEMASIADOS_INTENTOS` + `Retry-After` tras 5 fallos (usuario + IP) o 20 (IP) en 15 min |
| `/monitoreo/*` | Reenvío a Grafana (node-monitoreo) en el mismo origen |
| Cabeceras | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Rutas con segmentos ocultos (`/.git`, `/.env`…) | `404` siempre |

## I. Contrato nuevo

- **Photo Album:** `Contrato PhotoAlbum.md` (no existía).

## J. Alineación con los requisitos mínimos del enunciado

Puntos en que los PDF se quedan cortos o contradicen el enunciado. Prevalece el
enunciado; los PDF no se pueden editar (son imágenes), así que la corrección
queda aquí.

| Contrato | El PDF dice | El enunciado exige | Corrección | Estado |
|---|---|---|---|---|
| File Sync | Consumidores: escritorio "principalmente"; "móviles de forma opcional" | El móvil **debe** sincronizar al alcanzar la Wi-Fi de la red local del servidor; los portátiles al conectarse a la red interna, por cable o Wi-Fi | Escritorio (Windows/Linux) y móvil (Android o iOS) son consumidores obligatorios; `modo_disparo = AUTOMATICO_AL_CONECTAR` cubre ambos casos | Cumplido |
| File Sync | — | "Mantener una versión del recurso en los servidores… cualquier cambio en uno de los recursos del cliente debe reflejarse en todas las copias" | Sincronización de tres vías (adenda D) | Cumplido |
| Shared File | `nivelPermiso` "estilo Unix simplificado" | Compartir "respetando el código Unix de permisos de archivos y directorios" | Los niveles se aplican **sobre** los bits Unix de Storage (`rwxrwxrwx`, propietario/grupo/otros). Falta la operación `CambiarPermisosUnix` (el propietario fija el modo, p. ej. `rw-r-----` o `640`) y que la `x` de los directorios controle el recorrido | Parcial |
| Photo Album | — (contrato nuevo) | "Buscar, clasificar y compartir imágenes tanto interna como externamente" | Interno: Shared File. Externo: `CrearEnlacePublico(fotoId, expiracion)` → enlace de solo lectura con caducidad, revocable, que no exige cuenta | Externo pendiente |
| Streaming | Control de acceso por comparticiones | "Compartir videos para presentaciones empresariales" (público externo) | Mismo `CrearEnlacePublico` para videos, con reproducción por rangos | Pendiente |
| HPC | `rutaCodigo`, `rutaDataset` (código y datasets) | "Recibirá el código fuente y los conjuntos de datos" | El PDF es correcto; la implementación todavía recibe `comando` (ver G y `TRASPASO.md` §7) | Pendiente |
| HPC | Sin operaciones de nodos | Malla Grid que integre dispositivos "tanto desde su centro de cómputo como de forma externa" | Operaciones nuevas: `RegistrarNodo(host, capacidadProcesos, externo)` y `RetirarNodo(host)`, con permiso `hpcadmin`; `NodoCluster.origen = LABORATORIO \| EXTERNO`; `ObtenerEstadoCluster` los lista | Pendiente |
| Todos | Consumidores "Web, Windows, Linux, Android, iOS" | Clientes nativos para Windows, Linux y Android **o** iOS | iOS no es obligatorio; en este periodo el cliente móvil es Android | — |
