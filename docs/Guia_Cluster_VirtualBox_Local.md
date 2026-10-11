# Clúster local en VirtualBox + servicios para probar las interfaces

Guía paso a paso para montar en **tu propio PC** el clúster MPI de 3 nodos y los
servicios del sistema, y probarlos desde las dos interfaces que ya existen: la
**app móvil** (`FrontUPBCientifica`) y el **front web** (`FrontWebUPBCientifica`),
que entrega `node-web` y que habla con los servicios a través de su pasarela
`/api` (contrato en `FrontWebUPBCientifica/docs/PASARELA.md`).

Los scripts están en [`despliegue/cluster-virtualbox/`](../despliegue/cluster-virtualbox/).
Hacen automáticamente lo que la [guía del laboratorio](Guia_Cluster_HPC_UPB_CIENTIFICA.md)
explica a mano, con las mismas convenciones (`hpc-master`, `mpiuser` con UID
5000, `/srv/home` por NFS, `hostfile`). Si quieres entender el *porqué* de cada
paso de MPI, esa guía lo explica; esta te lleva de cero a funcionando.

---

## 0. Qué vas a montar

```
                       TU PC (Windows)
 ┌──────────────────────────────────────────────────────────────┐
 │  PostgreSQL :5432                                            │
 │  auth-local :8081 ── node-repository :8084 ── node-media :8083│
 │                 \                    |                       │
 │                  └──── node-web :8080 (portal)               │
 │                                      |                       │
 │      red host-only 192.168.56.0/24   | HTTP :8082            │
 │  ┌───────────────────────────────────┼─────────────────────┐ │
 │  │ VirtualBox                        ▼                     │ │
 │  │  hpc-master  .10   job-api :8082 → gestor-cluster (RMI) │ │
 │  │      │  NFS /srv/home       mpirun ─┬──────────┐        │ │
 │  │  hpc-worker1 .11 ◄──────────────────┘          │        │ │
 │  │  hpc-worker2 .12 ◄─────────────────────────────┘        │ │
 │  └─────────────────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────────────┘
        ▲ Wi-Fi (192.168.20.31)
        │ :8081 :8083 :8084
   📱 App móvil
```

| Máquina | IP host-only | RAM | Qué hace |
|---|---|---|---|
| `hpc-master` | 192.168.56.10 | 2 GB | Calcula, sirve `/srv/home` por NFS, ejecuta `gestor-cluster` y `job-api` |
| `hpc-worker1` | 192.168.56.11 | 1 GB | Calcula |
| `hpc-worker2` | 192.168.56.12 | 1 GB | Calcula |

Cada VM tiene 2 vCPU, así que el clúster ofrece **6 procesos MPI**.

### Por qué los servicios van en Windows y no en las VMs

La app móvil, en modo desarrollo, busca Storage, Media y Auth **en una sola
dirección**: la IP Wi-Fi del PC (ver `Configuracion.kt`). El celular no puede
alcanzar la red host-only de VirtualBox. Además, PostgreSQL ya está instalado en
Windows.

### Por qué el gestor va en el maestro y no en una VM `node-rmi`

`job-runner.jar` todavía no existe. Hoy el gestor ejecuta el comando de cada
trabajo con `bash -c` en la máquina donde corre. Si corre en `hpc-master` como
`mpiuser`, un trabajo `mpirun --hostfile …` se reparte de verdad entre los tres
nodos. Es el puente más corto entre el portal y el clúster con el código actual.

### Sobre las 3 máquinas

[TRASPASO §4.2](TRASPASO.md) y la guía del laboratorio dicen que el profesor
exigió **mínimo 4 workers**. Para probar en tu PC, 3 máquinas bastan. Si el
clúster de la entrega también va a tener 3, conviene confirmarlo con el
profesor y actualizar esos dos documentos.

### Qué vas a poder probar al final

| Interfaz | Funciona | Con qué servicio |
|---|---|---|
| App · Login | ✅ | auth-local |
| App · Mis archivos | ✅ | node-repository |
| App · Streaming | ✅ (sin duración ni miniatura si no tienes FFmpeg) | node-media |
| App · HPC (enviar con comando, lista, detalle, cancelar) | ✅ (sin tarjeta de carga del clúster: `job-api` no tiene `/cluster/estado`) | job-api → gestor (clúster, o este PC con `-HpcLocal`) |
| App · Compartidos conmigo | ⚠️ datos simulados | Shared File no existe |
| App · Sincronización | ❌ | falta generar el cliente gRPC en la app |
| Web · Mis archivos (subir, carpetas, descargar, borrar, cuota) | ✅ | node-repository |
| Web · Fotos (álbumes, indexar, visor) | ✅ | node-media |
| Web · Streaming (reproducción por rangos) | ✅ | node-media |
| Web · HPC: lista y cancelar | ✅ | job-api → gestor → **clúster** |
| Web · HPC: enviar desde el formulario | ❌ el front usa el contrato de `Contrato_HPC` (código fuente + dataset) y `job-api` todavía pide un comando; se envía por API (paso 9) | — |
| Web · HPC: tarjeta del clúster | ❌ `job-api` no tiene `/cluster/estado` | — |
| Web · Compartidos | ⚠️ datos simulados | Shared File no existe |
| Web · Monitoreo | ❌ | node-monitoreo no existe |

---

## 1. Antes de empezar

### 1.1 Memoria

Tu PC tiene **15.6 GB**. Las tres VMs usan 4 GB, y los servicios de Windows
otros ~1 GB. Antes de arrancar:

- Cierra Android Studio y el emulador si no los usas (usarás el celular físico).
- **No arranques la VM `Debian` que ya tienes**: es Debian 13 y tiene asignados
  8.6 GB. Junto al clúster, no cabe.

### 1.2 El hipervisor de Windows está activo

Tienes WSL2 / Hyper-V, así que VirtualBox corre **encima** del hipervisor de
Windows. Funciona, pero más lento: verás una **tortuga verde** en la barra de
estado de la ventana de la VM. Para tres VMs pequeñas suele bastar.

Si la instalación del paso 1 tarda más de 40 minutos o las VMs van muy lentas,
desactiva el hipervisor (PowerShell **como administrador**) y reinicia:

```powershell
bcdedit /set hypervisorlaunchtype off
```

Para volver a activarlo: `bcdedit /set hypervisorlaunchtype auto` y reiniciar.
Con el hipervisor apagado, WSL2 y la aceleración del emulador de Android dejan
de funcionar. Y si tienes *Integridad de memoria* activada (Seguridad de Windows
→ Seguridad del dispositivo → Aislamiento del núcleo), el hipervisor sigue
encendido igualmente: habría que desactivarla también.

### 1.3 Descargar Debian 12

Debian 12 ya no es la versión estable (lo es la 13), así que está en el archivo:

<https://cdimage.debian.org/cdimage/archive/latest-oldstable/amd64/iso-cd/>

Descarga **`debian-12.15.0-amd64-netinst.iso`** (unos 650 MB) en `Descargas`.

> El proyecto fija Debian 12 / OpenMPI 4.1. No uses la 13: trae otra versión de
> OpenMPI y la guía del laboratorio no coincidiría.

### 1.4 Abrir la terminal

Todos los comandos de Windows van en **PowerShell**, desde la carpeta de los
scripts:

```powershell
cd C:\Users\sanab\OneDrive\Documentos\GitHub\UPB-CIENTIFICA\despliegue\cluster-virtualbox
```

---

## Paso 1 — Crear la plantilla `hpc-base` (≈ 20 min, sin intervención)

```powershell
.\1-crear-vm-base.ps1 -Iso "$env:USERPROFILE\Downloads\debian-12.15.0-amd64-netinst.iso"
```

Qué hace:

1. Crea tu llave SSH de Windows si no la tienes, y añade a `~\.ssh\config` los
   atajos `hpc-base`, `hpc-master`, `hpc-worker1` y `hpc-worker2`. A partir de
   ahí basta escribir `ssh hpc-master`.
2. Crea la VM con dos tarjetas: **NAT** (Internet + SSH reenviado al puerto
   2222) y **Host-Only** (la red del clúster).
3. Instala Debian 12 **sin escritorio**, sin que toques nada. Se abre la ventana
   de la VM para que veas el progreso.

Termina cuando dice `Debian 12 instalado y SSH respondiendo`.

> **Por qué una plantilla propia de instalación:** la que trae VirtualBox para
> Debian no fija los paquetes, y el instalador elige por defecto GNOME. Con 1 GB
> de RAM por worker, un escritorio no cabe.

**Si la instalación se queda parada en una pregunta** o falla, borra la VM desde
VirtualBox (*Eliminar → Borrar todos los archivos*) y repite en modo manual. El
script te dice qué elegir en cada pantalla:

```powershell
.\1-crear-vm-base.ps1 -Iso "$env:USERPROFILE\Downloads\debian-12.15.0-amd64-netinst.iso" -Manual
```

---

## Paso 2 — Preparar la plantilla (≈ 5 min)

Copia el script y tu llave pública, y ejecútalo. La contraseña es `upbc2026`:
la pide al copiar, al entrar y otra vez `sudo`. **Es la única vez**: este paso
deja autorizada tu llave de Windows y `sudo` sin contraseña en los nodos.

```powershell
scp 2-preparar-base.sh "$env:USERPROFILE\.ssh\id_ed25519.pub" hpc-base:
ssh -t hpc-base "sudo bash 2-preparar-base.sh"
```

> El `-t` hace falta solo aquí: abre una terminal para que `sudo` pueda pedir la
> contraseña. Sin él, falla con *"a terminal is required to read the password"*.

Instala OpenMPI, NFS y Java 17, crea `mpiuser` (UID 5000) con una llave SSH
compartida, y —lo más importante en VirtualBox— **obliga a MPI a usar solo la
red host-only**.

> **El problema clásico de MPI en VirtualBox:** la tarjeta NAT tiene la misma IP
> (10.0.2.15) en todas las VMs. OpenMPI la ve en todos los nodos, intenta usarla
> para comunicarse y cada nodo acaba hablando consigo mismo: `mpirun` se cuelga
> sin decir nada. El script lo evita en `/etc/openmpi/openmpi-mca-params.conf`.

Cuando termine, **apaga la plantilla**:

```powershell
ssh hpc-base "sudo poweroff"
```

Comprueba que ya no te pide contraseña: el próximo `ssh` a cualquier nodo debe
entrar directo.

---

## Paso 3 — Clonar los tres nodos (≈ 3 min)

```powershell
.\3-clonar-nodos.ps1
```

Crea `hpc-master`, `hpc-worker1` y `hpc-worker2` como copias completas de la
plantilla, con MAC nuevas y cada una con su puerto SSH, y las arranca sin
ventana. Termina cuando los tres responden.

Clonar en vez de instalar tres veces garantiza que `mpiuser` tenga **el mismo
UID en los tres**, que es la causa número uno de errores con NFS.

> Conserva `hpc-base`: si un nodo se estropea, lo borras y vuelves a clonar.

---

## Paso 4 — Configurar cada nodo (≈ 2 min)

**El maestro primero**: es el servidor NFS y los workers lo montan al terminar.

```powershell
scp 4-configurar-nodo.sh hpc-master:  ; ssh hpc-master  "sudo bash 4-configurar-nodo.sh hpc-master"
scp 4-configurar-nodo.sh hpc-worker1: ; ssh hpc-worker1 "sudo bash 4-configurar-nodo.sh hpc-worker1"
scp 4-configurar-nodo.sh hpc-worker2: ; ssh hpc-worker2 "sudo bash 4-configurar-nodo.sh hpc-worker2"
```

Cada uno recibe su nombre, su IP fija, un `/etc/hosts` **sin** la línea
`127.0.1.1` (otra causa clásica de fallos en MPI), una identidad propia
(machine-id y llaves de host SSH nuevas) y su parte de NFS.

En el último debes ver los tres nodos respondiendo:

```
  hpc-master   responde
  hpc-worker1  responde
  hpc-worker2  responde
```

---

## Paso 5 — Validar el clúster MPI (≈ 1 min)

```powershell
scp 5-validar-mpi.sh hpc-master:
ssh hpc-master "sudo install -o mpiuser -g mpigroup -m 755 5-validar-mpi.sh /home/mpiuser/ && sudo -iu mpiuser ./5-validar-mpi.sh"
```

Comprueba SSH sin contraseña, que `/srv/home` es realmente compartido, que la
versión de OpenMPI es idéntica, crea el `hostfile` y ejecuta los dos programas
de la guía del laboratorio. Debe terminar así:

```
Proceso 0 de 6 ejecutandose en hpc-master
Proceso 1 de 6 ejecutandose en hpc-master
Proceso 2 de 6 ejecutandose en hpc-worker1
Proceso 3 de 6 ejecutandose en hpc-worker1
Proceso 4 de 6 ejecutandose en hpc-worker2
Proceso 5 de 6 ejecutandose en hpc-worker2
  OK  6 procesos repartidos en los 3 nodos
Suma de 1..6 calculada entre 6 procesos = 21
Valor esperado = 21
  OK  los nodos se comunican: 21 = 21
```

**Con esto el clúster está montado.** Guarda la salida: es evidencia para el
informe y la bitácora.

> El maestro también calcula (`hpc-master slots=2` en el hostfile). La guía del
> laboratorio lo deja fuera para que no compita con el gestor, pero con solo 3
> máquinas desperdiciar un tercio del clúster no tiene sentido.

---

## Paso 6 — Desplegar el gestor del clúster (≈ 3 min)

### 6.1 Compilar los `.jar` en Windows

Maven viene con la extensión de Java de VS Code, y su ruta cambia con cada
actualización. Esto lo encuentra:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$mvn = Get-ChildItem "$env:USERPROFILE\.vscode\extensions\oracle.oracle-java-*\nbcode\java\maven\bin\mvn.cmd" |
       Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName

cd ..\..\RMIUPBCientifica
& $mvn -o -q -DskipTests package
cd ..\despliegue\cluster-virtualbox
```

Si falla por dependencias, quita el `-o` (descarga lo que falte).

### 6.2 Copiar y desplegar

```powershell
scp ..\..\RMIUPBCientifica\gestor-cluster\target\gestor-cluster.jar `
    ..\..\RMIUPBCientifica\job-api\target\job-api.jar `
    6-desplegar-gestor.sh hpc-master:
ssh hpc-master "sudo bash 6-desplegar-gestor.sh"
```

Instala los dos como servicios de `systemd` (arrancan solos al encender el
maestro) y hace una prueba completa: envía un trabajo a `job-api` y comprueba
que termina habiendo corrido en los tres nodos.

```
  OK  sin token -> 401 (la autenticación está activa)
  OK  trabajo enviado: 3f1c…
  estado final: COMPLETED
  OK  REST -> RMI -> mpirun -> 3 nodos: el gestor está conectado al clúster
```

> ⚠️ El gestor ejecuta **cualquier** comando que le mande un usuario autenticado,
> como `mpiuser`, en el clúster. Es aceptable aquí; en producción es el pendiente
> 7.3 de TRASPASO, que resuelve `job-runner.jar`.

---

## Paso 7 — Servicios en Windows (≈ 2 min)

### 7.1 Bases de datos (una sola vez)

Te pedirá la contraseña del usuario `postgres`:

```powershell
psql -U postgres -h 127.0.0.1 -f 0-crear-bases.sql
```

Se puede repetir sin error: solo crea lo que falta.

### 7.2 Firewall (una sola vez, PowerShell como administrador)

Para que el celular llegue a los servicios, y las VMs a auth-local:

```powershell
New-NetFirewallRule -DisplayName "UPB-CIENTIFICA pruebas locales" -Direction Inbound `
  -Protocol TCP -LocalPort 8080,8081,8083,8084 -Action Allow -Profile Any
```

`-Profile Any` importa: Windows clasifica la red host-only de VirtualBox como
*pública*, y una regla solo para redes privadas no la cubriría.

### 7.3 Arrancar

**Cierra antes** el `mock-auth-server/server.js` de la app si lo tienes abierto:
usa el puerto 8080, que ahora es del portal.

```powershell
.\7-iniciar-servicios-windows.ps1
```

Abre una ventana por servicio, cada una con sus variables ya puestas, y espera a
que respondan:

```
  OK     auth-local       :8081
  OK     node-repository  :8084
  OK     node-media       :8083
  OK     node-web         :8080
  node-repository  base de datos: ok
  node-media       base de datos: ok
  job-api del cluster (192.168.56.10:8082) alcanzable
```

**HPC sin las VMs.** Con `-HpcLocal` el script arranca también `gestor-cluster`
(RMI 2099) y `job-api` (8082) en Windows, y apunta el portal a ese job-api.
Necesita los `.jar` compilados y Git Bash: los trabajos se ejecutan en el PC con
`bash -c`, no en el clúster MPI. Sirve para probar la pestaña HPC de la app y
del portal.

```powershell
.\7-iniciar-servicios-windows.ps1 -HpcLocal
```

> **Qué es `auth-local`.** Un Authentication Service de pruebas
> ([`herramientas/auth-local.js`](../herramientas/auth-local.js)). Hace falta
> porque ninguno de los dos simuladores que había servía para probar contra los
> servicios reales: el `server.js` de la app solo habla `login`, y
> `nodos-falsos.js` emite tokens que Storage y el gestor rechazan. Este habla los
> dos contratos de `users.wsdl` en el mismo puerto y ruta que el node-soap real.

---

## Paso 8 — Probar con la app móvil

### 8.1 Apuntar la app a auth-local

En `FrontUPBCientifica/app/src/main/java/com/upbcientifica/mobile/network/Configuracion.kt`:

```kotlin
val entorno: Entorno = Entorno.DISPOSITIVO_FISICO
const val IP_PC_EN_WIFI = "192.168.20.31"     // compruébala con ipconfig
const val USAR_MOCK_AUTH = false              // <- este es el cambio
```

`USAR_MOCK_AUTH = false` hace que la app use `http://<IP>:8081/soap/user.php`,
que es auth-local, igual que hará con el node-soap real.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
cd C:\Users\sanab\OneDrive\Documentos\GitHub\FrontUPBCientifica
.\gradlew.bat installDebug
```

### 8.2 Darle contenido

La app solo **lista** archivos; no tiene botón de subir. Se sube por la API. El
token se pide al portal con el **mismo usuario** con el que entrarás en la app
(si no, los archivos serán de otro dueño y no los verás):

```powershell
$s = Invoke-RestMethod -Method Post http://localhost:8080/api/sesion `
       -ContentType 'application/json' -Body '{"usuario":"user1","contrasena":"1234"}'
$t = "Authorization: Bearer $($s.token)"

curl.exe -X POST "http://localhost:8084/storage/archivos?directorioDestino=root" -H $t -F "archivo=@C:\ruta\a\documento.pdf"
curl.exe -X POST "http://localhost:8084/storage/archivos?directorioDestino=root" -H $t -F "archivo=@C:\ruta\a\video.mp4"
curl.exe -X POST "http://localhost:8084/storage/archivos?directorioDestino=root" -H $t -F "archivo=@C:\ruta\a\foto.jpg"

# Media no se entera solo de lo que se sube: hay que indexar.
curl.exe -X POST http://localhost:8083/album/indexar -H $t
```

### 8.3 Qué comprobar en el celular

Entra con `user1` / `1234`.

- **Mis archivos**: aparecen los tres archivos con su tamaño real.
- **Streaming**: aparece el video.

En la ventana de auth-local verás cada intento de login, y **si se rechaza, el
motivo** (usuario inexistente, contraseña vacía, cuántos caracteres llegaron…).

---

## Paso 9 — Probar con el front web y lanzar un trabajo al clúster

Abre <http://localhost:8080> y entra con `investigador` / `test` (no con el
botón de modo demostración, que usa datos de ejemplo). Es el front de
`FrontWebUPBCientifica`: el script 7 lo sirve directamente desde ese repositorio
si está clonado junto al monorepo, así que sus cambios se ven al recargar.

Prueba **Mis archivos** (sube arrastrando, crea una carpeta, descarga, borra),
**Fotos** (botón *Indexar* y luego los álbumes) y **Streaming** (el video se
reproduce y se puede saltar en la línea de tiempo: eso son peticiones `Range`
que atraviesan node-web → node-media → node-repository).

### HPC: lo que funciona y lo que no

La pestaña **HPC** lista los trabajos y deja cancelarlos. Su **formulario de
envío todavía no funciona**: el front sigue `Contrato_HPC` (elige código fuente
y dataset en Storage y el número de procesos), pero `job-api` aún pide un
comando. Al enviar verás *"comando: El comando del trabajo es obligatorio"*.
La tarjeta de estado del clúster tampoco: `job-api` no tiene `/cluster/estado`.

Mientras tanto, se envía por la pasarela con el contrato que `job-api` sí
acepta hoy:

```powershell
$s = Invoke-RestMethod -Method Post http://localhost:8080/api/sesion `
       -ContentType 'application/json' -Body '{"usuario":"investigador","contrasena":"test"}'
$h = @{ Authorization = "Bearer $($s.token)" }

Invoke-RestMethod -Method Post http://localhost:8080/api/jobs -Headers $h `
  -ContentType 'application/json' `
  -Body '{"nombre":"hola-cluster","comando":"mpirun -np 6 --hostfile /srv/home/hostfile /srv/home/mpi/hola.bin","prioridad":5}'
```

Abre la pestaña **HPC**: el trabajo aparece y pasa de *En cola* a *Completado*.
Para ver qué imprimió:

```powershell
Invoke-RestMethod http://localhost:8080/api/jobs -Headers $h | Format-List nombre, estado, resultado
```

El recorrido completo fue: **front web → node-web (pasarela) → job-api (REST)
→ gestor-cluster (RMI) → `mpirun` → los tres nodos**.

Cada usuario solo ve sus propios trabajos: si entras con `user1`, no verás el de
`investigador`.

---

## Paso 10 (opcional) — Validación de tokens "de verdad"

Por defecto los servicios usan el validador **simulado**: aceptan cualquier
token `mock-token-<uid>-…` sin preguntar a nadie. En modo **soap**, cada
servicio le pregunta a auth-local por cada token, como hará con el node-soap
real. Es más fiel y prueba el código de integración (`ValidadorSoap` de Storage,
Media y el gestor).

```powershell
# Windows: cierra las 4 ventanas de servicios y relanza
.\7-iniciar-servicios-windows.ps1 -ModoAuth soap

# Clúster: el gestor también valida contra auth-local (192.168.56.1:8081)
ssh hpc-master "sudo bash 6-desplegar-gestor.sh soap"
```

En este modo **los grupos del usuario cuentan** para los permisos Unix de
Storage. `investigador` está en `investigadores`; `estudiante`, en
`estudiantes`. Un archivo compartido con el grupo `investigadores` lo verá el
primero y no el segundo. (En modo simulado todos los usuarios están en el mismo
grupo inventado, `usuarios`.)

---

## El día a día: encender y apagar

**Encender** (el maestro primero; los workers montan `/srv/home` solos cuando
está disponible). El gestor y `job-api` arrancan solos con el maestro:

```powershell
$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
'hpc-master', 'hpc-worker1', 'hpc-worker2' | ForEach-Object { & $vbm startvm $_ --type headless }

cd C:\Users\sanab\OneDrive\Documentos\GitHub\UPB-CIENTIFICA\despliegue\cluster-virtualbox
.\7-iniciar-servicios-windows.ps1
```

**Apagar** (los workers primero):

```powershell
'hpc-worker2', 'hpc-worker1', 'hpc-master' | ForEach-Object { & $vbm controlvm $_ acpipowerbutton }
```

Y cierra las ventanas de los servicios.

> Los trabajos HPC se guardan **en memoria** del gestor: al apagar el maestro se
> pierden (TRASPASO §7.5). Los archivos de Storage y del catálogo de Media sí
> persisten en PostgreSQL.

---

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| *"no se puede cargar … no está firmado digitalmente"* al lanzar un `.ps1` | Archivo marcado como descargado | `Unblock-File *.ps1` |
| La instalación del paso 1 se detiene en una pregunta | La plantilla automática no cubrió algún caso | Borrar la VM y repetir con `-Manual` |
| VM extremadamente lenta, tortuga verde | Hipervisor de Windows activo | Sección 1.2 |
| `ssh hpc-…` pide contraseña después del paso 2 | La llave de Windows no llegó a la plantilla | `scp "$env:USERPROFILE\.ssh\id_ed25519.pub" hpc-…:` y repetir el paso 2 |
| `$'\r': command not found` al ejecutar un `.sh` | El archivo tiene saltos de línea de Windows | En la VM: `sed -i 's/\r$//' script.sh` |
| Paso 4 en un worker: *"/srv/home no se montó"* | Se configuró antes que el maestro | Repetir el paso 4 en ese worker |
| `mpirun` se cuelga sin mensaje | MPI usando la tarjeta NAT | Revisar `/etc/openmpi/openmpi-mca-params.conf` en los 3 nodos (paso 2) |
| *There are not enough slots available* | `-np` mayor que los slots del hostfile | Usar `-np 6` o menos |
| Script 7: *"puertos ocupados"* | `server.js`, `nodos-falsos.js` o una ejecución anterior | Cerrar esas ventanas |
| Storage o Media no abren su puerto | No existen las bases | Paso 7.1 |
| Web · HPC: *"No hay respuesta de HPC (job-api)"* | Maestro apagado o `job-api` caído | `ssh hpc-master "systemctl status upbc-job-api"` |
| Web · HPC al enviar: *"comando: El comando del trabajo es obligatorio"* | El formulario usa `Contrato_HPC` y `job-api` todavía no | Enviar por API (paso 9) |
| Web: no deja entrar, *"El servicio de identidad no responde"* | auth-local no está corriendo | Revisar su ventana |
| Web: se ve la interfaz vieja o una página en blanco | node-web sirve otra carpeta | Mira la línea `Interfaz:` al arrancar node-web; `npm run interfaz` en `node-web` |
| App: *Failed to connect to /192.168.20.31:8081* | Firewall, IP Wi-Fi cambió, o `USAR_MOCK_AUTH = true` | Paso 7.2; `ipconfig`; paso 8.1 |
| App: *"Usuario o contraseña incorrectos"* | Credenciales | Mira el motivo exacto en la ventana de auth-local |
| Trabajo en `FALLIDO` | El comando falló en el clúster | `journalctl -u upbc-gestor -n 50` en el maestro |

Logs útiles en el maestro:

```powershell
ssh hpc-master "journalctl -u upbc-gestor -f"
ssh hpc-master "journalctl -u upbc-job-api -f"
```

---

## Qué NO cubre este entorno

Conviene tenerlo claro para no buscar errores donde no los hay:

- **Los archivos de Storage y el `/srv/home` del clúster no son el mismo
  disco.** Storage guarda en `node-repository/almacen-pruebas` de Windows; el
  clúster usa `/srv/home` de `hpc-master`. Un trabajo no puede leer un archivo
  subido por la app. Unirlos es parte de lo que debe hacer `job-runner.jar`
  (recibir los datos desde Storage) y de la decisión pendiente de TRASPASO §7.2.
- **El formulario HPC del front web no envía trabajos** hasta que `job-api`
  adopte el contrato de `Contrato_HPC` (código fuente + dataset + procesos) y
  exponga `/cluster/estado`. Por eso el paso 9 envía por API.
- **La app móvil envía trabajos con un comando**, que es lo que acepta hoy
  `job-api`. Cuando `job-api` adopte `Contrato_HPC`, la app tendrá que cambiar
  su formulario igual que el portal.
- **Shared File, Monitoreo y la sincronización de la app** no existen todavía.
- **Sin FFmpeg** (no lo tienes instalado), Media indexa los videos sin duración
  ni miniatura. Para tenerlas: `winget install Gyan.FFmpeg` y reabrir la
  ventana de node-media.
- **node-soap real**: aquí lo sustituye auth-local. Cuando tu compañero tenga la
  VM de node-soap, el cambio es solo de dirección: en el script 7, `$urlAuth`;
  en la app, `HOST_SOAP_LAB`.
