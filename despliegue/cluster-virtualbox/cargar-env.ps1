<#
.SYNOPSIS
  Carga despliegue/cluster-virtualbox/.env en las variables de entorno de la
  sesión actual. Las claves de las bases de datos y de las VMs viven ahí, fuera
  de Git (ver .env.example).

.EXAMPLE
  . .\cargar-env.ps1
  psql -U postgres -h 127.0.0.1 -f 0-crear-bases.sql
#>
$archivo = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $archivo)) {
    Write-Warning "No existe $archivo. Cópialo de .env.example y rellénalo."
    return
}
foreach ($linea in Get-Content $archivo) {
    if ($linea -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim('"', "'")
    }
}
