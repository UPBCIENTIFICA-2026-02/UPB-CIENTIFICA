<#
.SYNOPSIS
  Arranca el módulo de monitoreo en el PC de desarrollo (equivale a la VM node-monitoreo).

.DESCRIPTION
      windows_exporter   9182   CPU, memoria, disco y red de este PC (en las VMs: node_exporter 9100)
      blackbox_exporter  9115   Sondas de disponibilidad (HTTP, TCP) de todos los servicios
      Prometheus         9095   Recolecta métricas, guarda el histórico (30 días) y evalúa las alertas
                                (9095 y no 9090: el 9090 es de File Sync, reenviado a su VM)
      Grafana            3000   Interfaz web: tablero "UPB-CIENTÍFICA — Estado del sistema"

  Los binarios van en $Sdk (por defecto %USERPROFILE%\sdk\monitoreo): prometheus\,
  blackbox\, grafana\ y windows_exporter.exe. La configuración sale de esta carpeta
  del repositorio, así que un cambio en las reglas o el tablero se ve al reiniciar
  (las reglas también con: Invoke-RestMethod -Method Post http://127.0.0.1:9095/-/reload).

  Primer acceso a Grafana: admin / admin (pide cambiarla).
#>
param([string] $Sdk = (Join-Path $env:USERPROFILE 'sdk\monitoreo'))

$ErrorActionPreference = 'Stop'
trap { Write-Host "`nERROR: $_" -ForegroundColor Red; Read-Host 'Pulsa Enter para cerrar'; exit 1 }

$aqui  = $PSScriptRoot
$datos = Join-Path $Sdk 'datos'
New-Item -ItemType Directory -Force -Path "$datos\prometheus", "$datos\grafana" | Out-Null

function Ocupado([int] $p) { [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }
function Lanzar([string] $nombre, [int] $puerto, [string] $exe, [string[]] $argumentos, [hashtable] $entorno = @{}) {
    if (Ocupado $puerto) { Write-Host ("  {0,-18} :{1}  ya estaba arrancado" -f $nombre, $puerto); return }
    if (-not (Test-Path $exe)) { throw "No encuentro $exe (descárgalo en $Sdk; ver node-monitoreo\README.md)" }
    foreach ($k in $entorno.Keys) { Set-Item "env:$k" $entorno[$k] }
    Start-Process $exe -ArgumentList $argumentos -WindowStyle Hidden `
        -RedirectStandardError (Join-Path $datos "$nombre.log") -RedirectStandardOutput (Join-Path $datos "$nombre.out")
    Write-Host ("  {0,-18} :{1}" -f $nombre, $puerto)
}

Write-Host "`n==> Arrancando el monitoreo" -ForegroundColor Cyan
Lanzar 'windows_exporter' 9182 (Join-Path $Sdk 'windows_exporter.exe') @(
    '--collectors.enabled=cpu,memory,logical_disk,net,os,system', '--web.listen-address=:9182')
Lanzar 'blackbox' 9115 (Join-Path $Sdk 'blackbox\blackbox_exporter.exe') @(
    "--config.file=$aqui\blackbox\blackbox.yml", '--web.listen-address=127.0.0.1:9115')
Lanzar 'prometheus' 9095 (Join-Path $Sdk 'prometheus\prometheus.exe') @(
    "--config.file=$aqui\prometheus\prometheus-local.yml", "--storage.tsdb.path=$datos\prometheus",
    '--storage.tsdb.retention.time=30d', '--web.listen-address=127.0.0.1:9095', '--web.enable-lifecycle')
Lanzar 'grafana' 3000 (Join-Path $Sdk 'grafana\bin\grafana.exe') @('server', "--homepath=$Sdk\grafana") @{
    GF_SERVER_HTTP_PORT       = '3000'
    # Servido bajo /monitoreo/: el portal (node-web) lo reenvía en el mismo origen.
    GF_SERVER_ROOT_URL        = 'http://localhost:8080/monitoreo/'
    GF_SERVER_SERVE_FROM_SUB_PATH = 'true'
    GF_PATHS_DATA             = "$datos\grafana"
    GF_PATHS_LOGS             = "$datos\grafana\logs"
    GF_PATHS_PROVISIONING     = "$aqui\grafana\provisioning"
    GF_ANALYTICS_REPORTING_ENABLED = 'false'
    GF_ANALYTICS_CHECK_FOR_UPDATES = 'false'
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH = "$aqui\grafana\tableros\upbc-estado.json"
    PROMETHEUS_URL            = 'http://127.0.0.1:9095'
    UPBC_TABLEROS             = "$aqui\grafana\tableros"
}

$limite = (Get-Date).AddSeconds(60)
foreach ($p in 9182, 9115, 9095, 3000) { while (-not (Ocupado $p) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 500 } }
Write-Host @"

=================================================================
 Grafana (tablero):   http://localhost:3000      (admin / admin la primera vez)
 Prometheus:          http://localhost:9095      (alertas: /alerts, objetivos: /targets)
=================================================================
"@
