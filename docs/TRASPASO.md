# TRASPASO — UPB-CIENTÍFICA

Contexto acumulado del proyecto: decisiones tomadas, datos técnicos, pendientes
y acuerdos. Complementa a `CLAUDE.md` (que es el índice) y al código del repo.

**Cómo usar este documento:** el código real está en las carpetas del repo y se
lee directamente. Aquí está lo que **no** se deduce del código: por qué se
decidió cada cosa, qué se descartó, qué está roto a propósito y qué falta.

Última actualización: 2026-10-13, tras cerrar la auditoría de requisitos
(File Sync real, compartidos en álbum y streaming, mapa de servicios, respaldos
GPG, análisis de vulnerabilidades, monitoreo y contrato de Photo Album).

---

## 1. El proyecto

Sistema distribuido para la microempresa UPB-CIENTÍFICA (Universidad Pontificia
Bolivariana Seccional Bucaramanga), que presta servicios de cómputo de alto
rendimiento (HPC) a la comunidad científica. Conceptualmente es un "Google Drive"
propio (repositorio con autenticación, sincronización, compartición, álbum de
fotos y streaming) más un servicio de ejecución de trabajos MPI sobre un clúster.

Asignatura: Sistemas Distribuidos. Equipo de 6 personas. Sergio coordina.

**Despliegue:** VMs en el Centro de Computación Avanzada (CCA) + clúster HPC
sobre máquinas del Laboratorio. En desarrollo, todo corre en el PC de Sergio
(sección 3.6).

---

## 2. Decisiones cerradas

### 2.1 SOA, no microservicios ni monolito
Servicios de grano grueso comunicados por contratos estables (WSDL, IDL RMI,
`.proto`, REST).

- **Descartado microservicios**: no se busca despliegue independiente por
  contenedor, versionado agresivo por servicio, ni una BD por servicio con
  consistencia eventual como filosofía central.
- **Descartado monolito**: cada responsabilidad vive en proceso y base de código
  independientes.
- Razón: tecnologías heterogéneas obligatorias (PHP/SOAP, Java/RMI, Go/gRPC) y 5
  plataformas cliente. La interoperabilidad se logra por contrato.

### 2.2 Los contratos cumplen SOA (verificado)
Se revisaron `Contrato_Auth`, `Contrato_Storage`, `Contrato_HPC`,
`Contrato_SharedFile`, `Contrato_FileSync`, `Contrato_Streaming` buscando
patrones de microservicios infiltrados. Resultado positivo:

- No hay "una BD por servicio". Storage es la única persistencia real; los demás
  delegan explícitamente. Citas literales: File Sync *"delegando en Storage toda
  la persistencia real"*; Shared File *"No almacena bytes: delega la persistencia
  física en Distributed Storage Service"*; Streaming *"delegando en Storage la
  persistencia física"*.
- Cluster MPI marcado como *"componente interno del propio servicio, no un
  servicio SOA externo"*.
- Auth: *"Protocolo: SOAP exclusivamente, vía WSDL versionado"*.
- Ninguna mención a Docker, Kubernetes, API Gateway, service discovery ni
  escalado independiente por servicio.

`Contrato PhotoAlbum.md` (nuevo) sigue la misma línea. Los cambios de API que no
figuran en los PDF están en `docs/contratos/Adendas a los contratos.md`.

### 2.3 PostgreSQL como motor de base de datos
Cada servicio con BD propia (índices y relaciones, nunca bytes):
- `node-repository` → `metadatos_storage` (archivos, versiones, carpetas, accesos)
- `node-shared-file` → `comparticiones` (relaciones de compartición)
- `node-media` → `catalogo_medios` (índice de fotos y videos, álbumes)

Se descartó SQLite (era la propuesta inicial de Storage).

### 2.4 Cliente móvil: Kotlin nativo
- Descartado React Native/Flutter: JavaScript y Dart no hablan RMI ni SOAP bien.
- El móvil habla **directo** con cada servicio por su protocolo real (SOAP,
  REST, gRPC con `grpc-okhttp`), sin gateway. El gateway (node-web) es solo para
  el navegador.
- SOAP sobre OkHttp con XML manual (se descartó `ksoap2-android`).

### 2.5 node-media: dos fuentes de archivos tras una interfaz
`FuenteMedios`: `storage-api` (**por defecto**, respeta cuotas y permisos) o
`nfs` (lee `/srv/home`; era la vía de la arquitectura v1 y salta las reglas de
Storage). Se usa `storage-api` (decisión D3 del documento de arquitectura v2).

### 2.6 File Sync persiste a través de Storage (antes 7.2, **decidido**)
node-sync ya no escribe en el NFS: `StorageStore` sube, baja y borra por la API
REST de Storage con el token del usuario. Lo sincronizado aparece en "Mis
archivos", cuenta para la cuota, respeta permisos y queda versionado. Los hashes
se cachean por (id de Storage, versión) en un JSON local de node-sync.
`FSStore` (directo al disco) queda solo para pruebas (`-almacen=fs`).
El diagrama de despliegue v2 ya lo dibuja así (node-sync → node-repository por REST 8084, decisión D3).

### 2.7 Autorización por mapa de servicios (D2)
Además de validar el token, cada servicio pregunta a Authentication
`validarAccesoServicio(usuario, servicio)` (cache 1 min) y responde 403 si el
perfil no lo tiene. Nombres: `storage`, `sharedfile`, `album`, `streaming`,
`filesync`, `hpc`. Perfil = primer grupo del usuario en orden alfabético.
Solo en modo `soap`; en `simulado` todo está permitido.

### 2.8 Monorepo, una carpeta por servicio
Convención de ramas: `feature/<nombre-del-servicio>`. Los tres clientes viven en
repositorios aparte: `FrontWebUPBCientifica`, `FrontUPBCientifica` (Android),
`FrontDesktopUPBCientifica` (Python + CustomTkinter).

---

## 3. Datos técnicos

### 3.1 Puertos

| Origen → Destino | Protocolo / Puerto | Nota |
|---|---|---|
| Clientes → node-soap | SOAP / HTTPS **8081** | autenticación (en desarrollo: `auth-local`, HTTP) |
| Consumidores → node-web | HTTPS **443** (Nginx) → **8080** | portal, SPA y pasarela `/api/*` |
| node-web → node-rmi (job-api) | HTTP **8082** | el diagrama dice HTTPS |
| job-api → gestor-cluster | RMI **2099** (Registry) / **2100** (objeto) | |
| node-web → node-repository | HTTP **8084** | Storage |
| node-web → node-shared-file | HTTP **8085** | Shared File (VM node-repository) |
| node-web → node-media | HTTP **8083** | álbum / streaming |
| node-media → node-shared-file | HTTP **8085** | qué está compartido con el usuario |
| node-sync → node-repository | HTTP **8084** | **antes NFS 2049**; ver 2.6 |
| Desktop / Android → node-sync | gRPC **9090** | TLS en producción (`-tls-cert`) |
| Servicios → node-soap | SOAP **8081** | `validarToken`, `validarAccesoServicio` |
| node-soap → OpenLDAP | LDAPS **636** | |
| node-monitoreo → servicios | HTTP `/metrics` | 8080, 8083, 8084, 8085; gestor **9102** |
| node-monitoreo → todas las VMs | HTTP **9100** | node_exporter |
| node-monitoreo (Grafana) | HTTP **3000** | también en el portal: `/monitoreo/` |
| hpc-master → hpc-worker | SSH **22** y MPI/TCP | |
| hpc-master ↔ workers | NFSv4 **2049** | `/srv/home` |

Los desacuerdos del diagrama de antes (Registry 1099, job-api 8080, syncd 50051)
**ya están resueltos** a 2099, 8082 y 9090. Queda que job-api va por HTTP.

### 3.2 Nodos y artefactos (diagrama de despliegue v2)

Fuente: `docs/arquitectura/fuentes/despliegue.puml` (publicado como
`DeploymentDiagram1.jpg.jpeg`) y el documento `Arquitectura-UPB-CIENTIFICA` (.docx/.pdf).

**VM node-web** — Nginx (TLS 443) + Node.js 20 (`servidor-web.js` 8080, SPA, `rutas-servicio.json`).

**VM node-soap** — OpenLDAP (`directorio.ldif`); Apache 2.4 + PHP 8 (`user.php`/`users.wsdl`,
`sesion.php`, `mfa.php`/`mfa.wsdl`). Despliegue: `despliegue/node-soap/`.

**VM node-repository** — Distributed Storage (8084) y `shared-file-svc` (8085) sobre
PostgreSQL; `/srv/home` exportado por NFSv4 **solo al clúster**; `respaldo-gpg.sh` +
`upbc-respaldo.pub`, con copia fuera del nodo.

**VM node-media** — album + streaming (8083), FFmpeg, PostgreSQL (`catalogo_medios`).

**VM node-sync** — `syncd` (gRPC/TLS 9090, `filesync.proto`).

**VM node-rmi** — `gestor-cluster.jar` (Registry 2099 embebido, objetos 2100, métricas 9102),
`job-api.jar` (8082), `seguridad-rmi.policy`.

**VM node-monitoreo** — Prometheus, Grafana (3000), blackbox_exporter.

**Clúster HPC (malla Grid)** — `hpc-master` (`job-runner.jar`, `hostfile`) +
4 `hpc-worker` + equipos externos registrados; todos montan `/srv/home`.

### 3.3 Diagrama de componentes v2

Organizado como la Figura 1 del enunciado (`docs/arquitectura/fuentes/componentes.puml`):
- **Consumidores:** navegador (SPA), aplicación de escritorio (Windows/Linux), aplicación Android.
- **Bus de servicios:** Streaming, Photo Album, Shared File (REST), File Sync (gRPC),
  MPI Jobs (RMI con fachada REST), Usuarios/Autenticación (SOAP).
- **Servidores de aplicación:** SOAP Server PHP Users, Web Server JavaScript,
  RMI Server Java Cluster, gRPC Server Go Sync.
- **Implementación de servicios:** Streaming y Photo Album (node-media), Shared File,
  Repository, Authentication (OpenLDAP), respaldo GPG.
- **Clúster HPC:** planificador, job-runner (mpicc + mpirun), nodos de cómputo + equipos externos.
- **Monitoreo** transversal.

### 3.4 APIs

La referencia son los contratos (`docs/contratos/*.pdf`, `Contrato PhotoAlbum.md`)
más las **adendas** (`docs/contratos/Adendas a los contratos.md`). Resumen:

**Auth (SOAP, `users.wsdl`)** — `iniciarSesion`/`login` → `token`, `uid`,
`roles`, `grupos`, `mapaServiciosAutorizados`; `validarToken` → `valido`, `uid`,
`roles`, `grupos`; `cerrarSesion`/`logout`; `obtenerUsuario` (con
`homeDirectory`); `validarAccesoServicio(usuario, servicio)`.

**Storage (REST, 8084)**
```
GET    /storage/directorios/{id}             ("root" = Home del usuario)
POST   /storage/directorios
POST   /storage/archivos                     (multipart; directorioDestino, sobrescribir)
GET    /storage/archivos/{id}/descargar      (Range, Content-Type)
DELETE /storage/archivos/{id}
GET    /storage/cuota
GET    /storage/nodos/{id}                   metadatos + nivelEfectivo
PUT    /storage/nodos/{id}/accesos           { destinatarioTipo, destinatarioId, nivel, expiraEn? }
DELETE /storage/nodos/{id}/accesos/{tipo}/{destinatario}
```
Permiso efectivo = bits Unix + accesos propios y heredados; gana el más
permisivo. Todo nace privado (`rw-------`).

**Shared File (REST, 8085)** — ver `node-shared-file/README.md`.

**Photo Album (REST, 8083)** — `Contrato PhotoAlbum.md`. Incluye lo compartido
con el usuario y `ordenPor=RECIENTES|ALFABETICO`.

**Streaming (REST, 8083)**
```
GET    /streaming/catalogo?pagina=N&ordenPor=RECIENTES|MAS_VISTOS|ALFABETICO
GET    /streaming/buscar?criterioTexto=...
GET    /streaming/{id}/sesion
GET    /streaming/{id}/contenido          (Range)
GET    /streaming/{id}/miniatura
DELETE /streaming/{id}
```

**File Sync (gRPC 9090)** — `IniciarSync`, `SubirArchivo`, `DescargarArchivo`,
`EliminarArchivo`, `EstadoSync` (`node-sync/proto/filesync/filesync.proto`).

**HPC (REST 8082 → RMI)** — `POST/GET /jobs`, `GET /jobs/{id}`,
`GET /jobs/{id}/estado`, `DELETE /jobs/{id}`.

### 3.5 Autenticación en desarrollo
`herramientas/auth-local.js` (puerto 8081, ruta `/soap/user.php`) imita node-soap:
login, validación, `obtenerUsuario` con `homeDirectory`, `validarAccesoServicio`
con el mismo mapa que `despliegue/node-soap/directorio.ldif`.

| Usuario | Clave | Perfil | Servicios |
|---|---|---|---|
| user1 | 1234 | investigadores | todos |
| investigador | test | investigadores | todos |
| estudiante | test | estudiantes | todos menos `hpc` |

Tokens: `mock-token-<uid>-<hex>`. Cada servicio elige modo con
`MODO_AUTENTICACION` (Node), `SYNC_AUTH_MODE` (Go), `AUTH_MODE` (Java):
- `simulado`: acepta cualquier `mock-token-<uid>-...`, sin mapa de servicios.
- `soap`: pregunta a Auth; solo valen tokens emitidos por él, y exige el mapa.

### 3.6 Entorno de desarrollo (PC de Sergio)
- Windows 11, JDK 21, Node 25, Python 3.11, PostgreSQL 18, Android SDK,
  Gradle 9.7 (wrapper del móvil).
- Herramientas portables en `%USERPROFILE%\sdk`: Go 1.22, protoc 25, Maven 3.9,
  FFmpeg 8.1, OWASP ZAP 2.17 y `monitoreo\` (Prometheus, Grafana, exportadores).
- **El Control inteligente de aplicaciones de Windows bloquea los ejecutables de
  Go recién compilados** (incluido `go run` y `go test`). Por eso node-sync corre
  en una VM Ubuntu de VirtualBox (`UbuntuServer1`, red NAT, reenvío de 9090 y
  `--nat-localhostreachable1 on`); se compila en Windows con
  `GOOS=linux go build` y se copia por `scp -P 2223`.
- `despliegue/cluster-virtualbox/7-iniciar-servicios-windows.ps1` arranca todo
  (`-HpcLocal`, `-ModoAuth soap`, `-Monitoreo`). Ver `docs/Guia_Cluster_VirtualBox_Local.md`.
- Celular físico: IP Wi-Fi real del PC (no las `192.168.56.x`). Emulador: `10.0.2.2`.

---

## 4. Restricciones

### 4.1 Del enunciado
- Toda la infraestructura en el CCA; el clúster sobre máquinas del Laboratorio.
- **Prohibido**: contenedores y servicios cloud de terceros (salvo sin costo).
- Obligatorio usar las tecnologías de la Figura 1 del enunciado.
- Software libre según licenciamiento.
- Bitácora semanal por equipo con porcentaje de avance.
- Informe final como artículo científico en normas Springer LNCS.
- Cronograma del roadmap: 16 semanas, hito MVP al final de la semana 10.

### 4.2 Del profesor (comunicada en clase)
- **Mínimo 4 nodos worker** en el clúster. Total: 5 máquinas (1 maestro + 4 workers).

---

## 5. Reparto de trabajo (del roadmap)

| Integrante | Responsabilidad | Depende de |
|---|---|---|
| Dev A | Infraestructura + Authentication (PHP/SOAP) | Nadie |
| Dev B | Distributed Storage + Repository | Contrato de Auth |
| Dev C | Scheduler + Cluster MPI + HPC Service (Java/RMI) | Contrato de Storage |
| Dev D | Shared File + File Sync (Go/gRPC) | Contrato de Storage |
| Dev E | Photo Album + Streaming | Contrato de Storage |
| Dev F | Monitoring + Clientes + pruebas de integración | Contratos de todos |

*No confirmado* si el reparto real coincide con esta tabla.

**Autores del informe:** Andrés Felipe Pinzón Camacho, Sergio Alejandro Sanabria
Moreno, Angie Lorena Villareal Vásquez, Valentina Téllez Salazar, Fernando
Cancelado Figueroa, Daniel Felipe Aguilar Latorre.

---

## 6. Estado por servicio y por requisito

| Servicio | Estado |
|---|---|
| `node-repository` (Storage) | ✅ cuotas, permisos Unix + accesos, versionado, `/metrics`, respaldo GPG |
| `node-shared-file` | ✅ compartir archivos y carpetas, con caducidad; Home desde el directorio |
| `node-media` (Album + Streaming) | ✅ propio + compartido, orden, miniaturas y duración (FFmpeg), refresco automático del índice |
| `node-sync` | ✅ gRPC por Storage, conflictos (MANTENER_AMBOS), borrados en ambos sentidos. En desarrollo corre en VM |
| `node-web` | ✅ pasarela, CSP, límite de intentos de login, `/monitoreo/` |
| `RMIUPBCientifica` | ✅ Contrato_HPC: código fuente + dataset de Storage, cola con envejecimiento, asignación por carga, job-runner con `mpirun`, resultado al Home, registro de nodos externos, estado persistente, métricas. Probado con mpirun simulado en el PC; falta la prueba en el clúster de 5 nodos (paso 6) |
| `node-soap` (Auth) | ⚠️ código listo (SOAP + LDAP + MFA + `homeDirectory`); se despliega en la VM del equipo con `despliegue/node-soap/` |
| `node-monitoreo` | ✅ Prometheus + Grafana + alertas (probado en el PC); falta la VM |
| Cliente web | ✅ todos los servicios reales |
| Cliente Android | ✅ todos los servicios reales; File Sync por Wi-Fi del servidor y horario |
| Cliente escritorio | ✅ todos los servicios reales; File Sync con horario (mientras la app está abierta) |
| `job-runner.jar` | ✅ compila y lanza `mpirun`; ejemplos en `job-runner/ejemplos/` |
| `fsagent` (agente de escritorio aparte) | ❌ la sincronización la hace la app de escritorio |

| Requisito | Estado |
|---|---|
| HPC: recibir código fuente y datasets y ejecutarlos con MPI | ✅ en código; ⚠️ validar en el clúster real (7.1) |
| Malla Grid: integrar equipos internos y externos | ✅ `POST /cluster/nodos` (hpcadmin); ⚠️ probar con un equipo externo real |
| Repositorio distribuido de archivos, fotos y videos | ✅ Storage |
| File Sync (copia síncrona, horario, red interna por cable/Wi-Fi, Wi-Fi del móvil, versión en el servidor) | ✅ |
| Shared File (carga por formulario, Home común con cuota) | ✅ |
| Compartir respetando el código Unix de permisos | ⚠️ bits `rwx` aplicados; falta cambiarlos (7.5) |
| Photo Album (web, explorar, buscar, ordenar, presentar) | ✅ |
| Compartir imágenes **externamente** / videos para presentaciones | ⚠️ solo interno (7.5) |
| Streaming (ordenar, difundir, control de acceso y permisos) | ✅ |
| API entre partes | ✅ contratos + adendas + Photo Album |
| Perfiles en directorio (auth, autorización, mapa, árbol) | ⚠️ código listo; falta desplegar node-soap con OpenLDAP |
| GPG en respaldos | ✅ `node-repository/respaldo/` |
| Análisis de vulnerabilidades | ✅ `docs/seguridad/analisis-vulnerabilidades.md` (repetir en producción) |
| Token / MFA | ✅ token en todos; MFA en node-soap (`mfa.php`) |
| Monitoreo | ✅ `node-monitoreo/` |
| Clientes nativos Windows, Linux, Android + web | ✅ (iOS no es obligatorio: "Android o iOS") |

---

## 7. Pendientes críticos

### 7.1 Validar el servicio HPC en el clúster real
El pipeline de Contrato_HPC está implementado (2026-10-13): el gestor resuelve y
descarga código y dataset de Storage con el token del usuario, los planifica
(prioridad con envejecimiento), asigna nodos según su carga y los entrega a
`job-runner` en hpc-master, que compila con `mpicc`/`mpicxx` y lanza `mpirun`;
el resultado vuelve a "Resultados HPC/" del Home. Ya no hay `bash -c` (V-11).
Probado de punta a punta en el PC con un mpirun simulado (14/14 por la pasarela,
más las pruebas de cada cliente). **Falta** ejecutarlo con OpenMPI real:
`despliegue/cluster-virtualbox/6-desplegar-gestor.sh` (clúster de 5 nodos) o
`ejecutor-vm-ubuntu.sh` (una VM).

### 7.2 Identidad de los trabajos en el clúster
Los trabajos corren como `mpiuser` (sin privilegios, solo en el clúster). Para
que corran con la identidad real del usuario, los nodos deben ser clientes LDAP
(punto abierto 4 del documento de arquitectura, RF-20).

### 7.3 Estado del gestor
Se persiste en un archivo (`ESTADO_HPC`, serialización Java): al reiniciar, lo
encolado vuelve a la cola y lo que se ejecutaba queda FALLIDO (reintentable).
Con muchos usuarios convendría PostgreSQL, como el resto de servicios.

### 7.4 node-soap sin desplegar
El código está; falta montarlo en la VM del equipo con
`despliegue/node-soap/desplegar-node-soap.sh` y pasar los servicios a
`MODO_AUTENTICACION=soap` contra ella. Sin esto, en producción no hay directorio
activo real.

### 7.5 Requisitos del enunciado sin cubrir del todo
Trazabilidad completa en la sección 10 del documento de arquitectura y en la
adenda J de los contratos.
- **Malla Grid:** implementado el registro de nodos (`POST/DELETE /cluster/nodos`,
  permiso `hpcadmin`) y la asignación por carga; falta probarlo con un equipo
  externo real (OpenMPI + llave SSH + `/srv/home`).
- **Compartir imágenes externamente** (y videos para presentaciones): enlace
  público de solo lectura con caducidad (`Contrato PhotoAlbum.md` §3.14).
- **Código Unix de permisos:** el propietario no puede cambiar los bits `rwx`
  (falta `CambiarPermisosUnix`) y la `x` de los directorios no se evalúa.

---

## 8. Pendientes importantes

**HPC**
- job-api va por HTTP (el diagrama pide HTTPS).
- Sin progreso (%): OpenMPI no lo informa; los clientes muestran barra indeterminada.
- Sin notificación push al terminar (los clientes consultan cada 3 s).
- Los resultados de más de `MAX_RESULTADOS_MB` quedan solo en el clúster (se avisa en `OMITIDOS.txt`).

**sync**
- Sin sesiones (`sesionId`), RegistrarDispositivo, ResolverConflicto interactivo
  ni historial (ver adendas D).
- El registro de versión y caché de hashes es un JSON local (`./estado/`); migrar a PostgreSQL.
- La programación del escritorio solo corre con la app abierta (el token vive en memoria).

**node-media / Streaming**
- Sin RegistrarVisualizacion ni historial; "más vistos" cuenta sesiones iniciadas.
- El índice se refresca recorriendo el Home (como mucho una vez por minuto);
  con Homes grandes convendría que Storage notifique altas y bajas.

**Storage**
- Escribe en un solo lugar: es el SPOF que el análisis de riesgos identificó.
- Los respaldos cifrados quedan en la misma VM: copiarlos fuera (ver
  `node-repository/respaldo/README.md`). Falta definir quién custodia la llave privada.

**Transversal**
- Tráfico interno sin cifrar (HTTP entre servicios, RMI, NFS): riesgo asumido V-14.
- En el PC de desarrollo PostgreSQL y los servicios internos escuchan en la red
  local (V-12, V-13); en producción, cortafuegos por VM.

---

## 9. Diagramas (corregidos el 2026-10-13)

Los dos diagramas se rehicieron en PlantUML (`docs/arquitectura/fuentes/`) y se
publicaron sobre los JPEG anteriores. Quedan resueltos los puntos que había aquí:
NFS hacia todos los nodos del clúster, conexiones de los clientes nativos,
PostgreSQL en node-repository y node-media, 4 workers, el planificador, los
typos, la agrupación según la Figura 1, node-sync y node-media por REST 8084,
node-media → Shared File 8085, rutas de monitoreo (9100, `/metrics`, 9102,
`/monitoreo/`), `user.php` + `sesion.php` + `mfa.php`, Nginx 443, destino de
respaldo y equipos externos de la malla. `job-runner.jar` aparece como
*pendiente*. El documento de arquitectura pasó a la versión 2
(`Arquitectura-UPB-CIENTIFICA.docx` editable + `.pdf`).

---

## 10. Informe y requerimientos (corregidos el 2026-10-13)

- `docs/Informe.docx` (editable) + `Informe.pdf`: protocolos bien atribuidos
  (SOAP → usuarios, RMI → clúster, gRPC → File Sync), periodo 2026-20,
  objetivo específico del núcleo HPC/Grid, "carta descriptiva" en vez de
  "syllabus", sección de Resultados con el estado real, cronograma y metodología
  sin las atribuciones erróneas. El PDF anterior no tenía fuente editable; el
  .docx es ahora la fuente.
- `docs/Especificacion de requerimientos.docx`: RF-06/08/09/10 sin tecnologías
  equivocadas; RF-03/04/05/07/08/13 con el texto del enunciado (red interna por
  cable o Wi-Fi, versión en el servidor, Home común, búsqueda y compartición
  interna y externa, tiempos de ejecución); RF-24 (Grid) sube a prioridad alta;
  nuevos RF-25 (repositorio distribuido) y RF-26 (APIs). Word actualiza el
  índice al abrir el documento.
- Sigue pendiente en el informe: la plantilla Springer LNCS (estilo de citas
  numeradas) y el cronograma ejecutado al cierre.

---

## 11. Próximos pasos

1. **Desplegar node-soap** en la VM del equipo (7.4) y pasar los servicios a `soap`.
2. **Probar el servicio HPC con OpenMPI real** (7.1): clúster de 5 nodos con el
   paso 6, o una VM con `ejecutor-vm-ubuntu.sh`.
3. Montar las VMs de producción (node-sync, node-monitoreo…) y **repetir el
   análisis de vulnerabilidades en producción** (sección 5 del informe).
4. Implementar lo de 7.5 (Grid, compartir imágenes externamente, `chmod`) y pasar a PDF las adendas.
5. Completar el informe con el cronograma ejecutado y llevarlo a la plantilla LNCS.

---

## 12. Convenciones acordadas

- Español en nombres y comentarios.
- Capas: `rutas/` (solo traduce protocolo ↔ dominio) → `dominio/` (reglas puras,
  sin HTTP/SQL/FS) → `datos/` (Repository) → `auth/` (Strategy).
- Composition root único en `index.js` / `Main.java` / `main.go`.
- Errores de dominio propios, traducidos a HTTP en un solo middleware.
- El `uid` sale siempre del token validado, nunca del cuerpo del mensaje.
- En SOA no se comparte código, se comparte contrato: módulos como
  `ValidadorToken.js` o `metricas.js` son copias deliberadas en cada servicio.
- Cambios en la VM de node-soap: dejar comentario **ANTES / AHORA** en el código.
- Los repositorios de datos simulados usan un flag `usarDatosSimulados` para
  alternar a backend real sin tocar UI ni ViewModels.
