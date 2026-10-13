# Clúster local en VirtualBox + servicios para probar las interfaces

Guía paso a paso para montar en **tu propio PC** el clúster MPI de 3 nodos y los
servicios del sistema, y probarlos desde las tres interfaces: la **app móvil**
(`FrontUPBCientifica`), el **front web** (`FrontWebUPBCientifica`, que entrega
`node-web` y habla con los servicios a través de su pasarela `/api`, contrato en
`FrontWebUPBCientifica/docs/PASARELA.md`) y la **app de escritorio**
(`FrontDesktopUPBCientifica`).

> Última revisión: 2026-10-13. Incluye Shared File, File Sync en una VM Ubuntu,
> el modo `soap` con mapa de servicios y el módulo de monitoreo.

Los scripts están en [`despliegue/cluster-virtualbox/`](../despliegue/cluster-virtualbox/).
Hacen automáticamente lo que la [guía del laboratorio](Guia_Cluster_HPC_UPB_CIENTIFICA.md)
explica a mano, con las mismas convenciones (`hpc-master`, `mpiuser` con UID
5000, `/srv/home` por NFS, `hostfile`). Si quieres entender el *porqué* de cada
paso de MPI, esa guía lo explica; esta te lleva de cero a funcionando.

---

## 0. Qué vas a montar

```
                         TU PC (Windows)
 ┌────────────────────────────────────────────────────────────────────┐
 │  PostgreSQL :5432                                                  │
 │  auth-local :8081   node-repository :8084   node-shared-file :8085 │
 │                     node-media :8083        node-web :8080 (portal)│
 │  monitoreo (opcional): Grafana :3000  Prometheus :9095             │
 │  (-HpcLocal) gestor-cluster RMI :2099 + job-api :8082              │
 │                                                                    │
 │  ┌ VirtualBox ───────────────────────────────────────────────────┐ │
 │  │ UbuntuServer1 (NAT)  syncd :9090  ◄── 9090 reenviado del PC   │ │
 │  │                                                               │ │
 │  │ red host-only 192.168.56.0/24                                 │ │
 │  │  hpc-master  .10   job-api :8082 → gestor-cluster (RMI)       │ │
 │  │      │  NFS /srv/home       mpirun ─┬──────────┐              │ │
 │  │  hpc-worker1 .11 ◄──────────────────┘          │              │ │
 │  │  hpc-worker2 .12 ◄─────────────────────────────┘              │ │
 │  └───────────────────────────────────────────────────────────────┘ │
 └────────────────────────────────────────────────────────────────────┘
        ▲ Wi-Fi (192.168.20.31)
        │ :8080 :8081 :8082 :8083 :8084 :8085 :9090
   📱 App móvil
```

| VM | Para qué | Pasos |
|---|---|---|
| `hpc-master`, `hpc-worker1`, `hpc-worker2` | Clúster MPI (opcional si usas `-HpcLocal`) | 1 a 6 |
| `UbuntuServer1` (o la que tengas) | File Sync (`syncd`) | 7.4 |

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

Para ahorrar una VM. En el CCA el gestor y `job-api` van en `node-rmi` y
`job-runner` en `hpc-master`; aquí los tres comparten el maestro (job-runner
en 2199/2200 para no chocar con el gestor). El trabajo es código fuente +
dataset del Home: el gestor los descarga de Storage (Windows) y `job-runner` los
compila con `mpicc` y los lanza con `mpirun` en los tres nodos.

### Sobre las 3 máquinas

[TRASPASO §4.2](TRASPASO.md) y la guía del laboratorio dicen que el profesor
exigió **mínimo 4 workers**. Para probar en tu PC, 3 máquinas bastan. Si el
clúster de la entrega también va a tener 3, conviene confirmarlo con el
profesor y actualizar esos dos documentos.

### Qué vas a poder probar al final

| Interfaz | Funciona | Con qué servicio |
|---|---|---|
| Login (las tres) | ✅ | auth-local |
| Mis archivos: subir, carpetas, ver, descargar, borrar, cuota (las tres) | ✅ | node-repository |
| Compartidos: compartir, recompartir, ver lo compartido (las tres) | ✅ | node-shared-file → node-repository |
| Fotos y Streaming: propio + compartido, orden, miniaturas, visor y reproductor dentro de la app (las tres) | ✅ | node-media (FFmpeg) |
| Sincronización · móvil (carpeta del teléfono, al llegar al Wi-Fi del servidor, horario) | ✅ | node-sync (VM) → node-repository |
| Sincronización · escritorio (carpeta del PC, manual / al conectar / cada hora / diaria) | ✅ | node-sync (VM) → node-repository |
| HPC (las tres): enviar código + dataset del Home, procesos, tiempo y prioridad; estado del clúster; registros; resultado en "Resultados HPC"; cancelar y reintentar | ✅ | job-api → gestor → job-runner (`mpirun` en los nodos; en el PC con `-HpcLocal`, mpirun simulado) |
| Monitoreo (Grafana, desde el portal en `/monitoreo/`) | ✅ con `-Monitoreo` | node-monitoreo |
| Mapa de servicios (`estudiante` sin HPC → 403) | ✅ con `-ModoAuth soap` | auth-local + cada servicio |

---

## 1. Antes de empezar

### 1.1 Memoria

Tu PC tiene **15.6 GB**. Las tres VMs del clúster usan 4 GB, la VM de File Sync
~1 GB, y los servicios de Windows otros ~1.5 GB (2 más con el monitoreo). Antes
de arrancar:

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

### 1.4 Herramientas portables (`%USERPROFILE%\sdk`)

No se instalan con instalador: se descomprimen en `C:\Users\<tú>\sdk` y los
scripts las buscan ahí.

| Carpeta | Qué | Para qué |
|---|---|---|
| `go` | Go 1.22 | Compilar node-sync (para Linux: ver 7.4) |
| `protoc` | protoc 25 | Regenerar los stubs de `filesync.proto` |
| `maven` | Maven 3.9 | Compilar `RMIUPBCientifica` |
| `ffmpeg` | FFmpeg 8.1 | Miniaturas y duración en node-media |
| `monitoreo` | Prometheus, Grafana, blackbox y windows_exporter | Módulo de monitoreo (`-Monitoreo`) |
| `zap` | OWASP ZAP | Análisis de vulnerabilidades (`docs/seguridad/`) |

> **El Control inteligente de aplicaciones de Windows bloquea los ejecutables de
> Go recién compilados** (también `go run` y `go test`). Por eso node-sync no
> corre en Windows sino en una VM Ubuntu (7.4). Las demás herramientas sí corren.

### 1.5 Abrir la terminal

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

Con el Maven portable de la sección 1.4:

```powershell
cd ..\..\RMIUPBCientifica
& "$env:USERPROFILE\sdk\maven\bin\mvn.cmd" -q -DskipTests package
cd ..\despliegue\cluster-virtualbox
```

> Si `gestor-cluster` y `job-api` están corriendo en Windows (`-HpcLocal`),
> deténlos antes: Windows no deja reemplazar un `.jar` en uso y `job-api.jar`
> quedaría incompleto.

### 6.2 Copiar y desplegar

```powershell
scp ..\..\RMIUPBCientifica\gestor-cluster\target\gestor-cluster.jar `
    ..\..\RMIUPBCientifica\job-api\target\job-api.jar `
    ..\..\RMIUPBCientifica\job-runner\target\job-runner.jar `
    ..\..\RMIUPBCientifica\job-runner\ejemplos\pi.c `
    6-desplegar-gestor.sh hpc-master:
ssh hpc-master "sudo bash 6-desplegar-gestor.sh"
```

Instala `job-runner`, `gestor-cluster` y `job-api` como servicios de `systemd`
(arrancan solos al encender el maestro) y hace una prueba completa: sube
`ejemplos/pi.c` a Storage, lo envía a `job-api` con tantos procesos como slots
tenga el hostfile y comprueba que se compiló y corrió en los tres nodos.

```
  OK  sin token -> 401 (la autenticación está activa)
  OK  pi.c subido al Home de mpiuser en Storage
  OK  trabajo enviado: 3f1c… (6 procesos)
  estado final: COMPLETADO
  OK  Storage -> gestor (RMI) -> job-runner -> mpicc + mpirun en 3 nodos -> resultado en el Home
```

> La prueba necesita Storage (Windows, `192.168.56.1:8084`) arrancado con el
> paso 7 y el 8084 abierto en el firewall. El código del usuario corre en el
> clúster como `mpiuser`, sin shell (riesgo V-11 corregido; ver el análisis de
> vulnerabilidades).

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
  -Protocol TCP -LocalPort 8080,8081,8082,8083,8084,8085,9090 -Action Allow -Profile Any
```

(8082 solo con `-HpcLocal`; 9090 es File Sync, reenviado a su VM.)

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
  OK     node-shared-file :8085
  OK     node-web         :8080
  node-repository  base de datos: ok
  node-media       base de datos: ok
  node-shared-file base de datos: ok
  node-sync (VM) :9090 reenviado; si no sincroniza, revisa que syncd este arrancado en la VM
  job-api del cluster (192.168.56.10:8082) alcanzable
```

Si algo falla, la ventana del script **no se cierra**: muestra el error y espera
a que pulses Enter.

| Opción | Qué añade |
|---|---|
| `-HpcLocal` | `gestor-cluster` (RMI 2099, métricas 9102) y `job-api` (8082) en Windows |
| `-ModoAuth soap` | Los servicios validan cada token con auth-local **y exigen el mapa de servicios** (paso 10) |
| `-Monitoreo` | Prometheus (9095), Grafana (3000) y los exportadores (`node-monitoreo/`) |

La combinación habitual:

```powershell
.\7-iniciar-servicios-windows.ps1 -HpcLocal -ModoAuth soap -Monitoreo
```

**HPC sin las VMs.** Con `-HpcLocal` el script arranca también `job-runner`
(2199), `gestor-cluster` (RMI 2099) y `job-api` (8082) en Windows, y apunta el
portal a ese job-api. En Windows no hay OpenMPI: ese job-runner usa un mpirun
**simulado** (lanza N copias del programa con `OMPI_COMM_WORLD_RANK/SIZE`, sin
comunicación entre procesos) y solo ejecuta programas `.py`. Sirve para probar
las tres interfaces de HPC.

```powershell
.\7-iniciar-servicios-windows.ps1 -HpcLocal
```

**HPC con OpenMPI real sin el clúster.** En una VM Ubuntu (por ejemplo la de
node-sync), `despliegue/cluster-virtualbox/ejecutor-vm-ubuntu.sh` instala
OpenMPI y `job-runner` en los puertos 2299/2300; VirtualBox los reenvía al PC
(`VBoxManage controlvm <vm> natpf1 "jobrunner-registry,tcp,127.0.0.1,2299,,2299"`
y lo mismo con 2300). Luego:

```powershell
.\7-iniciar-servicios-windows.ps1 -HpcLocal -EjecutorHpc 127.0.0.1:2299
```

> **Qué es `auth-local`.** Un Authentication Service de pruebas
> ([`herramientas/auth-local.js`](../herramientas/auth-local.js)) que imita
> node-soap en el mismo puerto y ruta: login, validación de tokens,
> `obtenerUsuario` (con `homeDirectory`) y `validarAccesoServicio` con el mismo
> mapa de servicios que `despliegue/node-soap/directorio.ldif`.

### 7.4 File Sync en una VM Ubuntu (una sola vez)

Windows no deja ejecutar `syncd` (sección 1.4), así que corre en una VM Ubuntu
con red **NAT**. VirtualBox reenvía el 9090 del PC a la VM, de modo que la app
(`192.168.20.31:9090`) y el escritorio (`127.0.0.1:9090`) no cambian nada. Desde
la VM, tu PC es `10.0.2.2`.

**1. Compilar para Linux en Windows** (compilar sí está permitido):

```powershell
cd ..\..\node-sync
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
& "$env:USERPROFILE\sdk\go\bin\go.exe" build -o bin\syncd-linux-amd64 ./cmd/syncd
Remove-Item env:GOOS, env:GOARCH, env:CGO_ENABLED
cd ..\despliegue\cluster-virtualbox
```

**2. Configurar la VM** (apagada; cambia el nombre si tu VM se llama distinto):

```powershell
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
& $vb modifyvm "UbuntuServer1" --natpf1 "syncd,tcp,,9090,,9090"
& $vb modifyvm "UbuntuServer1" --natpf1 "ssh,tcp,127.0.0.1,2223,,22"
& $vb modifyvm "UbuntuServer1" --nat-localhostreachable1 on   # que 10.0.2.2 llegue a 127.0.0.1 del PC
```

Sin `--nat-localhostreachable1 on`, VirtualBox 7 no deja que la VM llegue a los
servicios del PC por `10.0.2.2` (los `curl` de abajo salen vacíos).

**3. En la VM:**

```bash
sudo apt update && sudo apt install -y openssh-server curl
sudo mkdir -p /opt/syncd /var/lib/syncd && sudo chown $USER /opt/syncd /var/lib/syncd
curl -s http://10.0.2.2:8084/health; echo     # debe responder Storage
curl -s http://10.0.2.2:8081/                 # debe responder auth-local
```

**4. Copiar el binario (Windows) y dejarlo como servicio (VM):**

```powershell
scp -P 2223 ..\..\node-sync\bin\syncd-linux-amd64 <usuario>@127.0.0.1:/opt/syncd/syncd
```

```bash
chmod +x /opt/syncd/syncd
sudo tee /etc/systemd/system/syncd.service >/dev/null <<'EOF'
[Unit]
Description=UPB-CIENTIFICA node-sync (File Sync gRPC)
After=network-online.target

[Service]
Environment=SYNC_ADDR=:9090
Environment=SYNC_ALMACEN=storage
Environment=SYNC_STORAGE_URL=http://10.0.2.2:8084/storage
Environment=SYNC_AUTH_MODE=soap
Environment=SYNC_AUTH_URL=http://10.0.2.2:8081/soap/user.php
Environment=SYNC_REGISTRO=/var/lib/syncd/registro-sync.json
ExecStart=/opt/syncd/syncd
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now syncd
journalctl -u syncd -f
```

`SYNC_AUTH_MODE` tiene que coincidir con el `-ModoAuth` del script 7 (`soap` o
`simulado`). Si cambias el código de node-sync: recompila (1) y repite la copia (4).

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

Desde la propia app: **Mis archivos → +** sube archivos o carpetas del teléfono.
Fotos y videos aparecen solos en Fotos y Streaming: node-media reindexa al abrir
la primera página (como mucho una vez por minuto). El botón de buscar contenido
nuevo lo fuerza al momento.

### 8.3 Qué comprobar en el celular

Entra con `user1` / `1234`.

- **Mis archivos**: subir, crear carpetas, abrir imágenes y videos en el visor.
- **Compartidos**: comparte un archivo con `investigador` y entra con él en el
  portal: lo verá en Compartidos, y si es foto o video, también en Fotos y
  Streaming con "Compartido por user1".
- **Streaming / Fotos**: ordenar (Recientes, Más vistos, Título) y miniaturas reales.
- **Sincronización** (icono de nube arriba): elige una carpeta del teléfono;
  queda respaldada en "Respaldo celular" de tu Home. Se sincroniza sola al
  volver a conectar al Wi-Fi del PC, o en el horario que elijas.

En la ventana de auth-local verás cada intento de login, y **si se rechaza, el
motivo** (usuario inexistente, contraseña vacía, cuántos caracteres llegaron…).

---

## Paso 9 — Probar con el front web y lanzar un trabajo al clúster

Abre <http://localhost:8080> y entra con `investigador` / `test` (no con el
botón de modo demostración, que usa datos de ejemplo). Es el front de
`FrontWebUPBCientifica`: el script 7 lo sirve directamente desde ese repositorio
si está clonado junto al monorepo, así que sus cambios se ven al recargar.

Prueba **Mis archivos** (sube arrastrando, crea una carpeta, descarga, borra),
**Compartidos**, **Fotos** (álbumes y orden; lo nuevo aparece solo) y
**Streaming** (el video se reproduce y se puede saltar en la línea de tiempo:
peticiones `Range` que atraviesan node-web → node-media → node-repository).
Con `-Monitoreo`, el botón **Monitoreo** de Inicio abre Grafana en `/monitoreo/`
(`admin` / `admin` la primera vez).

### HPC

1. En **Mis archivos**, sube `RMIUPBCientifica/job-runner/ejemplos/pi.c` (o
   `estadisticas.c` + `numeros.csv`) a una carpeta, p. ej. `Proyectos`.
2. En **HPC → Nuevo trabajo**: nombre, elige el código (y el dataset), 6
   procesos, tiempo máximo y prioridad. Enviar.
3. La tarjeta pasa de *En cola* a *Ejecutando* (con los nodos asignados) y a
   *Completado*. **Ver registros** muestra lo que imprimió cada rango, y el
   resultado queda en **Mis archivos → Resultados HPC**.

La tarjeta del clúster muestra los procesos en uso, los nodos y si `job-runner`
responde. Por API (lo mismo que hacen las apps):

```powershell
$s = Invoke-RestMethod -Method Post http://localhost:8080/api/sesion `
       -ContentType 'application/json' -Body '{"usuario":"investigador","contrasena":"test"}'
$h = @{ Authorization = "Bearer $($s.token)" }

Invoke-RestMethod -Method Post http://localhost:8080/api/jobs -Headers $h -ContentType 'application/json' `
  -Body '{"nombreTrabajo":"pi","rutaCodigo":"/Proyectos/pi.c","numeroProcesos":6,"tiempoMaximoEjecucion":300}'
Invoke-RestMethod http://localhost:8080/api/jobs -Headers $h | Format-List nombreTrabajo, estado, nodosAsignados, rutaResultado
Invoke-RestMethod http://localhost:8080/api/cluster/estado -Headers $h
```

El recorrido completo: **front → node-web (pasarela) → job-api (REST) →
gestor-cluster (RMI) → Storage (código y dataset) → job-runner (RMI) → `mpicc`
+ `mpirun` → los tres nodos → resultado de vuelta al Home**.

Cada usuario solo ve sus propios trabajos: si entras con `user1`, no verás el de
`investigador`.

---

## Paso 10 — Validación de tokens y mapa de servicios "de verdad"

Por defecto los servicios usan el validador **simulado**: aceptan cualquier
token `mock-token-<uid>-…` sin preguntar a nadie. En modo **soap**, cada
servicio le pregunta a auth-local por cada token **y si el perfil del usuario
tiene ese servicio en su mapa** (`validarAccesoServicio`), como hará con el
node-soap real.

| Usuario | Perfil | Servicios |
|---|---|---|
| `user1`, `investigador` | investigadores | todos |
| `estudiante` | estudiantes | todos menos `hpc`: el gestor le responde **403** |

En modo soap solo valen los tokens que emite auth-local (iniciando sesión); un
`mock-token-…` escrito a mano da 401.

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
está disponible). El gestor y `job-api` arrancan solos con el maestro; `syncd`
arranca solo con su VM:

```powershell
$vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
'hpc-master', 'hpc-worker1', 'hpc-worker2', 'UbuntuServer1' | ForEach-Object { & $vbm startvm $_ --type headless }

cd C:\Users\sanab\OneDrive\Documentos\GitHub\UPB-CIENTIFICA\despliegue\cluster-virtualbox
.\7-iniciar-servicios-windows.ps1 -ModoAuth soap -Monitoreo        # o -HpcLocal sin el clúster
```

**Apagar** (los workers primero):

```powershell
'hpc-worker2', 'hpc-worker1', 'hpc-master', 'UbuntuServer1' | ForEach-Object { & $vbm controlvm $_ acpipowerbutton }
```

Y cierra las ventanas de los servicios. El monitoreo corre oculto: deténlo con
`Get-Process prometheus, grafana, blackbox_exporter, windows_exporter | Stop-Process`.

> Los trabajos HPC se guardan **en memoria** del gestor: al apagar el maestro se
> pierden (TRASPASO §7.3). Los archivos de Storage, las comparticiones y el
> catálogo de Media persisten en PostgreSQL; el histórico de métricas, en
> `%USERPROFILE%\sdk\monitoreo\datos` (30 días).

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
| Script 7 se cerraba sin decir nada | Versión anterior del script | Ahora muestra el error y espera a Enter |
| `go run` / `syncd.exe`: *"Una directiva de Control de aplicaciones bloqueó este archivo"* | Control inteligente de aplicaciones de Windows | node-sync va en la VM (7.4) |
| En la VM, `curl http://10.0.2.2:8084/health` sale vacío | VirtualBox 7 no reenvía a 127.0.0.1 del PC | `--nat-localhostreachable1 on` con la VM apagada (7.4) |
| App / escritorio: la sincronización no conecta | `syncd` parado en la VM, o firewall del 9090 | `journalctl -u syncd` en la VM; paso 7.2 |
| Un servicio responde 401 a un token `mock-token-…` | Modo `soap`: solo valen tokens de auth-local | Iniciar sesión, o arrancar sin `-ModoAuth soap` |
| `403 SERVICIO_NO_AUTORIZADO` | El perfil no tiene ese servicio en su mapa | Es lo esperado para `estudiante` en HPC (paso 10) |
| Portal: *"Demasiados intentos fallidos"* (429) | 5 contraseñas mal en 15 min para ese usuario | Esperar 15 min o reiniciar node-web |
| `localhost:8080` muestra otra cosa | Otro programa (p. ej. ZAP) escucha en 127.0.0.1:8080 | Cerrarlo; ZAP con `-port 8099` |
| Fotos o videos sin miniatura | Media arrancó sin FFmpeg | Script 7 lo busca en `%USERPROFILE%\sdk\ffmpeg`; reabrir node-media |
| Storage o Media no abren su puerto | No existen las bases | Paso 7.1 |
| Web · HPC: *"No hay respuesta de HPC (job-api)"* | Maestro apagado o `job-api` caído | `ssh hpc-master "systemctl status upbc-job-api"` |
| HPC: los trabajos se quedan *En cola* y la tarjeta dice *Sin job-runner* | job-runner caído o mal apuntado | `ssh hpc-master "systemctl status upbc-job-runner"`; en el PC, la ventana `job-runner` de `-HpcLocal` |
| HPC: *"No se encontró el código … (HPC-001)"* | La ruta no es relativa a tu Home | Elegirlo con el selector, o `/Carpeta/archivo.c` |
| Web: no deja entrar, *"El servicio de identidad no responde"* | auth-local no está corriendo | Revisar su ventana |
| Web: se ve la interfaz vieja o una página en blanco | node-web sirve otra carpeta | Mira la línea `Interfaz:` al arrancar node-web; `npm run interfaz` en `node-web` |
| App: *Failed to connect to /192.168.20.31:8081* | Firewall, IP Wi-Fi cambió, o `USAR_MOCK_AUTH = true` | Paso 7.2; `ipconfig`; paso 8.1 |
| App: *"Usuario o contraseña incorrectos"* | Credenciales | Mira el motivo exacto en la ventana de auth-local |
| Trabajo en `FALLIDO` | No compiló (HPC-004) o `mpirun` terminó con error | **Ver registros** en la app; `journalctl -u upbc-job-runner -n 50` en el maestro |

Logs útiles en el maestro:

```powershell
ssh hpc-master "journalctl -u upbc-job-runner -f"
ssh hpc-master "journalctl -u upbc-gestor -f"
ssh hpc-master "journalctl -u upbc-job-api -f"
```

---

## Qué NO cubre este entorno

Conviene tenerlo claro para no buscar errores donde no los hay:

- **Storage y el `/srv/home` del clúster no son el mismo disco.** No hace
  falta: el gestor descarga el código y el dataset de Storage por su API y
  `job-runner` los escribe en `/srv/home/.hpc-trabajos` (compartido por NFS con
  los workers); el resultado vuelve a Storage por la API.
- **Los trabajos corren como `mpiuser`**, no con la identidad del usuario (los
  nodos no son clientes LDAP; RF-20).
- **La programación de la sincronización del escritorio** solo corre con la app
  abierta y la sesión iniciada (el token vive en memoria); no hay `fsagent`.
- **node-soap real**: aquí lo sustituye auth-local. Para la VM del equipo:
  `despliegue/node-soap/desplegar-node-soap.sh` (carga el LDIF con usuarios,
  grupos y mapa de servicios). Luego el cambio es de dirección: en el script 7,
  `$urlAuth`; en la app, `HOST_SOAP_LAB`; en la VM de sync, `SYNC_AUTH_URL`.
- **Producción**: aquí todo es HTTP y los servicios escuchan en la red local
  (riesgos V-12/V-13/V-14 de `docs/seguridad/analisis-vulnerabilidades.md`).
