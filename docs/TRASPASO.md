# TRASPASO — UPB-CIENTÍFICA

Contexto acumulado del proyecto: decisiones tomadas, datos técnicos, pendientes
y acuerdos. Complementa a `CLAUDE.md` (que es el índice) y al código del repo.

**Cómo usar este documento:** el código real está en las carpetas del repo y se
lee directamente. Aquí está lo que **no** se deduce del código: por qué se
decidió cada cosa, qué se descartó, qué está roto a propósito y qué falta.

Última actualización: 2026-10-20, tras desplegar todo el sistema en las tres VPS
de la universidad (incluido node-soap con OpenLDAP), montar el clúster real de
4 VMs Debian 13 y ejecutar en él un trabajo MPI de punta a punta, apuntar los
tres clientes a las VPS (sin modo demo) y rehacer los diagramas (componentes,
despliegue, datos y tres de secuencia) con su guion de exposición.

La actualización anterior (2026-10-13) cerró la auditoría de requisitos: File
Sync real, compartidos en álbum y streaming, mapa de servicios, respaldos GPG,
análisis de vulnerabilidades, monitoreo y contrato de Photo Album.

---

## 1. El proyecto

Sistema distribuido para la microempresa UPB-CIENTÍFICA (Universidad Pontificia
Bolivariana Seccional Bucaramanga), que presta servicios de cómputo de alto
rendimiento (HPC) a la comunidad científica. Conceptualmente es un "Google Drive"
propio (repositorio con autenticación, sincronización, compartición, álbum de
fotos y streaming) más un servicio de ejecución de trabajos MPI sobre un clúster.

Asignatura: Sistemas Distribuidos. Equipo de 6 personas. Sergio coordina.

**Despliegue (real, desde 2026-10):** tres VPS Ubuntu Server 24.04 del CCA
(`pasd_nodo1..3`) con todos los servicios, más un clúster HPC de 4 máquinas
virtuales Debian 13 sobre los PC del Laboratorio (sección 3.2). En desarrollo se
puede seguir levantando todo en el PC de Sergio (sección 3.6).

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

### 2.9 Siete nodos lógicos en tres VPS
El diseño v2 tenía una VM por servicio (node-web, node-soap, node-repository,
node-media, node-sync, node-rmi, node-monitoreo), pero la universidad asignó
**tres VPS**. Se agruparon por afinidad:
- `pasd_nodo1`: entrada, identidad y monitoreo;
- `pasd_nodo2`: datos;
- `pasd_nodo3`: medios y cómputo.

Los **nombres lógicos se conservan como alias** en `/etc/hosts` de cada VPS
(node-soap → nodo1, node-repository → nodo2…). Por eso los servicios y
`rutas-servicio.json` no cambiaron: mover un servicio de máquina es cambiar un
alias.

Sigue siendo SOA, no microservicios: varios servicios comparten máquina, sin
contenedores, y cada uno conserva su proceso, su contrato y su base.

### 2.10 Clúster en VMs dentro de la red de la universidad
Se descartaron dos opciones: aislar los PC del laboratorio con un switch propio
(tiene un solo puerto de red, se perdía internet) y usar el PC de Sergio como
maestro. La opción elegida (la "opción 1" de la guía) es esta:
- **4 VMs Debian 13 en VirtualBox**, una por PC del laboratorio;
- **red en modo puente** con la IP que da la universidad, sin modificar ninguna
  IP ni la red del laboratorio.

Composición: `hpc-master` + 3 workers. El maestro **también ejecuta procesos**,
así que hay 4 nodos de cómputo (ver 4.2).

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
| Desktop / Android → node-sync | gRPC/TLS **9090** | TLS activo en las VPS (CA interna) |
| Servicios → node-soap | SOAP/HTTPS **8081** | `validarToken`, `validarAccesoServicio` |
| node-soap → OpenLDAP | LDAPS **636** | misma máquina (nodo1) |
| Servicios → PostgreSQL | TCP **5432** | solo local en nodo2 y nodo3 |
| node-monitoreo → servicios | HTTP `/metrics` | 8080, 8083, 8084, 8085; gestor **9102** |
| node-monitoreo → todas las VMs | HTTP **9100** | node_exporter (las VMs del clúster aún no, ver 8) |
| node-monitoreo (Prometheus) | HTTP **9095** | solo `127.0.0.1` en nodo1; blackbox en **9115** |
| node-monitoreo (Grafana) | HTTP **3000** | solo `127.0.0.1` en nodo1; se publica en el portal: `/monitoreo/` |
| gestor-cluster (nodo3) → job-runner (hpc-master) | RMI **2099** / **2100** | |
| hpc-master → workers | SSH **22** y MPI/TCP (puertos dinámicos) | dentro de `10.152.164.0/24` |
| hpc-master ↔ workers | NFSv4 **2049** | `/srv/home` servido por el maestro |

Los desacuerdos del diagrama de antes (Registry 1099, job-api 8080, syncd 50051)
**ya están resueltos** a 2099, 8082 y 9090. Queda que job-api va por HTTP.

En las VPS, **ufw** abre solo estos puertos y solo a los orígenes que los usan.

### 3.2 Nodos y artefactos (despliegue real)

Diagrama: `docs/arquitectura/despliegue-real.png` (ver 9).

**VPS (Ubuntu Server 24.04).** Servicios como unidades systemd `upbc-*` con el
usuario `upbc`, código en `/opt/upbc/<servicio>`, secretos en
`/etc/upbc/secretos/` (nunca en el repo) y ufw en cada VPS.

| VPS | IP | Alias lógicos | Qué corre |
|---|---|---|---|
| `pasd_nodo1` | 10.154.12.219 | node-web, node-soap, node-monitoreo | Nginx 443 → node-web 8080 (SPA en `/opt/upbc/node-web/public`); Apache 2.4 + PHP 8.3 con node-soap (HTTPS 8081); OpenLDAP (LDAPS 636); Prometheus, blackbox y Grafana (`/monitoreo/`) |
| `pasd_nodo2` | 10.154.12.221 | node-repository, node-sync | Storage 8084, Shared File 8085, syncd 9090 (gRPC/TLS); PostgreSQL 16 (`metadatos_storage`, `comparticiones`); `/srv/home` |
| `pasd_nodo3` | 10.154.12.222 | node-media, node-rmi | Album + Streaming 8083 con FFmpeg y PostgreSQL 16 (`catalogo_medios`); `gestor-cluster.jar` (RMI 2099/2100, métricas 9102) y `job-api.jar` (8082) en JVM 17; destino de la copia de los respaldos |

**TLS.** Todos los certificados (Nginx, node-soap, LDAPS, syncd) los firma una
CA propia, "UPB-CIENTIFICA CA interna". Los clientes la traen incluida:
- Android: `res/raw/upbc_ca.crt`;
- escritorio: `app/assets/upbc-ca.crt`;
- navegador: hay que instalarla o aceptar el certificado.

**Clúster HPC** (VMs Debian 13 en VirtualBox, modo puente, red `10.152.164.0/24`):

| VM | IP | Rol |
|---|---|---|
| `hpc-master` | 10.152.164.50 | `job-runner.jar` (systemd, RMI 2099/2100) con OpenJDK 21; sirve `/srv/home` por NFSv4; ejecuta procesos MPI |
| `worker1` | 10.152.164.42 (tiene también .44) | nodo de cómputo |
| `worker2` | 10.152.164.49 | nodo de cómputo |
| `worker3` (hostname `hpc-worker3`) | 10.152.164.40 | nodo de cómputo |

Todos usan OpenMPI 5 y el usuario `mpiuser` con el mismo UID en las 4 VMs.

Configuración del job-runner que fue necesaria para que MPI funcione:
- `MPIRUN_OPCIONES=--bind-to none --prtemca oob_tcp_if_include 10.152.164.0/24 --mca btl_tcp_if_include 10.152.164.0/24`, para que OpenMPI no elija la otra IP de worker1 ni IPv6;
- `-Djava.rmi.server.hostname=10.152.164.50`.

El gestor en nodo3 apunta al maestro con:
- `EJECUTOR_HOST=10.152.164.50`, `EJECUTOR_PUERTO=2099`;
- `HPC_NODOS=hpc-master:2,worker1:2,worker2:2,worker3:2`, `HPC_MAX_PROCESOS=8`.

El archivo de entorno anterior quedó como `.antes-cluster`. Montaje paso a paso:
`docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md`.

### 3.3 Diagrama de componentes

`docs/arquitectura/componentes.png` (UML 2.5, interfaces provistas y requeridas):
- **Navegador web:** la SPA solo requiere `IPortal` (HTTPS); nunca habla con
  otro servicio.
- **Consumidores:** Portal web (node-web, pasarela sin lógica), App de
  escritorio y App Android. Usan el bus de siete interfaces; el portal, todas
  menos `ISincronización`.
- **Servicios SOA:** Authentication (`IAutenticación`, SOAP/HTTPS), Storage
  (`IAlmacenamiento`), Shared File (`ICompartidos`), Photo Album (`IÁlbum`),
  Streaming (`IStreaming`), File Sync (`ISincronización`, gRPC/TLS) y Gestor del
  clúster (`ITrabajosHPC`, REST sobre RMI).
- **Dependencias entre servicios:**
  - Shared File, Álbum, Streaming, Sync y el gestor requieren `IAlmacenamiento`;
  - Álbum y Streaming requieren `ICompartidos`;
  - todos validan el token en Authentication.
- **Recursos de datos:** OpenLDAP (LDAPS), `/srv/home` y PostgreSQL con una
  base por servicio.
- **Clúster:** Ejecutor MPI (job-runner) y nodos de cómputo (hpc-master + 3
  workers).
- **Monitoreo** transversal: Prometheus y Grafana.

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

**HPC (REST 8082 → RMI)**
```
POST   /jobs                    GET /jobs (solo los del token)
GET    /jobs/{id}               GET /jobs/{id}/estado
GET    /jobs/{id}/resultado     GET /jobs/{id}/logs
DELETE /jobs/{id}               PUT /jobs/{id}/prioridad
POST   /jobs/{id}/reintento
GET    /cluster/estado          POST /cluster/nodos · DELETE /cluster/nodos/{host} (hpcadmin)
```
La web consulta `GET /api/jobs` cada 3 s (`listarTrabajosUsuario` en el gestor).

### 3.5 Autenticación

**En las VPS** todos los servicios están en modo `soap` contra node-soap real
(OpenLDAP en nodo1), con los usuarios de prueba de
`despliegue/node-soap/directorio.ldif`. Los ficheros de CA LDAP de otra
persona que había en nodo1 se respaldaron en `/root/respaldo-ldap-otro/`.

**En desarrollo:**
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
- **Los puertos de los servicios en el PC se cerraron** (2026-10) porque ya no
  se expone nada en local; para volver a probar en el PC hay que reabrirlos o
  usar solo `localhost`.
- **Los clientes apuntan a las VPS por defecto:**
  - Android: `Entorno.LABORATORIO` en `Configuracion.kt`;
  - escritorio: migración v3 de `config.py`;
  - web: servida desde nodo1.

  El **modo demo o simulado se eliminó** de los tres clientes: si un servicio
  no responde, el cliente muestra el error real.

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
  **Hoy hay 1 maestro + 3 workers** (4 nodos de cómputo, porque el maestro
  también ejecuta). Si se exige al pie de la letra, falta una quinta VM con
  los mismos pasos de la guía y una línea más en `hostfile` y `HPC_NODOS`.

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
| `node-repository` (Storage) | ✅ en nodo2. Cuotas, permisos Unix + accesos, versionado, `/metrics`, respaldo GPG (falta la llave, ver 8) |
| `node-shared-file` | ✅ en nodo2. Compartir archivos y carpetas, con caducidad; Home desde el directorio |
| `node-media` (Album + Streaming) | ✅ en nodo3. Propio + compartido, orden, miniaturas y duración (FFmpeg), refresco automático del índice. Las rutas de miniaturas se migraron al pasar a la VPS |
| `node-sync` | ✅ en nodo2 con TLS. gRPC por Storage, conflictos (MANTENER_AMBOS), borrados en ambos sentidos |
| `node-web` | ✅ en nodo1 detrás de Nginx 443. Pasarela, CSP, límite de intentos de login, `/monitoreo/` |
| `RMIUPBCientifica` | ✅ gestor + job-api en nodo3, job-runner en hpc-master. **Probado en el clúster real:** un k-means MPI se ejecutó en los 4 nodos y el resultado llegó a "Resultados HPC/" del Home |
| `node-soap` (Auth) | ✅ **desplegado** en nodo1 (Apache + PHP 8.3, OpenLDAP por LDAPS). Todos los servicios en modo `soap` |
| `node-monitoreo` | ✅ en nodo1. Prometheus + blackbox + Grafana con datos de las 3 VPS; faltan los nodos del clúster |
| Cliente web | ✅ contra las VPS. Corregido "agregar fotos a álbum" (el menú se abría detrás del diálogo) |
| Cliente Android | ✅ contra las VPS, con la CA interna; File Sync por Wi-Fi del servidor y horario |
| Cliente escritorio | ✅ contra las VPS, con la CA interna; File Sync por gRPC/TLS con horario (mientras la app está abierta) |
| `job-runner.jar` | ✅ servicio systemd en hpc-master; compila con `mpicc` y lanza `mpirun` real (OpenMPI 5) |
| `fsagent` (agente de escritorio aparte) | ❌ la sincronización la hace la app de escritorio |

| Requisito | Estado |
|---|---|
| HPC: recibir código fuente y datasets y ejecutarlos con MPI | ✅ probado en el clúster real (k-means en 4 nodos) |
| Malla Grid: integrar equipos internos y externos | ✅ `POST /cluster/nodos` (hpcadmin); ⚠️ probar con un equipo externo real |
| Repositorio distribuido de archivos, fotos y videos | ✅ Storage |
| File Sync (copia síncrona, horario, red interna por cable/Wi-Fi, Wi-Fi del móvil, versión en el servidor) | ✅ |
| Shared File (carga por formulario, Home común con cuota) | ✅ |
| Compartir respetando el código Unix de permisos | ⚠️ bits `rwx` aplicados; falta cambiarlos (7.5) |
| Photo Album (web, explorar, buscar, ordenar, presentar) | ✅ |
| Compartir imágenes **externamente** / videos para presentaciones | ⚠️ solo interno (7.5) |
| Streaming (ordenar, difundir, control de acceso y permisos) | ✅ |
| API entre partes | ✅ contratos + adendas + Photo Album |
| Perfiles en directorio (auth, autorización, mapa, árbol) | ✅ node-soap + OpenLDAP desplegados en nodo1 |
| GPG en respaldos | ⚠️ scripts listos en `node-repository/respaldo/` y copia a nodo3; falta generar la llave (8) |
| Análisis de vulnerabilidades | ✅ `docs/seguridad/analisis-vulnerabilidades.md`; ⚠️ falta repetirlo sobre las VPS |
| Token / MFA | ✅ token en todos; MFA en node-soap (`mfa.php`) |
| Monitoreo | ✅ `node-monitoreo/` |
| Clientes nativos Windows, Linux, Android + web | ✅ (iOS no es obligatorio: "Android o iOS") |

---

## 7. Pendientes críticos

### 7.1 Los scripts de despliegue de las VPS no están en el repo
Las VPS se montaron con scripts propios (`nodo1-web.sh`, `soap-nodo1.sh`,
`ldap-nodo1.sh`, `nodo2.sh`, `nodo3.sh`…) que quedaron **fuera del repositorio**,
en la máquina de Sergio. Hasta subirlos (por ejemplo a `despliegue/vps/`, sin
secretos), la configuración real solo está documentada aquí y en las propias
VPS (`/etc/upbc/`, unidades `upbc-*`). Reinstalar una VPS desde cero hoy exige
esos scripts.

**Lo mismo pasa con los diagramas:** los PNG y SVG de `docs/arquitectura/` se
generan con scripts Python que no están en el repo (ver 9).

**HPC en el clúster real:** ya validado (k-means en 4 nodos, 2026-10). Lo que
costó está en la guía del clúster: IP doble en worker1, OpenMPI eligiendo
IPv6 o la interfaz equivocada, el firewall entre nodos, `mpiuser` con el mismo
UID, `nofail` en el montaje NFS y el hostname de RMI.

### 7.2 Identidad de los trabajos en el clúster
Los trabajos corren como `mpiuser` (sin privilegios, solo en el clúster). Para
que corran con la identidad real del usuario, los nodos deben ser clientes LDAP
(punto abierto 4 del documento de arquitectura, RF-20).

### 7.3 Estado del gestor
Se persiste en un archivo (`ESTADO_HPC`, serialización Java): al reiniciar, lo
encolado vuelve a la cola y lo que se ejecutaba queda FALLIDO (reintentable).
Con muchos usuarios convendría PostgreSQL, como el resto de servicios.

### 7.4 Endurecer las VPS
Durante el montaje se dejó `sudo` sin contraseña (NOPASSWD) para el usuario de
despliegue en las tres VPS. **Hay que quitarlo** ahora que el despliegue
terminó. (node-soap ya está desplegado: el antiguo 7.4 quedó resuelto.)

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
- Respaldos GPG: el destino de la copia fuera del nodo es nodo3, pero **falta
  generar la llave** (`node-repository/respaldo/generar-llaves-respaldo.sh`) y
  decidir quién custodia la llave privada. Hasta entonces no hay respaldo cifrado
  real.

**Monitoreo**
- Las VMs del clúster no están en Prometheus. En cada VM:
  `ufw allow from 10.154.12.219 to any port 9100`, y luego añadir los objetivos
  en la configuración de Prometheus de nodo1.

**Clúster**
- Los trabajos corren como `mpiuser` (7.2).
- Las IP del clúster las da la universidad por DHCP: si cambian, hay que
  actualizar `/etc/hosts` de las VMs, el `hostfile`, `MPIRUN_OPCIONES` y
  `EJECUTOR_HOST` en nodo3 (guía, paso 2.3).

**Transversal**
- Tráfico interno sin cifrar (HTTP entre servicios, RMI, NFS): riesgo asumido V-14.
- Repetir el análisis de vulnerabilidades sobre las VPS (sección 5 del informe).
- En el PC de desarrollo los puertos ya se cerraron. En las VPS PostgreSQL,
  Prometheus y Grafana escuchan solo en local.

---

## 9. Diagramas (rehechos el 2026-10-17/20)

Los diagramas de `docs/arquitectura/` reflejan el **sistema desplegado** (3 VPS +
clúster) y son coherentes entre sí: mismos nombres, puertos y máquinas.

| Archivo | Contenido |
|---|---|
| `componentes.png/.svg` | UML 2.5: componentes, interfaces provistas/requeridas, dependencias |
| `despliegue-real.png/.svg` | 3 VPS + clúster; cada ruta termina en el servicio que la atiende |
| `datos.png/.svg` | Modelo de datos (diagrama de clases con perfil de datos), un paquete por almacén |
| `secuencia-hpc.png/.svg` | Enviar un trabajo al clúster **desde el portal web** |
| `secuencia-album.png/.svg` | Ver las fotos **desde el portal web** |
| `secuencia-sync.png/.svg` | Sincronizar una carpeta desde las **apps nativas** |
| `guion-exposicion-diagramas.md` | Guion para exponer los seis diagramas, con preguntas probables |

Reglas que siguen las secuencias, y que deben respetar las nuevas:
- el navegador **solo** habla con node-web;
- node-web **reenvía sin validar**: valida el gestor o el servicio de destino;
- las apps nativas van directo a node-soap y a cada servicio.

Cambios respecto a lo anterior:
- se borraron los JPEG antiguos (`ComponentDiagram1`, `DeploymentDiagram1`) y
  la carpeta `fuentes/` con PlantUML;
- los SVG se generan con scripts Python propios, que aún no están en el repo
  (7.1).

El documento de arquitectura pasó a la **versión 3** (2026-10-20,
`Arquitectura-UPB-CIENTIFICA.docx` + `.pdf`). Contiene:
- los seis diagramas;
- la distribución en 3 VPS y el clúster real;
- las decisiones D9 (tres VPS), D10 (clúster en VMs) y D11 (CA interna);
- la trazabilidad actualizada.

**Pendiente:** revisar que el informe (`docs/Informe.docx`) use los diagramas
nuevos.

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



## 11. Convenciones acordadas

- Español en nombres y comentarios.
- Capas: `rutas/` (solo traduce protocolo ↔ dominio) → `dominio/` (reglas puras,
  sin HTTP/SQL/FS) → `datos/` (Repository) → `auth/` (Strategy).
- Composition root único en `index.js` / `Main.java` / `main.go`.
- Errores de dominio propios, traducidos a HTTP en un solo middleware.
- El `uid` sale siempre del token validado, nunca del cuerpo del mensaje.
- En SOA no se comparte código, se comparte contrato: módulos como
  `ValidadorToken.js` o `metricas.js` son copias deliberadas en cada servicio.
- Cambios en la VM de node-soap: dejar comentario **ANTES / AHORA** en el código.
- Los clientes **no tienen modo demo**: siempre hablan con los servicios reales
  (antes había un flag `usarDatosSimulados`, ya eliminado).
- Nunca poner contraseñas en comandos ni en el repo: van en `/etc/upbc/secretos/`
  de cada VPS.
