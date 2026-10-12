# TRASPASO — UPB-CIENTÍFICA

Contexto acumulado del proyecto: decisiones tomadas, datos técnicos, pendientes
y acuerdos. Complementa a `CLAUDE.md` (que es el índice) y al código del repo.

**Cómo usar este documento:** el código real está en las carpetas del repo y se
lee directamente. Aquí está lo que **no** se deduce del código: por qué se
decidió cada cosa, qué se descartó, qué está roto a propósito y qué falta.

Última actualización: tras la revisión de `node-sync` y `RMIUPBCientifica`, y la
generación de `node-media`.

---

## 1. El proyecto

Sistema distribuido para la microempresa UPB-CIENTÍFICA (Universidad Pontificia
Bolivariana Seccional Bucaramanga), que presta servicios de cómputo de alto
rendimiento (HPC) a la comunidad científica. Conceptualmente es un "Google Drive"
propio (repositorio con autenticación, sincronización, compartición, álbum de
fotos y streaming) más un servicio de ejecución de trabajos MPI sobre un clúster.

Asignatura: Sistemas Distribuidos. Equipo de 6 personas. Sergio coordina.

**Despliegue:** 7 VMs en el Centro de Computación Avanzada (CCA) + clúster HPC
sobre máquinas del Laboratorio.

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

### 2.2 Los seis contratos cumplen SOA (verificado)
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

**Punto a vigilar:** Shared File menciona que Storage podría *"consultar a este
servicio en tiempo real"* para validar permisos en cada operación; el propio
contrato lo marca como posible cuello de botella. Si se implementa así, cachear.

### 2.3 PostgreSQL como motor de base de datos
Decisión de equipo. Cada servicio con BD propia:
- `node-repository` → `metadatos_storage` (índice de archivos y versiones)
- `node-media` → `catalogo_medios` (metadatos de fotos y videos)

Se descartó SQLite (era la propuesta inicial de Storage). La migración obligó a
volver asíncrono todo el repositorio y el servicio de dominio, y permitió usar
`SELECT ... FOR UPDATE` para evitar condiciones de carrera en el versionado.

**Nota:** ninguna BD aparece en `node-repository` en el diagrama de despliegue.
Hay que agregarla.

### 2.4 Cliente móvil: Kotlin nativo
- Descartado React Native/Flutter: JavaScript y Dart no hablan RMI ni SOAP bien.
- El móvil habla **directo** con cada servicio por su protocolo real, sin
  gateway intermedio. El gateway del diagrama es solo para el cliente Web (un
  navegador no puede hablar SOAP/RMI/gRPC nativamente).
- Estado: StateFlow + ViewModel, sin librerías externas.
- SOAP sobre OkHttp con XML manual (se descartó `ksoap2-android`: vive en
  JitPack, no resolvía en Gradle, y está desactualizada).

### 2.5 node-media: dos fuentes de archivos tras una interfaz
`FuenteMedios` tiene dos implementaciones seleccionables por `.env`:
- `storage-api` (**por defecto**): consume la API REST de node-repository.
  Respeta cuotas, permisos e índice. Un archivo subido por cualquier vía aparece.
- `nfs`: lee directo de `/srv/home` como dibuja el diagrama. Menor latencia para
  video, pero salta las reglas de Storage.

Decisión pendiente del equipo; el código soporta ambas sin reescritura.

### 2.6 Monorepo, una carpeta por servicio
Cada servicio usa tecnología distinta, así que cada uno necesita su carpeta con
su entorno y dependencias, dentro de un solo repositorio Git.
Convención de ramas: `feature/<nombre-del-servicio>`.

---

## 3. Datos técnicos

### 3.1 Puertos (del diagrama de despliegue)

| Origen → Destino | Protocolo / Puerto | Nota |
|---|---|---|
| Desktop PC → node-soap | SOAP / HTTPS **8081** | autenticación del agente |
| node-web → node-soap | SOAP / HTTPS **8081** | login y perfiles |
| Consumidores → node-web | HTTPS **443** | portal y SPA |
| node-web → node-rmi | HTTPS **8082** | envío de trabajos |
| node-rmi → hpc-master | RMI / JRMP **2099**, objetos remotos **2100** | |
| node-rmi ↔ hpc-master | NFSv4 **2049** | montaje `/srv/home` |
| hpc-master → hpc-worker | SSH **22** y MPI sobre TCP | |
| node-web → node-repository | HTTP **8084** | |
| node-web → node-media | HTTP **8083** | álbum / streaming |
| node-sync → node-repository | NFSv4 **2049** | lectura / escritura |
| node-repository → node-media | NFSv4 **2049** | lectura |
| Desktop PC → node-sync | gRPC / TLS **9090** | sincronización programada |
| Android → node-sync | gRPC / TLS **9090** | al detectar Wi-Fi local |
| node-repository → node-soap | LDAPS **636** | |
| Todas las VMs → node-monitoreo | HTTP **9100** | exporters |
| node-monitoreo (Grafana) | HTTP **3000** | |

### 3.2 Nodos y artefactos (diagrama de despliegue)

**VM node-soap** — OpenLDAP 2.5 slapd (`slapd.conf`, `upb-cientifica.ldif`);
Apache 2.4 + PHP 8 (`mfa.php`, `users.php`, `users.wsdl`)

**VM node-rmi** — Debian 12, JVM 17 (`gestor-cluster.jar`,
`seguridad-rmi.policy`, `rmiregistry`, `job-api.jar`)

**VM node-web** — Node.js 20 (`rutas-servicio.json`, `spa-ui.js`,
`servidor-web.js`)

**VM node-repository** — Debian 12, NFSv4, GnuPG 2.4 (`upbc-respaldo.pub`,
`cuotas.conf`, `/srv/home`, `shared-file-svc`, `respaldo-gpg.sh`)

**VM node-sync** — Go 1.22 (`syncd`, `filesync.proto`)

**VM node-media** — Debian 12, FFmpeg 6, PostgreSQL 15 (`album-svc`,
`streaming-svc`, BD `catalogo-medios`)

**VM node-monitoreo** — Debian 12 (`grafana-server`, `prometheus`)

**Clúster HPC (Laboratorio)** — `hpc-master`: Debian 12, OpenMPI 4.1, OpenJDK 17
(`hostfile`, `job-runner.jar`). `hpc-worker [1..N]`: Debian 12, OpenMPI 4.1
(`libmpi.so`, `trabajo.bin`)

**Consumidores** — Android Mobile (`credencial.local`, `upbc-movil.apk`);
Desktop PC (`sync-perfil.conf`, `credencial.local`, `fsagent`, navegador)

### 3.3 Interfaces del diagrama de componentes
- Servicios del Producto: Shared File (`IArchivos`), Photo Album (`IAlbum`),
  Streaming (`IStreaming`), Monitoreo (`IMetricas`)
- Servicios de Aplicación: Portal Web (`IPortal`), Gestor del Clúster
  (`ITrabajos`), Servicio de Usuarios (`IAutenticación`), Servicio de
  Sincronización (`ISincronización`)
- Recursos: Repositorio de Archivos (`IAlmacenamiento`), Ejecutor MPI
  (`IEjecución`), Directorio de Usuarios (`IPerfiles`)
- Clientes: Interfaz Web SPA, Agente de Escritorio, App Móvil

### 3.4 Endpoints que el cliente móvil espera

**Auth (SOAP)**: `login(usuario, contrasena, origenCliente)` → `token`, `roles`,
`mapaServiciosAutorizados`; `validarToken(token)` → `valido`; `logout(token)`.
El contrato añade `registrarUsuario`, `obtenerPerfil`, `obtenerRoles`,
`obtenerPermisos`.

**Storage (REST)**
```
GET    /storage/directorios/{id}
POST   /storage/archivos            (multipart; query: directorioDestino, sobrescribir)
GET    /storage/archivos/{id}/descargar
DELETE /storage/archivos/{id}
GET    /storage/cuota
```
`ArchivoDto`: `id`, `nombre`, `tipo`, `tamanoBytes`, `version`,
`directorioContenedorId`.

**Shared File (REST)** — `node-shared-file/`, puerto 8085, VM node-repository.
Detalle completo en `node-shared-file/README.md`.
```
POST   /shared-file/compartir                 CompartirArchivo
POST   /shared-file/compartir-directorio      CompartirDirectorio
PATCH  /shared-file/compartir/{id}            ActualizarPermisosCompartidos
DELETE /shared-file/compartir/{id}            DejarDeCompartir
GET    /shared-file/compartidos-conmigo       ListarCompartidosConmigo
GET    /shared-file/que-yo-comparto           ListarQueYoComparto
GET    /shared-file/permisos-efectivos/{id}   ObtenerPermisosEfectivos
GET    /shared-file/home, /home/contenido, /cuota
```

**Storage, añadido para Shared File** (las comparticiones las APLICA Storage):
```
GET    /storage/nodos/{id}                          metadatos + nivelEfectivo de quien pregunta
PUT    /storage/nodos/{id}/accesos                  { destinatarioTipo, destinatarioId, nivel, expiraEn? }
DELETE /storage/nodos/{id}/accesos/{tipo}/{destinatario}
```
Permiso efectivo = bits Unix + comparticiones propias y heredadas de carpetas,
prevalece el más permisivo (`node-repository/src/dominio/accesos.js`). Desde
2026-10-11 todo nace privado (`rw-------`): antes el grupo común "usuarios"
podía leerlo todo.

**Streaming (REST)**
```
GET /streaming/catalogo?pagina=N
GET /streaming/buscar?criterioTexto=...
GET /streaming/{id}/sesion
```

**Photo Album (REST, propuesto — contrato formal aún sin redactar)**
```
GET    /album/fotos?pagina=N
GET    /album/fotos/buscar?criterioTexto=...
GET    /album/fotos/{id}
GET    /album/fotos/{id}/miniatura
GET    /album/fotos/{id}/contenido
POST   /album/indexar
GET    /album/albumes
POST   /album/albumes
GET    /album/albumes/{id}
POST   /album/albumes/{id}/fotos
DELETE /album/albumes/{id}/fotos/{medioId}
DELETE /album/albumes/{id}
```

### 3.5 Tokens de desarrollo
Formato del mock: `mock-token-<uid>-abc123`. Usuarios de prueba:
`user1 / 1234`, `investigador / test`. Mock de Auth en Node.js, puerto 8080.

### 3.6 Entorno de desarrollo
Windows, JDK 21, Android Studio instalado (solo para SDK y emulador), edición en
VSCode. Gradle wrapper 8.6. Emulador ve el PC como `10.0.2.2`; celular físico
necesita la IP Wi-Fi real (no las virtuales `192.168.56.x` de VirtualBox).

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
- **Mínimo 4 nodos worker** en el clúster. El roadmap decía "2-3 nodos" para el
  MVP: queda anulado. Total: 5 máquinas (1 maestro + 4 workers).

---

## 5. Reparto de trabajo (del roadmap)

Seis desarrolladores individuales. Se descartó una propuesta previa de 3 parejas.

| Integrante | Responsabilidad | Depende de |
|---|---|---|
| Dev A | Infraestructura + Authentication (PHP/SOAP) | Nadie |
| Dev B | Distributed Storage + Repository | Contrato de Auth |
| Dev C | Scheduler + Cluster MPI + HPC Service (Java/RMI) | Contrato de Storage |
| Dev D | Shared File + File Sync (Go/gRPC) | Contrato de Storage |
| Dev E | Photo Album + Streaming | Contrato de Storage |
| Dev F | Monitoring + Clientes + pruebas de integración | Contratos de todos |

*No confirmado* si el reparto real del equipo coincide con esta tabla ni qué rol
ocupa Sergio.

**Autores del informe:** Andrés Felipe Pinzón Camacho, Sergio Alejandro Sanabria
Moreno, Angie Lorena Villareal Vásquez, Valentina Téllez Salazar, Fernando
Cancelado Figueroa, Daniel Felipe Aguilar Latorre. (Angie elaboró la propuesta de
arquitectura y el roadmap.)

---

## 6. Estado por servicio

| Servicio | Estado |
|---|---|
| `node-repository` | ✅ funcionando (PostgreSQL, cuotas, permisos, versionado) |
| `node-sync` | ✅ funcionando (gRPC/TLS, interceptor de auth) |
| `node-web` | ✅ funcionando |
| `RMIUPBCientifica` | ⚠️ gestor de trabajos OK; sin MPI real ni autenticación |
| `node-media` | 🔨 código generado, sin probar en integración |
| Cliente móvil Android | ⚠️ compila y corre contra mock; pantallas con datos simulados |
| **Authentication (node-soap)** | ❌ **no existe** |
| Monitoreo | ❌ no existe |
| `job-runner.jar` / MPI real | ❌ no existe |
| Shared File | ✅ `node-shared-file/` (8085), proceso aparte en la VM node-repository, como `shared-file-svc` en el diagrama |
| `fsagent` | ❌ no existe |
| `respaldo-gpg.sh` | ❌ no existe |

---

## 7. Pendientes críticos

### 7.1 No existe Authentication Service
Los tres servicios activos usan validadores simulados (`ValidadorToken.js` en
Storage y node-media, `interceptor.go` en sync); RMI no valida nada. Todo el
sistema está apoyado en tokens `mock-token-*`.

Cuando llegue el servicio real, `validarToken` debe devolver **uid, roles y
grupos**. Los grupos son imprescindibles: el modelo de permisos Unix de Storage
evalúa el segmento "grupo" y hoy el mock se los inventa.

### 7.2 node-sync escribe por NFS, saltándose Storage
Con node-repository sirviendo, hay dos servicios escribiendo en `/srv/home` sin
conocerse. Consecuencias: se saltan cuotas y permisos, y **un archivo subido por
sync no existe para Storage**, así que Photo Album no lo verá.

Opciones: (A) sync consume la API REST de Storage — la interfaz `Store` ya lo
permite, basta un `StorageAPIStore`; (B) Storage reindexa periódicamente.
Recomendada la A. **Sin decidir.**

Detalle de diseño para la opción A: `Version`, `BumpVersion`, `LastSync` y
`Touch` de la interfaz `Store` son estado de sincronización, no de
almacenamiento; deben quedarse en PostgreSQL local de sync. Conviene separar la
interfaz en `FileStore` y `SyncStateStore`.

### 7.3 El gestor RMI ejecuta shell arbitrario sin autenticar
`ProcessBuilder("bash", "-c", job.getComando())` con el comando enviado por el
cliente, y sin auth en RMI ni en REST. Cualquiera con acceso al puerto ejecuta lo
que quiera, y esa VM monta `/srv/home`. Contradice `Contrato_HPC`, que habla de
*código fuente y datasets*, no de comandos.

Además `listJobs` devuelve los trabajos de todos los usuarios.

### 7.4 No hay integración con el clúster MPI
`gestor-cluster` no menciona `mpirun`, `hostfile`, `hpc-master` ni `/srv/home`.
Los `NUM_WORKERS = 3` son hilos locales de una VM. **El MVP del proyecto no está
cubierto.** Falta `job-runner.jar`, la conexión RMI real con `hpc-master` y el
retorno de resultados a Storage.

### 7.5 Estado del gestor RMI solo en memoria
`ConcurrentHashMap`: al reiniciar se pierden trabajos encolados, históricos y
resultados. Un trabajo HPC puede durar horas. Rompe el histórico de RF-12.

### 7.6 Faltan contratos
No existen `Contrato_PhotoAlbum` ni `Contrato_Monitoring`, aunque ambos servicios
aparecen en los dos diagramas.

---

## 8. Pendientes importantes

**RMI**
- Los resultados no llegan a Storage (se guardan como `String` en memoria).
- `leerSalida` acumula sin límite → `OutOfMemoryError` tumba todo el servicio.
  Debe ir a `/srv/home/trabajos/<id>/stdout.log`.
- Sin timeout de ejecución: un trabajo colgado ocupa un worker para siempre.
- Race en cancelación: `procesosActivos.put()` ocurre tras `pb.start()`; un
  `cancelJob` en esa ventana marca CANCELLED pero el proceso sigue vivo.
- Falta `getClusterStatus` (el contrato incluye `ObtenerEstadoCluster`).

**sync**
- Resolución de conflictos: gana siempre el cliente, el segundo dispositivo pisa
  el trabajo del primero sin avisar. El roadmap lo marca como *decisión difícil
  de revertir*.
- `.sync-meta.json` no atómico, global y dentro del export NFS. Migrar a
  PostgreSQL (el propio código lo tiene como TODO).
- Campo `dispositivo` recibido pero no usado: el estado es por uid, no por
  dispositivo.
- Sin límite de tamaño de archivo; TLS solo advierte en vez de exigir.

**node-media**
- La indexación es bajo demanda (`POST /album/indexar`); no hay eventos desde
  Storage. Definir si la dispara el cliente o un cron.

**Storage**
- Falta la capa de replicación/metadatos que le atribuía la propuesta de
  arquitectura. Hoy escribe en un solo lugar: es el SPOF que el propio análisis
  de riesgos identificó.
- Falta `respaldo-gpg.sh` (RNF-01). Necesita que el equipo defina la política.

**Transversal**
- Ningún servicio expone `/metrics` para Prometheus, aunque el diagrama dice que
  todas las VMs exponen exporter en 9100.
- Tráfico interno sin cifrar en 8083, 8084, 2049, 9100, 3000 y RMI 2099. RNF-02
  exige documentar el riesgo asumido.

**Puertos en desacuerdo con el diagrama**

| Elemento | Código | Diagrama |
|---|---|---|
| RMI Registry | 1099 | 2099 |
| job-api | 8080 HTTP | 8082 HTTPS |
| syncd | 50051 | 9090 |

---

## 9. Correcciones pendientes en los diagramas

1. **Montaje NFS incompleto**: solo llega a `hpc-master`; MPI necesita que
   **todos** los workers vean `/srv/home` o `mpirun` falla.
2. **Faltan conexiones del móvil**: Android aparece solo con gRPC, pero ya hace
   login SOAP y consume REST.
3. **Storage sin base de datos**: agregar PostgreSQL a `node-repository`.
4. **Mínimo de nodos**: actualizar de 2-3 a 4 workers.
5. **El Scheduler no aparece** en ningún diagrama.
6. **Typos**: "Servicos de Aplicación", "Service implementaion".
7. **Agrupación**: File Sync y MPI Jobs son servicios del producto según la
   Figura 1, pero aparecen en Servicios de Aplicación; Monitoreo al revés.

---

## 10. Correcciones pendientes en el informe

### 10.1 Críticas
**Tres protocolos mal atribuidos.** Los diagramas están bien; el texto no:

| El informe dice | Lo correcto |
|---|---|
| SOAP → streaming | SOAP → **usuarios/autenticación** |
| RMI → Shared File | RMI → **clúster / trabajos MPI** |
| gRPC → trabajos MPI | gRPC → **File Sync** |

Afecta: el párrafo de "Protocolos de comunicación", la sección de RMI/CORBA, la
de streaming adaptativo, y los objetivos específicos 3 y 4.

**Falta el objetivo específico del núcleo**: ninguno plantea *desarrollar* el
servicio HPC/MPI, solo documentarlo.

### 10.2 Importantes
- Seis secciones vacías: Introducción, Marco conceptual, Metodología,
  **Resultados**, Cronograma, Discusión y conclusiones.
- Plantilla Springer sin limpiar: abstract y keywords genéricos, afiliación de
  Heidelberg, secciones de ejemplo ("A Subsection Sample", Tabla 1, ecuación),
  referencias placeholder.
- Estilo de citación autor-año donde LNCS pide corchetes numerados.
- Las ~15 fuentes citadas en el estado del arte no están en la lista de
  referencias.
- La sección de tolerancia a fallos dice que el proyecto "no detalla mecanismos
  de replicación" — ya no es cierto — y menciona "el syllabus del curso", lo que
  rompe el registro académico.

### 10.3 Terminología
Es **un clúster de 5 nodos**, nunca "5 clústeres". Los nodos son las máquinas;
el clúster es el conjunto.

---

## 11. Próximos pasos

1. **Llevar al equipo la decisión de 7.2** (NFS vs API de Storage). Bloquea a
   Photo Album y afecta a Storage y sync.
2. **Zanjar los puertos** antes de que queden escritos en más clientes.
3. **Redactar `Contrato_PhotoAlbum`**, tomando como base los endpoints del
   punto 3.4.
4. **Cerrar autenticación en RMI y quitar el shell arbitrario** (7.3).
5. **Montar el clúster de 5 nodos** y empezar `job-runner.jar` (7.4) — es lo más
   riesgoso técnicamente según el roadmap y lo que más trabajo queda.
6. **Corregir el informe**, empezando por las tres atribuciones de protocolo.
7. Probar node-media en integración con node-repository real.

---

## 12. Convenciones acordadas

- Español en nombres y comentarios.
- Capas: `rutas/` (solo traduce protocolo ↔ dominio) → `dominio/` (reglas puras,
  sin HTTP/SQL/FS) → `datos/` (Repository) → `auth/` (Strategy).
- Composition root único en `index.js` / `Main.java`.
- Errores de dominio propios, traducidos a HTTP en un solo middleware.
- El `uid` sale siempre del token validado, nunca del cuerpo del mensaje.
- Los repositorios de datos simulados usan un flag `usarDatosSimulados` para
  alternar a backend real sin tocar UI ni ViewModels.
- Cada `Repository` lleva un comentario `>>> NOTA PARA EL PROGRAMADOR DEL
  SERVIDOR <<<` con los endpoints que espera del servicio correspondiente.