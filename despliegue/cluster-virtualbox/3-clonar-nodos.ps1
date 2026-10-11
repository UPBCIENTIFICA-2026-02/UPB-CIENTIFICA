<#
.SYNOPSIS
  Paso 3 - Clona la plantilla hpc-base en hpc-master, hpc-worker1 y hpc-worker2.

.DESCRIPTION
  Clonacion COMPLETA (discos independientes) con direcciones MAC nuevas, que es
  lo que VirtualBox hace por defecto. Cada clon recibe su propia memoria y su
  propio puerto SSH en el Windows:

      hpc-master    2048 MB   ssh hpc-master   (127.0.0.1:2210)
      hpc-worker1   1024 MB   ssh hpc-worker1  (127.0.0.1:2211)
      hpc-worker2   1024 MB   ssh hpc-worker2  (127.0.0.1:2212)

  El maestro lleva el doble porque, ademas de calcular, sirve el NFS y ejecuta
  gestor-cluster y job-api (dos JVM).

  Al terminar arranca las tres VMs sin ventana (headless).

.EXAMPLE
  .\3-clonar-nodos.ps1
#>
param(
    [string] $Base = 'hpc-base',
    [switch] $SinArrancar
)

$ErrorActionPreference = 'Stop'

$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'

$nodos = @(
    @{ Nombre = 'hpc-master';  MemoriaMB = 2048; Puerto = 2210 },
    @{ Nombre = 'hpc-worker1'; MemoriaMB = 1024; Puerto = 2211 },
    @{ Nombre = 'hpc-worker2'; MemoriaMB = 1024; Puerto = 2212 }
)

function Paso([string] $t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

# Ver la nota de 1-crear-vm-base.ps1: argumentos siempre como cadenas.
function VBox {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $A)
    $salida = & $vbm @A 2>&1
    if ($LASTEXITCODE -ne 0) {
        $salida | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "VBoxManage $($A[0]) fallo (codigo $LASTEXITCODE)"
    }
    return $salida
}

function EstadoDe([string] $vm) {
    $l = (& $vbm showvminfo $vm --machinereadable 2>$null | Select-String '^VMState=').Line
    return ($l -replace '^VMState="(.*)"$', '$1')
}

function ReglasNat([string] $vm) {
    return @(& $vbm showvminfo $vm --machinereadable 2>$null | Select-String '^Forwarding\(')
}

# ------------------------------------------------------------ comprobaciones
Paso 'Comprobaciones previas'

$vms = (& $vbm list vms) -join "`n"
if ($vms -notmatch ('"' + [regex]::Escape($Base) + '"')) {
    throw "No existe la plantilla '$Base'. Haz primero los pasos 1 y 2."
}

$estado = EstadoDe $Base
if ($estado -ne 'poweroff') {
    throw "La plantilla '$Base' esta '$estado'. Apagala primero desde dentro: sudo poweroff"
}

foreach ($n in $nodos) {
    if ($vms -match ('"' + [regex]::Escape($n.Nombre) + '"')) {
        throw "Ya existe una VM '$($n.Nombre)'. Borrala desde VirtualBox si quieres rehacer el clon."
    }
    if (Get-NetTCPConnection -LocalPort $n.Puerto -State Listen -ErrorAction SilentlyContinue) {
        throw "El puerto $($n.Puerto) del Windows esta ocupado; lo necesita $($n.Nombre)."
    }
}

# ------------------------------------------------------------------- clonar
foreach ($n in $nodos) {
    Paso "Clonando $Base -> $($n.Nombre)"

    VBox 'clonevm' $Base "--name=$($n.Nombre)" '--register' '--mode=machine' | Out-Null
    VBox 'modifyvm' $n.Nombre "--memory=$($n.MemoriaMB)" | Out-Null

    <#
      La plantilla trae la regla NAT "ssh" hacia el puerto 2222. Si los clones la
      conservaran, los tres pelearian por el mismo puerto del Windows. Se borra y
      se pone la propia de cada nodo.

      La sintaxis para borrar una regla cambio en VirtualBox 7 y su ayuda no es
      inequivoca, asi que se prueban las dos formas y se VERIFICA el resultado.
    #>
    & $vbm modifyvm $n.Nombre '--nat-pf1=delete=ssh' 2>$null | Out-Null
    if ((ReglasNat $n.Nombre).Count -gt 0) {
        & $vbm modifyvm $n.Nombre '--natpf1' 'delete' 'ssh' 2>$null | Out-Null
    }
    if ((ReglasNat $n.Nombre).Count -gt 0) {
        throw "No pude quitar la regla NAT heredada en $($n.Nombre). Quitala a mano: Configuracion > Red > Adaptador 1 > Reenvio de puertos."
    }

    VBox 'modifyvm' $n.Nombre "--nat-pf1=ssh,tcp,127.0.0.1,$($n.Puerto),,22" | Out-Null

    $info = (VBox 'showvminfo' $n.Nombre '--machinereadable') -join "`n"
    $mac1 = ([regex]::Match($info, 'macaddress1="([^"]+)"')).Groups[1].Value
    $mac2 = ([regex]::Match($info, 'macaddress2="([^"]+)"')).Groups[1].Value
    Write-Host ("  {0} MB  |  ssh {1}  (127.0.0.1:{2})  |  MAC {3} / {4}" -f `
        $n.MemoriaMB, $n.Nombre, $n.Puerto, $mac1, $mac2)
}

# Las MAC tienen que ser distintas entre clones. VirtualBox las regenera por
# defecto, pero si alguien cambio esa opcion, el host-only se volveria loco.
$todas = foreach ($n in $nodos) {
    $info = (& $vbm showvminfo $n.Nombre --machinereadable) -join "`n"
    ([regex]::Match($info, 'macaddress2="([^"]+)"')).Groups[1].Value
}
if (($todas | Select-Object -Unique).Count -ne $nodos.Count) {
    throw "Hay MAC repetidas entre los clones de la tarjeta host-only. Rehaz el clon."
}

if ($SinArrancar) {
    Write-Host "`nClones creados y SIN arrancar (-SinArrancar)."
    return
}

# ----------------------------------------------------------------- arrancar
Paso 'Arrancando los tres nodos sin ventana'

foreach ($n in $nodos) {
    VBox 'startvm' $n.Nombre '--type' 'headless' | Out-Null
    Write-Host "  $($n.Nombre) arrancando"
}

# Mismo truco que en el paso 1: esperar la cabecera SSH real, no solo el puerto.
function SshListo([int] $puerto) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.ReceiveTimeout = 3000
        $c.Connect('127.0.0.1', $puerto)
        $buf = New-Object byte[] 64
        $k = $c.GetStream().Read($buf, 0, 64)
        $c.Close()
        return ([Text.Encoding]::ASCII.GetString($buf, 0, $k) -like 'SSH-2.0*')
    } catch { return $false }
}

$limite = (Get-Date).AddMinutes(5)
foreach ($n in $nodos) {
    while (-not (SshListo $n.Puerto)) {
        if ((Get-Date) -gt $limite) { throw "$($n.Nombre) no responde por SSH tras 5 minutos." }
        Start-Sleep -Seconds 5
    }
    Write-Host "  $($n.Nombre) listo  ->  ssh $($n.Nombre)" -ForegroundColor Green
}

Write-Host @"

Los tres nodos estan encendidos. Todavia son copias identicas de la plantilla
(mismo nombre, sin IP en la red del cluster). Siguiente: paso 4, en este orden
-- primero el maestro, porque los workers montan su NFS:

    scp 4-configurar-nodo.sh hpc-master:  ; ssh hpc-master  "sudo bash 4-configurar-nodo.sh hpc-master"
    scp 4-configurar-nodo.sh hpc-worker1: ; ssh hpc-worker1 "sudo bash 4-configurar-nodo.sh hpc-worker1"
    scp 4-configurar-nodo.sh hpc-worker2: ; ssh hpc-worker2 "sudo bash 4-configurar-nodo.sh hpc-worker2"
"@
