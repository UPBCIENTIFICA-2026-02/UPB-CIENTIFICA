# node-monitoreo — Módulo de monitoreo (Prometheus + Grafana)

> **Requisito.** Módulo de monitoreo integral del servicio HPC y de la
> infraestructura: estadísticas en tiempo real (CPU, memoria, almacenamiento),
> carga de trabajos, tiempos de ejecución y disponibilidad de servicios;
> accesible vía web, con reportes históricos, alertas configurables y
> visualización de métricas clave.

| Lo que pide | Cómo se cumple |
|---|---|
| CPU, memoria, almacenamiento en tiempo real | `node_exporter` (VMs, :9100) / `windows_exporter` (PC, :9182); reglas `nodo:*_uso:porcentaje`; tablero, actualización cada 10 s |
| Carga de trabajos HPC | `gestor-cluster` expone `/metrics` en :9102: trabajos por estado, cola, enviados, terminados |
| Tiempos de ejecución | Histogramas `hpc_trabajo_duracion_segundos` y `hpc_trabajo_espera_segundos` (media, p50, p95) |
| Disponibilidad de servicios | `blackbox_exporter`: HTTP a `/health` de cada servicio y TCP a RMI, gRPC (File Sync), LDAPS, NFS y PostgreSQL |
| Accesible vía web | Grafana, también desde el portal en `/monitoreo/` (node-web lo reenvía; el enlace "Monitoreo" del front) |
| Reportes históricos | Prometheus guarda 30 días; el selector de tiempo de Grafana y el panel "Disponibilidad en el periodo elegido" |
| Alertas configurables | `prometheus/reglas/alertas.yml` (10 alertas, umbral y duración editables, recarga sin reiniciar); en Grafana > Alerting se ven y se pueden crear más |
| Métricas clave | Tablero "UPB-CIENTÍFICA — Estado del sistema" (25 paneles) |

Además, cada servicio (node-web, Storage, Media, Shared File) expone `/metrics`
con peticiones, errores 5xx y latencia; Storage también la ocupación por usuario
frente a su cuota.

## Estructura

```
prometheus/prometheus.yml         producción (nombres de las VMs del diagrama)
prometheus/prometheus-local.yml   PC de desarrollo
prometheus/reglas/registro.yml    CPU/memoria/disco con el mismo nombre en Windows y Linux
prometheus/reglas/alertas.yml     alertas configurables
blackbox/blackbox.yml             sondas de disponibilidad
grafana/provisioning/             fuente de datos y proveedor de tableros
grafana/tableros/upbc-estado.json el tablero
iniciar-monitoreo-windows.ps1     arranca todo en el PC (lo llama el script 7 con -Monitoreo)
instalar-node-monitoreo.sh        instala la VM node-monitoreo (Debian 12)
instalar-exportador.sh            node_exporter en cada VM monitoreada
```

## En el PC de desarrollo

Binarios en `%USERPROFILE%\sdk\monitoreo` (Prometheus 3.15, blackbox_exporter
0.29, windows_exporter 0.31, Grafana 13.2). Luego:

```powershell
.\node-monitoreo\iniciar-monitoreo-windows.ps1
```

Grafana: http://localhost:8080/monitoreo/ (por el portal) o http://localhost:3000/monitoreo/.
Primer acceso `admin` / `admin` (pide cambiarla). Prometheus: http://localhost:9095
(`/alerts`, `/targets`). Prometheus usa el 9095 porque el 9090 es de File Sync.

## En producción

```bash
sudo ./node-monitoreo/instalar-node-monitoreo.sh          # en la VM node-monitoreo
sudo ./node-monitoreo/instalar-exportador.sh <ip-monitoreo>   # en cada VM
```

`/metrics` de los servicios y el 9100 no llevan autenticación: el cortafuegos de
cada VM solo debe dejarlos leer a node-monitoreo (análisis de vulnerabilidades,
V-13).

## Configurar una alerta

Editar el umbral (número al final de `expr`) o el tiempo (`for`) en
`prometheus/reglas/alertas.yml`, comprobar y recargar:

```bash
promtool check rules prometheus/reglas/alertas.yml
curl -X POST http://localhost:9095/-/reload     # 9090 en node-monitoreo
```

## Verificado

En el PC: 15 objetivos `up`; las 27 consultas del tablero devuelven datos y las
16 reglas se evalúan sin errores; con 5 trabajos HPC de prueba (uno fallido) se
miden duración y espera; al detener Shared File la alerta `ServicioCaido` se
dispara en ~1 min y se apaga al volver; el tablero se renderiza sin errores,
también a través del portal.
