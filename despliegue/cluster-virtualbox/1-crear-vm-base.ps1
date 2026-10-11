<#
.SYNOPSIS
  Paso 1 - Crea la VM plantilla "hpc-base" e instala Debian 12 sin intervencion.

.DESCRIPTION
  La plantilla se instala UNA vez, se prepara (paso 2) y luego se clona tres
  veces (paso 3) para obtener hpc-master, hpc-worker1 y hpc-worker2. Asi las
  tres maquinas quedan identicas, y en particular `mpiuser` tiene el mismo UID
  en todas, que es la causa numero uno de fallos con NFS.

  La VM tiene dos tarjetas de red:
    1. NAT       -> salida a Internet para apt, con reenvio del puerto SSH a
                    127.0.0.1:2222 del Windows para poder entrar por SSH.
    2. Host-Only -> red privada 192.168.56.0/24 entre las VMs y el Windows.
                    Por ahi viajan MPI, NFS y las llamadas del portal web.

  POR QUE UN PRESEED PROPIO: la plantilla que trae VirtualBox para Debian no
  fija la seleccion de tareas, y el instalador elige la de por defecto, que
  incluye GNOME. Con 1 GB de RAM por worker un escritorio no cabe. Este script
  copia la plantilla instalada y solo le anade "standard + ssh-server".

.PARAMETER Iso
  Ruta a debian-12.x.x-amd64-netinst.iso.

.PARAMETER Manual
  Crea la VM con la ISO puesta pero NO instala: instalas tu desde la ventana
  de VirtualBox. Usalo si la instalacion automatica falla.

.EXAMPLE
  .\1-crear-vm-base.ps1 -Iso "$env:USERPROFILE\Downloads\debian-12.15.0-amd64-netinst.iso"
#>
param(
    [Parameter(Mandatory = $true)] [string] $Iso,
    [string] $Nombre    = 'hpc-base',
    [string] $Usuario   = 'upbc',
    [string] $Clave     = 'upbc2026',
    [int]    $MemoriaMB = 2048,
    [int]    $Cpus      = 2,
    [int]    $DiscoMB   = 12288,
    [switch] $Manual
)

$ErrorActionPreference = 'Stop'

$dirVBox   = 'C:\Program Files\Oracle\VirtualBox'
$vbm       = Join-Path $dirVBox 'VBoxManage.exe'
$hostOnly  = 'VirtualBox Host-Only Ethernet Adapter'
$puertoSsh = 2222

function Paso([string] $t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

<#
  Envoltorio de VBoxManage. Recibe TODOS los argumentos como cadenas ya
  armadas: en Windows PowerShell 5.1, pasar algo como --memory=$x a traves de
  una funcion puede llegar sin expandir la variable, porque el analizador lo
  trata como nombre de parametro. Con cadenas entre comillas no hay ambiguedad.
#>
function VBox {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $A)
    $salida = & $vbm @A 2>&1
    if ($LASTEXITCODE -ne 0) {
        $salida | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "VBoxManage $($A[0]) fallo (codigo $LASTEXITCODE)"
    }
    return $salida
}

# Escribe texto en UTF-8 SIN BOM. OpenSSH de Windows no tolera el BOM en
# ~/.ssh/config, y el instalador de Debian tampoco en el preseed.
function EscribirSinBom([string] $ruta, [string] $texto) {
    [IO.File]::WriteAllText($ruta, $texto, (New-Object Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------- comprobaciones
Paso 'Comprobaciones previas'

if (-not (Test-Path $vbm)) { throw "No encuentro VirtualBox en $dirVBox" }
if (-not (Test-Path $Iso)) { throw "No encuentro la ISO: $Iso" }
$Iso = (Resolve-Path $Iso).Path
if ((Split-Path $Iso -Leaf) -notmatch '^debian-12\.') {
    Write-Warning "La ISO no parece Debian 12. El proyecto exige Debian 12 / OpenMPI 4.1."
}

$vms = (& $vbm list vms) -join "`n"
if ($vms -match ('"' + [regex]::Escape($Nombre) + '"')) {
    throw "Ya existe una VM llamada '$Nombre'. Borrala desde VirtualBox o usa -Nombre otro."
}

$redes = (& $vbm list hostonlyifs) -join "`n"
if ($redes -notmatch [regex]::Escape($hostOnly) -or $redes -notmatch '192\.168\.56\.1') {
    throw "No existe la red Host-Only '$hostOnly' con IP 192.168.56.1. Creala en VirtualBox: Archivo > Herramientas > Administrador de red."
}

if (Get-NetTCPConnection -LocalPort $puertoSsh -State Listen -ErrorAction SilentlyContinue) {
    throw "El puerto $puertoSsh del Windows ya esta en uso (otra VM lo tiene reservado)."
}

Write-Host ("VirtualBox " + (& $vbm --version) + "  |  ISO: " + (Split-Path $Iso -Leaf))

# -------------------------------------------------------- llave SSH Windows
Paso 'Llave SSH de Windows (para entrar a las VMs sin contrasena)'

$dirSsh = Join-Path $env:USERPROFILE '.ssh'
$llave  = Join-Path $dirSsh 'id_ed25519'
if (-not (Test-Path "$llave.pub")) {
    New-Item -ItemType Directory -Force -Path $dirSsh | Out-Null
    # Por cmd.exe: es la unica forma de pasar una frase de paso VACIA (-N "")
    # que funcione igual en Windows PowerShell 5.1 y en PowerShell 7.
    cmd.exe /c ('ssh-keygen -q -t ed25519 -N "" -C "windows-upbc" -f "' + $llave + '"')
    if (-not (Test-Path "$llave.pub")) { throw "No se pudo crear la llave SSH en $llave" }
    Write-Host "Creada $llave.pub"
} else {
    Write-Host "Ya existe $llave.pub; se reutiliza."
}

# --------------------------------------- ~/.ssh/config para los 4 nombres
Paso 'Atajos SSH: ssh hpc-base | hpc-master | hpc-worker1 | hpc-worker2'

<#
  Cada VM se alcanza desde Windows por un puerto distinto de 127.0.0.1
  (reenvio NAT). Con este bloque basta escribir `ssh hpc-master` o
  `scp archivo hpc-master:`.

  StrictHostKeyChecking no + UserKnownHostsFile NUL: las tres VMs nacen de la
  misma plantilla y en el paso 4 regeneran su llave de host; sin esto SSH
  bloquearia la conexion con "REMOTE HOST IDENTIFICATION HAS CHANGED". Es
  aceptable SOLO porque son VMs locales en 127.0.0.1.
#>
$config = Join-Path $dirSsh 'config'
$inicio = '# >>> UPB-CIENTIFICA cluster local (generado por 1-crear-vm-base.ps1) >>>'
$fin    = '# <<< UPB-CIENTIFICA cluster local <<<'
$lineas = @(
    $inicio,
    'Host hpc-base hpc-master hpc-worker1 hpc-worker2',
    '    HostName 127.0.0.1',
    "    User $Usuario",
    '    IdentityFile ~/.ssh/id_ed25519',
    '    StrictHostKeyChecking no',
    '    UserKnownHostsFile NUL',
    '    LogLevel ERROR',
    'Host hpc-base',
    "    Port $puertoSsh",
    'Host hpc-master',
    '    Port 2210',
    'Host hpc-worker1',
    '    Port 2211',
    'Host hpc-worker2',
    '    Port 2212',
    $fin
)
$bloque = $lineas -join "`r`n"

$actual = ''
if (Test-Path $config) { $actual = [IO.File]::ReadAllText($config) }
if ($actual.Contains($inicio)) {
    $patron = [regex]::Escape($inicio) + '[\s\S]*?' + [regex]::Escape($fin)
    $actual = [regex]::Replace($actual, $patron, $bloque)
} elseif ($actual.Trim().Length -gt 0) {
    $actual = $actual.TrimEnd() + "`r`n`r`n" + $bloque + "`r`n"
} else {
    $actual = $bloque + "`r`n"
}
EscribirSinBom $config $actual
Write-Host "Bloque escrito en $config (entre las marcas UPB-CIENTIFICA)."

# --------------------------------------------------------------- crear la VM
Paso "Creando la VM '$Nombre'"

VBox 'createvm' '--name' $Nombre '--ostype' 'Debian_64' '--register' | Out-Null

VBox 'modifyvm' $Nombre `
    "--memory=$MemoriaMB" "--cpus=$Cpus" '--vram=16' '--graphicscontroller=vmsvga' `
    '--audio-enabled=off' '--usb-ehci=off' '--usb-xhci=off' '--usb-ohci=off' `
    '--rtc-use-utc=on' '--ioapic=on' `
    '--boot1=dvd' '--boot2=disk' '--boot3=none' '--boot4=none' `
    '--nic1=nat' '--nic-type1=82540EM' "--nat-pf1=ssh,tcp,127.0.0.1,$puertoSsh,,22" `
    '--nic2=hostonly' '--nic-type2=82540EM' "--host-only-adapter2=$hostOnly" | Out-Null

$cfg   = (VBox 'showvminfo' $Nombre '--machinereadable' | Select-String '^CfgFile=').Line
$dirVm = Split-Path ($cfg -replace '^CfgFile="(.*)"$', '$1')
$vdi   = Join-Path $dirVm "$Nombre.vdi"

VBox 'createmedium' 'disk' '--filename' $vdi '--size' "$DiscoMB" '--format' 'VDI' | Out-Null
VBox 'storagectl' $Nombre '--name' 'SATA' '--add' 'sata' '--controller' 'IntelAhci' '--portcount' '2' | Out-Null
VBox 'storageattach' $Nombre '--storagectl' 'SATA' '--port' '0' '--device' '0' '--type' 'hdd' `
    '--medium' $vdi '--nonrotational' 'on' '--discard' 'on' | Out-Null

Write-Host ("VM creada: $MemoriaMB MB, $Cpus CPU, disco dinamico de " + [math]::Round($DiscoMB / 1024) + " GB en $dirVm")

# --------------------------------------------------------------- modo manual
if ($Manual) {
    VBox 'storageattach' $Nombre '--storagectl' 'SATA' '--port' '1' '--device' '0' `
        '--type' 'dvddrive' '--medium' $Iso | Out-Null
    VBox 'startvm' $Nombre '--type' 'gui' | Out-Null
    Write-Host @"

Instalacion MANUAL. En la ventana de VirtualBox:
  - Elige "Install" (no "Graphical install").
  - Idioma y teclado: los que prefieras.
  - Red: elige la PRIMERA interfaz (enp0s3).   Hostname: $Nombre
  - Contrasena de root: dejala VACIA (asi el usuario queda con sudo).
  - Usuario: $Usuario    Contrasena: $Clave
  - Particionado: "Guiado - utilizar todo el disco", todo en una particion.
  - Seleccion de programas: DESMARCA "entorno de escritorio" y "GNOME";
    deja SOLO "servidor SSH" y "utilidades estandar del sistema".
  - GRUB: instalalo en /dev/sda.

Cuando reinicie y veas '$Nombre login:', sigue con el paso 2 de la guia.
"@ -ForegroundColor Yellow
    return
}

# ------------------------------------------------- preseed sin escritorio
Paso 'Preparando la instalacion automatica (sin entorno grafico)'

$plantilla = [IO.File]::ReadAllText((Join-Path $dirVBox 'UnattendedTemplates\debian_preseed.cfg'))
$ancla     = 'd-i pkgsel/install-language-support boolean false'
if (-not $plantilla.Contains($ancla)) {
    throw "La plantilla de VirtualBox cambio y no encuentro '$ancla'. Repite con -Manual."
}
$extra = @(
    $ancla,
    '',
    '# --- UPB-CIENTIFICA: servidor sin entorno grafico ---',
    'tasksel tasksel/first multiselect standard, ssh-server',
    'd-i pkgsel/include string openssh-server sudo curl ca-certificates',
    'd-i pkgsel/upgrade select safe-upgrade',
    'popularity-contest popularity-contest/participate boolean false'
) -join "`n"
# Saltos LF: un \r al final de linea se cuela en el valor y el instalador no
# reconoce la opcion.
$preseed = ($plantilla.Replace($ancla, $extra)) -replace "`r`n", "`n"
$rutaPreseed = Join-Path $env:TEMP 'upbc_debian_preseed.cfg'
EscribirSinBom $rutaPreseed $preseed

Paso 'Lanzando la instalacion desatendida (10 a 20 minutos)'

VBox 'unattended' 'install' $Nombre `
    "--iso=$Iso" "--user=$Usuario" "--user-password=$Clave" "--admin-password=$Clave" `
    '--full-user-name=Administrador UPBC' "--hostname=$Nombre.upbc.local" `
    '--locale=en_US' '--country=US' '--time-zone=America/Bogota' `
    '--no-install-additions' '--no-install-txs' `
    "--script-template=$rutaPreseed" '--start-vm=gui' | Out-Null

Write-Host 'Se abrio la ventana de la VM. No hace falta tocar nada en ella.'

<#
  Esperar a que responda SSH.

  Con el reenvio NAT, VirtualBox abre el puerto 2222 del Windows en cuanto
  arranca la VM, aunque dentro todavia no haya SSH; un simple "el puerto
  conecta" daria un falso positivo. Por eso se lee la cabecera: el servidor SSH
  real responde con una linea que empieza por "SSH-2.0".
#>
function SshListo {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.ReceiveTimeout = 3000
        $c.Connect('127.0.0.1', $puertoSsh)
        $buf = New-Object byte[] 64
        $n = $c.GetStream().Read($buf, 0, 64)
        $c.Close()
        return ([Text.Encoding]::ASCII.GetString($buf, 0, $n) -like 'SSH-2.0*')
    } catch { return $false }
}

$limite = (Get-Date).AddMinutes(45)
$t0 = Get-Date
while (-not (SshListo)) {
    if ((Get-Date) -gt $limite) {
        throw "Pasaron 45 minutos sin respuesta SSH. Mira la ventana de la VM; si quedo en una pregunta, repite con -Manual."
    }
    $min = [math]::Floor(((Get-Date) - $t0).TotalMinutes)
    Write-Host -NoNewline "`r  instalando... $min min (la VM reinicia sola al terminar)   "
    Start-Sleep -Seconds 20
}
Write-Host ''
Write-Host ''
Write-Host "Debian 12 instalado y SSH respondiendo en 127.0.0.1:$puertoSsh." -ForegroundColor Green
Write-Host "Usuario: $Usuario    Contrasena: $Clave"
Write-Host 'Siguiente: paso 2 de la guia (preparar la plantilla).'
