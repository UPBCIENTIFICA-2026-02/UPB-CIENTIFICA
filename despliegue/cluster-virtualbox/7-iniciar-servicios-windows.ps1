<#
.SYNOPSIS
  Paso 7 - Arranca en Windows los servicios que usan la app movil y el portal.

.DESCRIPTION
  Abre una ventana por servicio, cada una con sus variables de entorno ya
  puestas:

      auth-local       8081   Authentication (SOAP) de pruebas
      node-repository  8084   Distributed Storage
      node-media       8083   Photo Album + Streaming
      node-shared-file 8085   Shared File (compartir archivos y carpetas)
      node-sync        9090   File Sync (gRPC; guarda a traves de Storage)
      node-web         8080   Portal web (SPA)

  y deja apuntado el portal al job-api del cluster (hpc-master, 192.168.56.10:8082).

  Con -HpcLocal arranca tambien aqui el gestor RMI y job-api:

      gestor-cluster   2099   Gestor de trabajos (RMI)
      job-api          8082   Fachada REST del gestor (la usan la app y el portal)

  Sirve para probar la pestana HPC sin las VMs. Los trabajos se ejecutan en
  este PC con Git Bash, no en el cluster MPI.

  POR QUE EN WINDOWS Y NO EN LAS VMs: la app movil, en modo desarrollo, busca
  Storage, Media y Auth en UNA sola direccion (la IP Wi-Fi del PC, ver
  Configuracion.kt). La red host-only de las VMs no es alcanzable desde el
  celular, asi que estos servicios tienen que estar en el Windows. PostgreSQL ya
  esta instalado aqui.

.PARAMETER ModoAuth
  simulado (por defecto): los servicios aceptan cualquier token mock-token-<uid>.
  soap: los servicios validan cada token preguntando a auth-local por SOAP. Es
        mas realista: ejercita el ValidadorSoap de cada servicio y los grupos
        del usuario cuentan para los permisos Unix de Storage.

.PARAMETER HpcLocal
  Arranca gestor-cluster y job-api en este PC (necesita Java 17+ y los .jar
  compilados: mvn package en RMIUPBCientifica).

.EXAMPLE
  .\7-iniciar-servicios-windows.ps1
  .\7-iniciar-servicios-windows.ps1 -ModoAuth soap
  .\7-iniciar-servicios-windows.ps1 -HpcLocal
#>
param(
    [ValidateSet('simulado', 'soap')] [string] $ModoAuth = 'simulado',
    [string] $UrlTrabajos = 'http://192.168.56.10:8082',
    [switch] $HpcLocal
)

$ErrorActionPreference = 'Stop'

$raiz    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$urlAuth = 'http://127.0.0.1:8081/soap/user.php'
$nsAuth  = 'http://192.168.1.195/soap'

function Paso([string] $t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function PuertoOcupado([int] $p) {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# Interfaz web: si el repositorio FrontWebUPBCientifica esta clonado al lado
# del monorepo, node-web la sirve directamente desde ahi (los cambios del front
# se ven al recargar el navegador). Si no, usa la copia de node-web\public, que
# se actualiza con "npm run interfaz".
$dirFront = Join-Path (Split-Path $raiz -Parent) 'FrontWebUPBCientifica'
if (Test-Path (Join-Path $dirFront 'index.html')) {
    $dirInterfaz = $dirFront
} else {
    $dirInterfaz = Join-Path $raiz 'node-web\public'
}

if ($HpcLocal) { $UrlTrabajos = 'http://127.0.0.1:8082' }

# Go para node-sync: el del PATH o el portable de %USERPROFILE%\sdk\go.
$go = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $go) { $go = Join-Path $env:USERPROFILE 'sdk\go\bin\go.exe' }

# FFmpeg para node-media (miniaturas y duracion de videos): el del PATH o el
# portable de %USERPROFILE%\sdk\ffmpeg. Sin el, node-media funciona igual pero
# sin miniaturas ni duracion.
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) { $ffmpeg = Join-Path $env:USERPROFILE 'sdk\ffmpeg\bin\ffmpeg.exe' }
$ffprobe = Join-Path (Split-Path $ffmpeg -Parent) 'ffprobe.exe'

$servicios = @(
    @{ Nombre = 'auth-local';      Puerto = 8081; Dir = $raiz;
       Cmd = 'node herramientas\auth-local.js'; Env = @{} },
    @{ Nombre = 'node-repository'; Puerto = 8084; Dir = (Join-Path $raiz 'node-repository');
       Cmd = 'npm start';
       Env = @{ MODO_AUTENTICACION = $ModoAuth; URL_AUTH_SOAP = $urlAuth; NAMESPACE_AUTH = $nsAuth } },
    @{ Nombre = 'node-media';      Puerto = 8083; Dir = (Join-Path $raiz 'node-media');
       Cmd = 'npm start';
       # El .env de node-media apunta a "node-repository:8084", el nombre de la
       # VM de produccion, que en este PC no resuelve.
       # URL_COMPARTIDOS: lo compartido con el usuario sale en su album y catalogo.
       Env = @{ MODO_AUTENTICACION = $ModoAuth; URL_AUTH_SOAP = $urlAuth; NAMESPACE_AUTH = $nsAuth;
                URL_STORAGE = 'http://127.0.0.1:8084'; URL_COMPARTIDOS = 'http://127.0.0.1:8085';
                FFMPEG_BIN = $ffmpeg; FFPROBE_BIN = $ffprobe } },
    # Shared File: en produccion va en la VM node-repository (shared-file-svc).
    # MODO_DIRECTORIO=soap: comprueba que el usuario destinatario existe
    # preguntando a auth-local (obtenerUsuario), aunque los tokens se validen
    # en modo simulado. Asi un nombre mal escrito da SHR-003 y no se comparte.
    @{ Nombre = 'node-shared-file'; Puerto = 8085; Dir = (Join-Path $raiz 'node-shared-file');
       Cmd = 'npm start';
       Env = @{ MODO_AUTENTICACION = $ModoAuth; URL_AUTH_SOAP = $urlAuth; NAMESPACE_AUTH = $nsAuth;
                MODO_DIRECTORIO = 'soap'; URL_STORAGE = 'http://127.0.0.1:8084' } },
    # File Sync (node-sync): "go run" y no el binario compilado porque el
    # Control inteligente de aplicaciones de Windows bloquea el syncd.exe recien
    # compilado (no esta firmado). SYNC_ALMACEN=storage: guarda por la API de
    # Storage con el token del usuario (cuota, permisos y versiones).
    @{ Nombre = 'node-sync';       Puerto = 9090; Dir = (Join-Path $raiz 'node-sync');
       Cmd = "& '$go' run ./cmd/syncd";
       Env = @{ SYNC_ADDR = ':9090'; SYNC_ALMACEN = 'storage'; SYNC_STORAGE_URL = 'http://127.0.0.1:8084/storage';
                SYNC_AUTH_MODE = $ModoAuth; SYNC_AUTH_URL = $urlAuth; SYNC_AUTH_NS = $nsAuth } },
    @{ Nombre = 'node-web';        Puerto = 8080; Dir = (Join-Path $raiz 'node-web');
       Cmd = 'npm start';
       # node-web no tiene .env: sin estas variables usa rutas-servicio.json,
       # cuyos nombres (node-soap, node-repository...) tampoco resuelven aqui.
       # BIND=0.0.0.0 permite abrir el portal tambien desde el celular.
       Env = @{ PORT = '8080'; BIND = '0.0.0.0'; DIR_INTERFAZ = $dirInterfaz;
                URL_IDENTIDAD = 'http://127.0.0.1:8081';
                URL_ARCHIVOS  = 'http://127.0.0.1:8084';
                URL_COMPARTIDOS = 'http://127.0.0.1:8085';
                URL_MEDIOS    = 'http://127.0.0.1:8083';
                URL_TRABAJOS  = $UrlTrabajos;
                URL_MONITOREO = 'http://127.0.0.1:3000' } }
)

if ($HpcLocal) {
    $dirRmi  = Join-Path $raiz 'RMIUPBCientifica'
    foreach ($jar in 'gestor-cluster\target\gestor-cluster.jar', 'job-api\target\job-api.jar') {
        if (-not (Test-Path (Join-Path $dirRmi $jar))) {
            throw "Falta RMIUPBCientifica\$jar. Compila antes: mvn -f RMIUPBCientifica\pom.xml package -DskipTests"
        }
    }
    # En Windows "bash" es C:\Windows\System32\bash.exe (WSL); sin una distro
    # Linux los trabajos fallan con "execvpe(/bin/bash) failed". Se usa Git Bash.
    $bashGit = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
    if (-not (Test-Path $bashGit)) { throw "No encuentro Git Bash en $bashGit (lo necesita el gestor para ejecutar trabajos)." }
    $servicios += @(
        # El -D va entre comillas: PowerShell parte "-Djava.rmi..." en el punto.
        @{ Nombre = 'gestor-cluster'; Puerto = 2099; Dir = $dirRmi;
           Cmd = "java '-Djava.rmi.server.hostname=127.0.0.1' -jar gestor-cluster\target\gestor-cluster.jar";
           Env = @{ AUTH_MODE = $ModoAuth; AUTH_URL = $urlAuth; AUTH_NS = $nsAuth; SHELL_TRABAJOS = $bashGit } },
        @{ Nombre = 'job-api';        Puerto = 8082; Dir = $dirRmi;
           Cmd = 'java -jar job-api\target\job-api.jar'; Env = @{} }
    )
}

# ---------------------------------------------------------- comprobaciones
Paso 'Comprobaciones previas'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'No encuentro Node.js en el PATH.' }
if (-not (Test-Path $ffmpeg)) { Write-Warning "No encuentro FFmpeg ($ffmpeg): node-media no generara miniaturas ni duracion." }
if (-not (Test-Path $go)) { throw "No encuentro Go (node-sync). Instala Go 1.22 o descomprimelo en $env:USERPROFILE\sdk\go." }
Write-Host "Node $(node --version)   |   autenticacion: $ModoAuth"
Write-Host "Interfaz web servida desde: $dirInterfaz"

$ocupados = @($servicios | Where-Object { PuertoOcupado $_.Puerto })
if ($ocupados.Count -gt 0) {
    foreach ($s in $ocupados) {
        $pid_ = (Get-NetTCPConnection -LocalPort $s.Puerto -State Listen | Select-Object -First 1).OwningProcess
        $proc = (Get-Process -Id $pid_ -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  puerto {0} ({1}) ocupado por PID {2} ({3})" -f $s.Puerto, $s.Nombre, $pid_, $proc) -ForegroundColor Red
    }
    throw @'
Hay puertos ocupados. Lo habitual: el mock-auth-server/server.js de la app (8080),
nodos-falsos.js (8081-8084) o una ejecucion anterior de este script.
Cierra esas ventanas y vuelve a lanzar.
'@
}

$pg = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pg) {
    Write-Warning 'No veo el servicio de PostgreSQL. Storage y Media no arrancaran sin el.'
} elseif ($pg.Status -ne 'Running') {
    throw "PostgreSQL ($($pg.Name)) esta $($pg.Status). Arrancalo: Start-Service $($pg.Name)"
}

foreach ($s in $servicios | Where-Object { $_.Cmd -eq 'npm start' }) {
    if (-not (Test-Path (Join-Path $s.Dir 'node_modules'))) {
        Write-Host "  instalando dependencias de $($s.Nombre)..."
        Push-Location $s.Dir
        try { npm install --no-audit --no-fund | Out-Null } finally { Pop-Location }
    }
}

# ------------------------------------------------------------------ arrancar
Paso 'Abriendo una ventana por servicio'

foreach ($s in $servicios) {
    # Las variables se ponen DENTRO de cada ventana: dotenv no pisa las que ya
    # existen, asi que ganan sobre lo que diga el .env del servicio.
    $asignaciones = foreach ($k in $s.Env.Keys) { "`$env:$k='$($s.Env[$k])'" }
    $comando = @(
        "`$Host.UI.RawUI.WindowTitle = 'UPBC - $($s.Nombre) :$($s.Puerto)'"
        $asignaciones
        "Set-Location '$($s.Dir)'"
        $s.Cmd
    ) -join '; '
    Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $comando | Out-Null
    Write-Host "  $($s.Nombre)"
    # auth-local primero y con margen: Storage y Media lo consultan al validar.
    # El gestor tiene que estar en el Registry antes de que job-api lo busque.
    if ($s.Nombre -in 'auth-local', 'gestor-cluster') { Start-Sleep -Seconds 2 }
}

# ------------------------------------------------------------------ esperar
Paso 'Esperando a que respondan'

$limite = (Get-Date).AddSeconds(90)
foreach ($s in $servicios) {
    while (-not (PuertoOcupado $s.Puerto)) {
        if ((Get-Date) -gt $limite) { break }
        Start-Sleep -Milliseconds 500
    }
    if (PuertoOcupado $s.Puerto) {
        Write-Host ("  OK     {0,-16} :{1}" -f $s.Nombre, $s.Puerto) -ForegroundColor Green
    } else {
        Write-Host ("  FALLA  {0,-16} :{1}  -> mira su ventana" -f $s.Nombre, $s.Puerto) -ForegroundColor Red
    }
}

# Storage, Media y Shared File abren el puerto aunque la base de datos falle al arrancar?
# No: aplican el esquema ANTES de escuchar. Si no abrieron, casi siempre es la BD.
foreach ($s in $servicios | Where-Object { $_.Puerto -in 8083, 8084, 8085 }) {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($s.Puerto)/health" -TimeoutSec 5
        Write-Host ("  {0,-16} base de datos: {1}" -f $s.Nombre, $h.bd)
    } catch {
        Write-Host ("  {0,-16} sin /health: revisa que existan las bases (0-crear-bases.sql)" -f $s.Nombre) -ForegroundColor Yellow
    }
}

$cluster = $false
try {
    $hostTrabajos = ([Uri] $UrlTrabajos).Host
    $c = New-Object Net.Sockets.TcpClient
    $c.ConnectAsync($hostTrabajos, 8082).Wait(2000) | Out-Null
    $cluster = $c.Connected
    $c.Close()
} catch { }
if ($HpcLocal) {
    # Ya se comprobo arriba con el resto de puertos.
} elseif ($cluster) {
    Write-Host '  job-api del cluster (192.168.56.10:8082) alcanzable' -ForegroundColor Green
} else {
    Write-Host '  job-api del cluster NO responde: la pestana "Trabajos HPC" del portal fallara hasta que hpc-master este encendido (paso 6).' -ForegroundColor Yellow
}

# --------------------------------------------------------------- resumen
$ipWifi = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue |
           Select-Object -First 1).IPAddress
if (-not $ipWifi) { $ipWifi = '<IP-WiFi>' }

Write-Host @"

=================================================================
 Portal web (en este PC):     http://localhost:8080
 Portal web (desde el movil): http://${ipWifi}:8080
 auth-local (comprobacion):   http://${ipWifi}:8081

 App movil -> network/Configuracion.kt:
     entorno        = Entorno.DISPOSITIVO_FISICO
     IP_PC_EN_WIFI  = "$ipWifi"
     USAR_MOCK_AUTH = false     (asi usa auth-local en el 8081)

 HPC (job-api):               $(if ($HpcLocal) { "http://${ipWifi}:8082  (local)" } else { $UrlTrabajos })
 File Sync (gRPC):            ${ipWifi}:9090  (movil y escritorio)
     Si el celular no conecta: permite el puerto 9090 en el Firewall de Windows.

 Usuarios:  user1 / 1234    investigador / test    estudiante / test
=================================================================
"@
