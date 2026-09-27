# rmi-system

Sistema distribuido académico para gestionar trabajos en un clúster, usando
**Java RMI** como mecanismo de comunicación entre el servidor de gestión
(`gestor-cluster`) y la fachada HTTP (`job-api`).

## 1. Requisitos

- Debian 12 (o cualquier Linux con Bash).
- OpenJDK 17.
- Apache Maven 3.8+.

Instalación de requisitos en Debian 12:

```bash
sudo apt update
sudo apt install -y openjdk-17-jdk maven
java -version
mvn -version
```

## 2. Instalación

```bash
git clone <repositorio>   # o descomprime el zip entregado
cd rmi-system
./scripts/build.sh
```

## 3. Estructura del proyecto

```text
rmi-system/
├── pom.xml                       # POM raíz (agregador multi-módulo)
├── common/                       # Contrato RMI compartido
│   └── src/main/java/com/cluster/common/
│       ├── Job.java
│       ├── JobStatus.java
│       ├── JobStatusTransition.java
│       ├── JobService.java
│       ├── JobNoEncontradoException.java
│       └── EstadoInvalidoException.java
├── gestor-cluster/               # Servidor RMI
│   └── src/main/java/com/cluster/gestor/
│       ├── JobServiceImpl.java
│       └── Main.java
├── job-api/                      # Fachada HTTP (cliente RMI, Spring Boot)
│   └── src/main/java/com/cluster/api/
│       ├── JobApiApplication.java
│       ├── controller/JobController.java
│       ├── service/JobFacadeService.java
│       ├── rmi/RmiClient.java
│       ├── dto/*
│       └── exception/*
├── config/
│   └── seguridad-rmi.policy
└── scripts/
    ├── build.sh
    ├── start-gestor.sh
    └── start-api.sh
```

**Cambio justificado respecto al árbol original:** no existe
`scripts/start-registry.sh`. El RMI Registry se levanta embebido dentro del
propio proceso de `gestor-cluster` (`LocateRegistry.createRegistry(2099)` en
`Main.java`), por lo que no hay un proceso `rmiregistry` independiente que
arrancar. Ver sección 5.

## 4. Arquitectura

```text
Cliente HTTP → job-api (Spring Boot, :8082)
                  │  Controller → Service → RmiClient
                  ▼
         RMI Registry (:2099)  ──lookup("JobService")──▶ stub
                  │
                  ▼
   JobService exportado en el puerto fijo :2100 (gestor-cluster)
                  │
                  ▼
   JobServiceImpl: ConcurrentHashMap + PriorityBlockingQueue + ExecutorService
```

`common` es el módulo del que dependen tanto `gestor-cluster` (servidor) como
`job-api` (cliente): contiene la interfaz remota, el modelo `Job` y las
excepciones de dominio. `common` no depende de ninguno de los otros dos
módulos.

## 5. Funcionamiento del RMI

- **Estrategia de Registry:** embebido, vía `LocateRegistry.createRegistry(2099)`
  dentro del proceso `gestor-cluster`, en lugar del proceso externo
  `rmiregistry`. Ventaja: un solo proceso que gestionar; si `gestor-cluster`
  cae, el registry desaparece con él, evitando registries huérfanos apuntando
  a un stub muerto.
- **Exportación del objeto remoto:** explícita y en puerto fijo, vía
  `UnicastRemoteObject.exportObject(servicio, 2100)`. Nunca se usa el
  puerto dinámico (`exportObject(obj, 0)`).
- **Publicación:** `registry.rebind("JobService", stub)`.
- **Resolución del lado cliente:** `job-api` hace
  `LocateRegistry.getRegistry(host, 2099).lookup("JobService")` en cada
  invocación (no cachea el stub de forma permanente), para no quedar
  apuntando a una instancia de `gestor-cluster` ya reiniciada.

## 6. Puertos

| Puerto | Proceso | Propósito |
|---|---|---|
| `2099` | `gestor-cluster` (Registry embebido) | Descubrimiento: resuelve el nombre `"JobService"` a un stub. No ejecuta lógica de negocio. |
| `2100` | `gestor-cluster` (objeto remoto exportado) | Todas las invocaciones reales de método (`submitJob`, `getJob`, etc.) pasan por aquí. |
| `8082` | `job-api` | HTTP REST hacia el nodo web / cliente externo. |

## 7. Cómo compilar

```bash
./scripts/build.sh
# equivalente a: mvn clean package
```

Genera:
- `gestor-cluster/target/gestor-cluster.jar` (ejecutable, con `common` embebido)
- `job-api/target/job-api.jar` (Spring Boot ejecutable)

## 8. Cómo iniciar

En una terminal:

```bash
./scripts/start-gestor.sh
```

Salida esperada:

```text
=== gestor-cluster: iniciando servidor RMI ===
[gestor-cluster] RMI Registry creado en el puerto 2099
[gestor-cluster] Objeto remoto JobService exportado en el puerto 2100
[gestor-cluster] Servicio registrado en el Registry como 'JobService'
[gestor-cluster] Listo. Escuchando en Registry:2099 / Objeto remoto:2100
```

En otra terminal:

```bash
./scripts/start-api.sh
```

## 9. Cómo probar

Ejecutar toda la batería de pruebas (unitarias + integración HTTP→RMI real):

```bash
mvn test
```

Probar manualmente con `curl` (con ambos procesos corriendo).

**Todos los endpoints exigen `Authorization: Bearer <token>`.** En modo de
desarrollo (`AUTH_MODE=simulado`, el valor por omisión) vale cualquier token con
la forma `mock-token-<uid>-...`; el `<uid>` es el usuario al que se le atribuyen
los trabajos. En producción hay que arrancar `gestor-cluster` con
`AUTH_MODE=soap` y usar un token real emitido por `node-soap`.

```bash
TOKEN="mock-token-jperez-demo"

# Crear un trabajo
curl -X POST http://localhost:8082/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"demo","comando":"echo hola-cluster","prioridad":5}'
# => {"id":"3f1c..."}

# Consultar estado
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/jobs/<ID>/estado

# Consultar el trabajo completo
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/jobs/<ID>

# Listar los trabajos DEL USUARIO del token (ya no los de todos)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/jobs

# Cancelar (solo si el trabajo es de ese usuario)
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8082/jobs/<ID>

# Sin token: 401
curl -i http://localhost:8082/jobs
```

## 10. Endpoints REST

| Método | Ruta | Corresponde a (JobService) | Éxito | Errores |
|---|---|---|---|---|
| `POST` | `/jobs` | `submitJob` | `201` | `400` |
| `GET` | `/jobs/{id}` | `getJob` | `200` | `404` |
| `GET` | `/jobs/{id}/estado` | `getJobStatus` | `200` | `404` |
| `GET` | `/jobs` | `listJobs` | `200` | — |
| `DELETE` | `/jobs/{id}` | `cancelJob` | `200` | `404`, `409` |

Todos los endpoints pueden además devolver `503` (gestor-cluster no
disponible) o `500` (error interno inesperado).

## 11. Flujo completo de una solicitud

1. El cliente hace `POST /jobs` con `{nombre, comando, prioridad}`.
2. `JobController` valida el cuerpo (`@Valid`) y delega en `JobFacadeService`.
3. `JobFacadeService` pide el stub a `RmiClient.obtenerServicio()`.
4. `RmiClient` hace `LocateRegistry.getRegistry("localhost", 2099).lookup("JobService")`.
5. Con el stub obtenido, se invoca `stub.submitJob(nombre, comando, prioridad)`;
   esta llamada abre/usa una conexión hacia el puerto **2100**.
6. `JobServiceImpl.submitJob` valida, crea el `Job` (estado `QUEUED`), lo
   guarda en el `ConcurrentHashMap` y lo encola en la `PriorityBlockingQueue`.
7. Un worker del `ExecutorService` lo toma, lo marca `RUNNING`, ejecuta el
   comando con `ProcessBuilder`, y al terminar lo marca `COMPLETED`/`FAILED`.
8. El `String id` retorna serializado hasta `job-api`, que responde `201` con
   `{"id": "..."}`.
9. El cliente puede luego consultar `GET /jobs/{id}` para ver el resultado.

## 12. Errores frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `job-api` responde `503` en todo | `gestor-cluster` no está corriendo | Ejecuta `./scripts/start-gestor.sh` primero |
| `java.rmi.ConnectException` al iniciar `job-api` | Puerto 2099 ocupado por otro proceso | `sudo ss -ltnp | grep 2099` y libera el puerto |
| `BindException: Address already in use` en `gestor-cluster` | Ya hay una instancia corriendo | Detén la instancia previa (`Ctrl+C` o `kill`) |
| `404` inesperado al consultar un trabajo recién creado | Typo en el `id` copiado del `POST` | Verifica el campo `id` de la respuesta de creación |
| `409` al cancelar | El trabajo ya terminó (`COMPLETED`/`FAILED`/`CANCELLED`) | Es el comportamiento esperado: no se puede cancelar un trabajo ya finalizado |

## 13. Solución de problemas

```bash
# Ver qué proceso ocupa el puerto 2099 o 2100
sudo ss -ltnp | grep -E '2099|2100'

# Detener un gestor-cluster colgado
pkill -f gestor-cluster.jar

# Ejecutar solo las pruebas de un módulo
mvn -pl gestor-cluster test
mvn -pl job-api test
```

## 14. Sobre `config/seguridad-rmi.policy`

Se entrega documentado pero **no se activa por defecto**. El `SecurityManager`
de Java (mecanismo que consume este archivo) está deprecado para su
eliminación desde Java 17 (JEP 411) y ya fue eliminado en versiones
posteriores del JDK. Además, en este proyecto no hay carga dinámica de
clases vía `codebase` (todas las clases del contrato viven en el módulo
`common`, compartido y compilado una sola vez), por lo que el riesgo que
el `.policy` mitigaba clásicamente no aplica aquí. La protección real de
los puertos 2099/2100 debe hacerse a nivel de firewall en Debian
(`nftables`/`iptables`). El archivo incluye, comentados, los comandos exactos
por si el enunciado académico exige activarlo como ejercicio didáctico.
