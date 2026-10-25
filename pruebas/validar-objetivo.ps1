<#
  Validación E2E del objetivo:
    "Validar el sistema mediante pruebas end-to-end para verificar la correcta
     ejecución distribuida de trabajos MPI, la integración funcional de los
     clientes (Web, Escritorio y Móvil), la precisión de la telemetría
     transversal y el cumplimiento de los esquemas de seguridad."

  Ejecuta, contra las VPS, un bloque por cada parte del objetivo y se detiene
  después de cada uno para tomar el pantallazo. Al final muestra la tabla de
  cumplimiento. Los resultados quedan en pruebas/resultados/ (JSON + JUnit).

    .\validar-objetivo.ps1                          # los 4 bloques
    .\validar-objetivo.ps1 -Bloques clientes,seguridad
    .\validar-objetivo.ps1 -SinPausa                # sin detenerse entre bloques

  Las claves de los usuarios de prueba NO están aquí: se leen de
  $env:UPBC_CLAVE_user1 / _investigador / _estudiante, o se piden al empezar.
#>
param(
    [string[]] $Bloques = @('mpi', 'clientes', 'telemetria', 'seguridad'),
    [string] $Ca = "$PSScriptRoot\..\..\FrontDesktopUPBCientifica\app\assets\upbc-ca.crt",
    [int] $HpcEspera = 300,
    [switch] $SinPausa
)
$ErrorActionPreference = 'Continue'
chcp 65001 > $null
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
$Host.UI.RawUI.WindowTitle = 'UPB-CIENTIFICA - Validacion end-to-end del objetivo'
Set-Location $PSScriptRoot
$Ca = (Resolve-Path $Ca).Path

foreach ($u in 'user1', 'investigador', 'estudiante') {
    if (-not (Get-Item "Env:UPBC_CLAVE_$u" -ErrorAction SilentlyContinue)) {
        $s = Read-Host "Clave del usuario de prueba $u" -AsSecureString
        Set-Item "Env:UPBC_CLAVE_$u" ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)))
    }
}

$definicion = [ordered]@{
    mpi        = @{ Titulo = 'Ejecucion DISTRIBUIDA de trabajos MPI'; Suites = @('11');
                    Que = 'Trabajo MPI en C enviado por la API: reparto en varias maquinas, comunicacion entre procesos (anillo), dataset compartido por NFS y resultado en el Home.' }
    clientes   = @{ Titulo = 'Integracion de los clientes Web, Escritorio y Movil'; Suites = @('12');
                    Que = 'Web: la SPA real en un navegador, solo por node-web. Escritorio: el codigo de la app contra las VPS (incluido File Sync gRPC/TLS). Movil: configuracion, CA, APK y cada ruta Retrofit.' }
    telemetria = @{ Titulo = 'Precision de la telemetria transversal'; Suites = @('13');
                    Que = 'Prometheus y Grafana contra la realidad: contadores exactos, bytes usados, memoria/CPU de cada VPS, estado del cluster y alertas.' }
    seguridad  = @{ Titulo = 'Cumplimiento de los esquemas de seguridad'; Suites = @('02', '09', '14');
                    Que = 'Autenticacion SOAP + LDAP y mapa de servicios, ataques a las APIs (tokens falsos, uid del cuerpo, inyeccion, enumeracion) y despliegue (TLS, puertos, ufw, respaldos GPG).' }
}

function Titulo($n, $total, $b) {
    Clear-Host
    Write-Host ''
    Write-Host ('=' * 96) -ForegroundColor Cyan
    Write-Host ("  VALIDACION E2E  [$n/$total]  " + $b.Titulo.ToUpper()) -ForegroundColor Cyan
    Write-Host ("  " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "   equipo: $env:COMPUTERNAME   entorno: VPS del CCA (pasd_nodo1..3) + cluster HPC") -ForegroundColor DarkCyan
    Write-Host ('=' * 96) -ForegroundColor Cyan
    Write-Host ("  " + $b.Que) -ForegroundColor Gray
}

$resumen = @()
$i = 0
foreach ($clave in $Bloques) {
    $b = $definicion[$clave]
    if (-not $b) { Write-Host "Bloque desconocido: $clave" -ForegroundColor Red; continue }
    $i++
    Titulo $i $Bloques.Count $b
    $antes = Get-Date
    node ejecutar.js @($b.Suites) --entorno vps --ca $Ca --hpc-espera $HpcEspera
    $json = Get-ChildItem resultados\e2e-vps-*.json | Where-Object LastWriteTime -ge $antes | Sort-Object LastWriteTime | Select-Object -Last 1
    $t = if ($json) { (Get-Content $json.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).total } else { $null }
    $resumen += [pscustomobject]@{ Bloque = $b.Titulo; OK = $t.OK; Fallas = $t.FALLA; Omitidas = $t.OMITIDA }
    if (-not $SinPausa) {
        Write-Host ''
        Write-Host '  >> Toma el pantallazo y presiona Enter para continuar...' -ForegroundColor Yellow
        [void](Read-Host)
    }
}

Clear-Host
Write-Host ''
Write-Host ('=' * 96) -ForegroundColor Cyan
Write-Host '  RESUMEN DE CUMPLIMIENTO DEL OBJETIVO (pruebas end-to-end contra el sistema desplegado)' -ForegroundColor Cyan
Write-Host ("  " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -ForegroundColor DarkCyan
Write-Host ('=' * 96) -ForegroundColor Cyan
Write-Host ''
Write-Host ('  {0,-56} {1,6} {2,8} {3,10}   {4}' -f 'Parte del objetivo', 'OK', 'Fallas', 'Omitidas', 'Estado')
Write-Host ('  ' + ('-' * 92))
$tot = @{ OK = 0; F = 0; O = 0 }
foreach ($r in $resumen) {
    $estado = if ($null -eq $r.OK) { 'sin datos' } elseif ($r.Fallas -eq 0 -and $r.Omitidas -eq 0) { 'CUMPLE' } elseif ($r.Fallas -eq 0) { 'CUMPLE (con omitidas)' } else { 'NO CUMPLE' }
    $color = switch -Wildcard ($estado) { 'CUMPLE' { 'Green' } 'CUMPLE*' { 'Yellow' } default { 'Red' } }
    Write-Host ('  {0,-56} {1,6} {2,8} {3,10}   ' -f $r.Bloque, $r.OK, $r.Fallas, $r.Omitidas) -NoNewline
    Write-Host $estado -ForegroundColor $color
    $tot.OK += [int]$r.OK; $tot.F += [int]$r.Fallas; $tot.O += [int]$r.Omitidas
}
Write-Host ('  ' + ('-' * 92))
Write-Host ('  {0,-56} {1,6} {2,8} {3,10}' -f 'TOTAL', $tot.OK, $tot.F, $tot.O)
Write-Host ''
Write-Host '  Detalle de cada prueba (JSON y JUnit XML) en pruebas\resultados\' -ForegroundColor Gray
Write-Host ''
