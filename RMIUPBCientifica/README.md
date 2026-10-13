# Servicio HPC (rmi-system)

Servicio central de UPB-CIENTÍFICA (Contrato_HPC): recibe **código fuente y
conjuntos de datos** del Home del usuario, los planifica y los ejecuta **en
paralelo con MPI** sobre el clúster (malla Grid). El resultado vuelve al Home,
en `Resultados HPC/<nombre>-<id>`.

Es el "RMI Server Java Cluster" de la Figura 1 del enunciado:

| Módulo | Dónde corre | Qué hace |
|---|---|---|
| `common` | (librería) | Contrato RMI: `ServicioHpc` (clientes ↔ gestor) y `EjecutorMpi` (gestor ↔ job-runner), modelo `TrabajoHpc`, `ErrorHpc` con los códigos HPC-xxx |
| `gestor-cluster` | node-rmi | HPC Service + Scheduler: valida el token y el mapa de servicios, resuelve y descarga código/dataset de Storage con el token del usuario, cola con prioridad y envejecimiento, asigna nodos según su carga, guarda el resultado en el Home. Métricas en `:9102` |
| `job-runner` | hpc-master | Cluster MPI: escribe el código y el dataset en el directorio compartido por NFS, compila con `mpicc`/`mpicxx` y lanza `mpirun` con el hostfile asignado; corta por tiempo máximo y cancela |
| `job-api` | node-rmi | Fachada REST (Spring Boot) para el portal y las apps |

> **Antes:** el gestor recibía un `comando` de shell y lo ejecutaba con
> `bash -c` en su propia máquina, sin MPI ni clúster (riesgo V-11). Ya no hay
> shell en ningún punto: job-runner lanza el compilador y `mpirun` con listas de
> argumentos, y el código del usuario solo corre en el clúster como `mpiuser`.

## 1. Arquitectura

```text
Portal / apps ──REST──▶ job-api :8082 ──RMI 2099/2100──▶ gestor-cluster (node-rmi)
                                                         │  ├─ Auth (SOAP): token + servicio "hpc"
                                                         │  ├─ Storage (REST 8084): leer código/dataset, guardar resultado
                                                         │  └─ Planificador: cola + AsignarNodos por carga
                                                         ▼
                                       RMI 2099/2100 ─▶ job-runner (hpc-master)
                                                         │  mpicc -O2 -o programa codigo.c
                                                         ▼  mpirun --hostfile ... -np N programa dataset args
                                              hpc-worker 1..4 + equipos externos (SSH + MPI, /srv/home por NFS)
```

Capas del gestor (`com.cluster.gestor`): `rmi/` (presentación: token, mapa de
servicios), `dominio/` (`GestorTrabajos`, `Planificador`, `AsignadorNodos`,
`RegistroNodos`, `ReglasTrabajo`; interfaces `Almacenamiento`, `Ejecutor`,
`Persistencia`), `datos/` (`StorageHttp`, `EjecutorRmi`, `ArchivoPersistencia`),
`auth/` (Strategy simulado/SOAP), `metricas/`. Composition root: `Main`.

## 2. Reglas de negocio (Contrato_HPC)

- **Estados:** `PENDIENTE → EN_COLA → EJECUTANDO → COMPLETADO`;
  `COMPLETADO_PENDIENTE_ALMACENAMIENTO` si Storage no responde (se reintenta cada
  30 s, nunca se pierde un resultado); `FALLIDO`, `FALLIDO_TIMEOUT` (la salida
  parcial se guarda con `INCOMPLETO.txt`), `CANCELADO`.
- **Formatos:** `.c` (mpicc), `.cpp/.cc/.cxx` (mpicxx), `.py` (mpi4py). Otro → HPC-004.
- **Dataset** opcional; llega al programa como primer argumento. Los
  `parametrosEjecucion` van después, como `clave=valor`.
- **Cola:** prioridad `BAJA/NORMAL/ALTA` + un punto por cada `HPC_ENVEJECIMIENTO`
  segundos de espera (ningún trabajo se queda sin turno). `ALTA` exige el servicio
  `hpcadmin` en el mapa del perfil.
- **AsignarNodos:** cada proceso va al nodo con menor ocupación relativa; si no
  caben, el trabajo espera en cola. Un nodo que no responde por SSH se marca
  `EN_FALLA` y el trabajo se reasigna a otros.
- **Malla Grid:** `POST /cluster/nodos` registra un equipo externo (OpenMPI +
  llave SSH del clúster + `/srv/home` montado). Exige `hpcadmin`.
- **Estado persistente:** `ESTADO_HPC` (archivo); al reiniciar, lo que estaba en
  cola vuelve a la cola y lo que se ejecutaba queda `FALLIDO` (reintentable).

## 3. API REST (job-api)

Todas exigen `Authorization: Bearer <token>`; el uid sale del token.

| Método | Ruta | Operación | Respuesta |
|---|---|---|---|
| `POST` | `/jobs` | EnviarTrabajo | `201 { trabajoId, estadoInicial, posicionEstimadaCola, fechaEnvio }` |
| `GET` | `/jobs[?estado=]` | ListarTrabajosUsuario | `200 TrabajoResponse[]` |
| `GET` | `/jobs/{id}` | ConsultarEstadoTrabajo | `200 TrabajoResponse` |
| `GET` | `/jobs/{id}/estado` | ConsultarEstadoTrabajo | `200 { trabajoId, estado, progreso, nodosAsignados, posicionCola, mensajeError }` |
| `GET` | `/jobs/{id}/resultado` | ObtenerResultado | `200 { rutaResultado, tamanoBytes, fecha, codigoSalida, incompleto }` |
| `GET` | `/jobs/{id}/logs` | ObtenerLogsTrabajo | `200 { logsEjecucion }` |
| `DELETE` | `/jobs/{id}` | CancelarTrabajo | `200 { trabajoId, estadoFinal }` |
| `PUT` | `/jobs/{id}/prioridad` | DefinirPrioridadTrabajo `{ nuevaPrioridad }` | `200 TrabajoResponse` |
| `POST` | `/jobs/{id}/reintento` | ReintentarTrabajo | `201 { trabajoId, …, advertencia }` |
| `GET` | `/cluster/estado` | ObtenerEstadoCluster + Cola | `200 { nodosTotales, procesosEnUso, ejecutorConectado, nodos[] … }` |
| `POST` | `/cluster/nodos` | RegistrarNodo `{ host, capacidadProcesos, externo }` | `201 NodoCluster` |
| `DELETE` | `/cluster/nodos/{host}` | RetirarNodo | `204` |

Cuerpo de `POST /jobs`:

```json
{ "nombreTrabajo": "pi", "rutaCodigo": "/Proyectos/pi.c", "rutaDataset": "/Proyectos/datos.csv",
  "numeroProcesos": 6, "tiempoMaximoEjecucion": 600, "prioridad": "NORMAL",
  "parametrosEjecucion": { "pasos": "100000000" } }
```

`rutaCodigo`/`rutaDataset`: ruta dentro del Home o id de Storage (lo único que
sirve para un archivo compartido por otro).

Errores: `{ status, error, codigo, mensaje }` con `codigo` del contrato —
HPC-001/002 (404 código/dataset no encontrado o sin permiso), HPC-003/004/005
(422 cuota de procesos, formato, tiempo), HPC-007 (403 prioridad ALTA sin
permiso), HPC-101 (404), HPC-103/104/105/106/107/108 (409). Además `401` sin
token, `403` perfil sin `hpc`, `503` gestor, Storage o Auth caídos.

## 4. Puertos

| Puerto | Proceso | Uso |
|---|---|---|
| `8082` | job-api | REST para portal y apps (el diagrama pide HTTPS: pendiente) |
| `2099` / `2100` | gestor-cluster | Registry RMI embebido / objeto `ServicioHpc` |
| `9102` | gestor-cluster | `GET /metrics` (trabajos por estado, cola, nodos, procesos, tiempos) |
| `2099` / `2100` | job-runner (hpc-master) | Registry / objeto `EjecutorMpi`. **2199/2200** si comparte máquina con el gestor |

## 5. Configuración

**gestor-cluster:** `AUTH_MODE=soap|simulado`, `AUTH_URL`, `AUTH_NS`,
`URL_STORAGE` (`http://node-repository:8084`), `EJECUTOR_HOST` (`hpc-master`),
`EJECUTOR_PUERTO` (2099), `HPC_NODOS` (`hpc-master:2,hpc-worker1:2,…`),
`HPC_MAX_PROCESOS` (64), `HPC_MAX_TIEMPO` (86400 s), `HPC_ENVEJECIMIENTO` (60 s),
`ESTADO_HPC`, `METRICAS_PUERTO`. Arrancar con `-Djava.rmi.server.hostname=<IP>`.

**job-runner:** `RUNNER_PUERTO_REGISTRY` / `RUNNER_PUERTO_OBJETO`,
`DIR_TRABAJOS` (`/srv/home/.hpc-trabajos`, **compartido por NFS**), `MPICC`,
`MPICXX`, `MPIRUN`, `MPIRUN_OPCIONES` (p. ej. `--mca btl_tcp_if_include
192.168.56.0/24`), `PYTHON`, `SSH`, `NODOS_LOCALES`, `MAX_RESULTADOS_MB` (200).
Corre como `mpiuser` (OpenMPI no arranca como root).

**job-api:** `rmi.gestor.host`, `rmi.gestor.registryPort` (2099),
`rmi.gestor.serviceName` (`ServicioHpc`).

## 6. Compilar, probar y desplegar

```bash
mvn clean package      # common, gestor-cluster, job-runner, job-api + pruebas
```

Pruebas: `TrabajoHpcTest`, `TransicionesTrabajoTest` (common);
`GestorTrabajosTest` (flujo completo con Storage y job-runner en memoria:
desenlaces, timeout, cancelación, reasignación por nodo caído, aislamiento entre
usuarios, persistencia); `EjecutorMpiImplTest` (job-runner con el mpirun
simulado: N procesos, dataset, tiempo máximo, cancelación, saneo de nombres);
`TrabajoControllerTest` y `HttpToRmiIntegrationTest` (HTTP → RMI real).

- **Clúster (VirtualBox o laboratorio):** `despliegue/cluster-virtualbox/6-desplegar-gestor.sh`
  instala los tres servicios en hpc-master y prueba `ejemplos/pi.c` en todos los nodos.
- **Una VM Ubuntu con OpenMPI real:** `despliegue/cluster-virtualbox/ejecutor-vm-ubuntu.sh`
  y en Windows `7-iniciar-servicios-windows.ps1 -HpcLocal -EjecutorHpc 127.0.0.1:2299`.
- **Solo el PC (desarrollo de las interfaces):** `7-iniciar-servicios-windows.ps1 -HpcLocal`
  arranca un job-runner con `MpirunSimulado` (N copias del programa con
  `OMPI_COMM_WORLD_RANK/SIZE`, sin comunicación MPI; solo programas `.py`).

Ejemplos en `job-runner/ejemplos/`: `pi.c` (MPI_Reduce), `estadisticas.c` +
`numeros.csv` (dataset), `pi_mpi.py` (mpi4py).

## 7. Errores frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| Los trabajos se quedan EN_COLA y `/cluster/estado` dice `ejecutorConectado: false` | job-runner caído o puertos mal apuntados | `EJECUTOR_HOST/PUERTO` del gestor = Registry de job-runner; `-Djava.rmi.server.hostname` de job-runner alcanzable desde el gestor |
| HPC-001 con un archivo que sí existe | La ruta no es relativa al Home, o es un archivo compartido por otro | Usar `/Carpeta/archivo.c` o el id de Storage |
| FALLIDO con HPC-004 | No compiló | Ver `compilacion.txt` en el resultado o `GET /jobs/{id}/logs` |
| `mpirun` falla en los workers con "No such file" | `DIR_TRABAJOS` no está en el NFS compartido | Debe estar bajo `/srv/home` en todos los nodos |
| `mpirun` se cuelga entre VMs | OpenMPI usa la interfaz NAT | `MPIRUN_OPCIONES=--mca btl_tcp_if_include <red del clúster>` |
| 403 en todo | Perfil sin `hpc` (modo soap) | Es lo esperado; darle el servicio en `ou=services` |
| `job-api.jar` de ~17 KB | Compilado con job-api corriendo (Windows) | Detenerlo y recompilar |

## 8. Sobre `config/seguridad-rmi.policy`

Documentado pero no activo: el `SecurityManager` está deprecado (JEP 411) y no
hay carga dinámica de clases (todo el contrato vive en `common`). La protección
de 2099/2100 se hace con el cortafuegos de cada VM.
