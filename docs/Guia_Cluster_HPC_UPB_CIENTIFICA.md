# Guía de montaje del Clúster HPC — UPB-CIENTÍFICA

Guía paso a paso para montar el clúster MPI en la sala del laboratorio y
conectarlo con los servicios que **ya están desplegados** en las VPS
(`pasd_nodo1..3`).

> Para practicar en tu PC antes del laboratorio, los mismos pasos están
> automatizados con VirtualBox en [`Guia_Cluster_VirtualBox_Local.md`](Guia_Cluster_VirtualBox_Local.md)
> (scripts de `despliegue/cluster-virtualbox/`).
>
> Última revisión: 2026-10-13. Clúster de **4 máquinas virtuales Debian 13**
> (1 maestro + 3 workers), una por PC del laboratorio, conectadas a la **red de
> la universidad tal como está**: sin switch propio, sin IP fijas y sin tocar la
> configuración de red de nadie.

### Cómo leer los bloques de esta guía

- **▶ Terminal**: comandos. Se copian y se pegan en la terminal de la VM indicada.
- **📄 Archivo**: contenido de un archivo. **No se pega en la terminal** (bash
  respondería `command not found`): se abre el archivo con el comando que va
  justo antes (`sudo nano …`) y se escribe dentro.

---

## 0. Punto de partida y qué vamos a montar

### Lo que ya funciona (no se toca en esta guía, salvo lo indicado)

| VPS | IP | Servicios |
|---|---|---|
| `pasd_nodo1` | 10.154.12.219 | node-soap (8081) + OpenLDAP, node-web (443), Prometheus + Grafana |
| `pasd_nodo2` | 10.154.12.221 | Storage (8084), Shared File (8085), node-sync (9090), PostgreSQL |
| `pasd_nodo3` | 10.154.12.222 | node-media (8083), **gestor del clúster** (RMI 2099/2100, métricas 9102) y **job-api** (8082) |

Hoy el gestor responde "job-runner desconectado": falta lo que monta esta guía.
Al terminar, un usuario envía código + dataset desde la web, el escritorio o el
móvil; el gestor (nodo3) los baja de Storage y se los pasa por RMI a
`job-runner` en `hpc-master`, que compila y lanza `mpirun` en el clúster.

### Diseño

```
          Red cableada de la universidad (DHCP de la U, sin cambios)
   ──────┬──────────────┬──────────────┬──────────────┬────────── ··· VPS 10.154.12.x
         │              │              │              │
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │ PC lab A  │  │ PC lab B  │  │ PC lab C  │  │ PC lab D  │   (anfitriones: no se tocan)
   │ VirtualBox│  │ VirtualBox│  │ VirtualBox│  │ VirtualBox│
   │ VM        │  │ VM        │  │ VM        │  │ VM        │   adaptador PUENTE
   │ hpc-master│  │hpc-worker1│  │hpc-worker2│  │hpc-worker3│   IP por DHCP de la U
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

- **Un PC del laboratorio = una VM Debian 13.** El PC anfitrión sigue con su
  sistema, su cable y su IP de siempre.
- La VM se conecta en **modo puente** al cable del PC: para la red es un equipo
  más que pide IP al **DHCP de la universidad**. No se asigna ninguna IP a mano.
- Los nodos se encuentran por nombre (`hpc-master`, `hpc-worker1..3`) gracias a
  `/etc/hosts` dentro de las 4 VMs, con las IP que les dio el DHCP.
- El gestor (nodo3) llega al maestro por la red de la U, como llega cualquier
  equipo de la sala a las VPS.

> ⚠️ **Diferencias con el diagrama de despliegue v2** (anótalas en el informe):
> 1. **Workers:** el diagrama y la indicación del profesor piden **mínimo 4
>    workers**; aquí hay 3. Para tener 4 nodos de cómputo, el maestro también
>    ejecuta procesos (entra en el `hostfile`). Si el profesor exige 4 workers
>    *además* del maestro, hace falta una quinta VM: los pasos son los mismos.
> 2. **NFS:** el diagrama dibuja `/srv/home` exportado desde `node-repository`.
>    En el laboratorio lo exporta **el maestro** a los workers. El código y el
>    dataset le llegan a `job-runner` por RMI (el gestor los baja de Storage con
>    el token del usuario) y el resultado vuelve al Home del usuario por la API
>    de Storage: en el clúster, `/srv/home` es solo el **espacio de trabajo
>    compartido** que MPI necesita.
> 3. **Nodos virtuales:** los nodos son VMs Debian 13 sobre los PC del
>    laboratorio. Trae **OpenMPI 5.0** (no 4.1) y **OpenJDK 21** (no 17);
>    `job-runner.jar` está compilado para Java 17 y corre igual en 21.

### Reglas para no afectar la red de la universidad

Estas reglas son las que garantizan que el clúster **no altera internet ni las
IP de nadie**. Todas las instrucciones de la guía las respetan; no las saltes.

| Nunca hagas esto | Por qué |
|---|---|
| Poner una IP fija en la VM o en el PC anfitrión | Puede chocar con la IP de otro equipo o del router de la sala y dejarlos sin red |
| Instalar un servidor DHCP (`isc-dhcp-server`, `dnsmasq`…) | Repartiría IP falsas a toda la sala y la dejaría sin internet |
| Activar reenvío de tráfico o NAT (`ip_forward`, `nftables masquerade`) | Convierte la VM en un router no autorizado |
| Conectar un switch propio con dos cables a la red, o unir dos tomas | Crea un lazo: una tormenta de broadcast puede tumbar el piso entero |
| Usar el adaptador Wi-Fi del anfitrión para el puente | El puente sobre Wi-Fi da problemas y el clúster debe ir por cable |
| Poner la VM en "modo promiscuo: permitir todo" | La VM vería el tráfico de otros equipos |
| Clonar una VM sin regenerar su MAC | Dos equipos con la misma MAC se roban la conexión entre sí |
| Exportar NFS a toda la subred | Cualquiera de la sala podría montar los datos del clúster |

**Antes de empezar, pide permiso** a quien administra la red (CCA): vas a
conectar 4 equipos virtuales nuevos (4 MAC nuevas) en los puertos de la sala.
Algunas redes los bloquean (802.1X o límite de MAC por puerto) y es mejor
saberlo antes. Aprovecha para pedir **reservas DHCP** para las 4 MAC (PASO 2.3):
no cambia nada para nadie y evita que las IP del clúster cambien.

---

## 1. Configuración de cada máquina

### 1.1 PC anfitrión (cada uno de los 4 PC del laboratorio)

| Requisito | Mínimo | Recomendado | Cómo comprobarlo |
|---|---|---|---|
| Procesador | 4 núcleos, 64 bits | 6+ núcleos | Administrador de tareas → Rendimiento → CPU ("Núcleos") |
| Virtualización (VT-x / AMD-V) | Activada | Activada | Administrador de tareas → CPU → "Virtualización: Habilitado" (si no, en la BIOS) |
| Memoria RAM | 8 GB | 16 GB | Administrador de tareas → Memoria |
| Disco libre | 40 GB (maestro) / 25 GB (worker) | SSD | Explorador de archivos |
| Red | **Tarjeta Ethernet con cable** conectado a la toma de la sala | 1 Gbps | Configuración → Red → Ethernet "Conectado" |
| VirtualBox | 7.1 o superior, la **misma versión** en los 4 | — | Ayuda → Acerca de |
| Energía | Sin suspensión mientras el clúster esté en uso | — | Configuración → Energía → Suspender: "Nunca" |

> Si el PC se suspende o se apaga, su VM desaparece de la red: `job-runner` lo
> detecta, el gestor marca el nodo como caído y reencola el trabajo en los demás.

### 1.2 Las 4 máquinas virtuales

| Rol | Nombre de la VM y del host | vCPU | RAM | Disco (VDI dinámico) | Red | Slots MPI |
|---|---|---|---|---|---|---|
| Maestro | `hpc-master` | núcleos del anfitrión − 2 (mín. 2) | 4 GB | 40 GB | 1 adaptador puente | vCPU − 1 |
| Worker 1 | `hpc-worker1` | núcleos del anfitrión − 1 (mín. 2) | 3 GB | 25 GB | 1 adaptador puente | vCPU |
| Worker 2 | `hpc-worker2` | núcleos del anfitrión − 1 (mín. 2) | 3 GB | 25 GB | 1 adaptador puente | vCPU |
| Worker 3 | `hpc-worker3` | núcleos del anfitrión − 1 (mín. 2) | 3 GB | 25 GB | 1 adaptador puente | vCPU |

- **vCPU:** núcleos *físicos* del anfitrión menos 1 (menos 2 en el maestro, que
  además corre `job-runner`, NFS y SSH). Nunca más núcleos de los que tiene el PC.
- **RAM:** como máximo la mitad de la del anfitrión. El maestro necesita más
  por Java (`job-runner`) y el servidor NFS.
- **Slots MPI:** cuántos procesos lanza `mpirun` en esa VM (PASO 7). El maestro
  deja un núcleo libre para coordinar.
- **Disco:** el maestro guarda `/srv/home` (trabajos y resultados temporales).

### 1.3 Ajustes de VirtualBox (iguales en las 4 VMs)

| Pestaña | Ajuste | Valor |
|---|---|---|
| General → Básico | Tipo / Versión | Linux / Debian (64-bit) |
| Sistema → Placa base | Memoria base | según la tabla 1.2 |
| Sistema → Placa base | Habilitar EFI | No (BIOS clásica) |
| Sistema → Procesador | Procesadores | según la tabla 1.2 |
| Sistema → Procesador | Habilitar PAE/NX | Sí |
| Pantalla | Memoria de vídeo / 3D | 16 MB / sin aceleración 3D (servidor sin escritorio) |
| Almacenamiento | Disco | VDI, reservado dinámicamente, tamaño de la tabla 1.2 |
| Audio | Habilitar audio | **No** |
| **Red → Adaptador 1** | Habilitar adaptador de red | **Sí** |
| | Conectado a | **Adaptador puente** |
| | Nombre | La tarjeta **Ethernet cableada** del PC (no la Wi-Fi, no "VirtualBox Host-Only") |
| | Tipo de adaptador | Intel PRO/1000 MT Desktop (82540EM) |
| | Modo promiscuo | **Denegar** |
| | Dirección MAC | La que genera VirtualBox, **distinta en cada VM** |
| | Cable conectado | Sí |
| Red → Adaptadores 2, 3 y 4 | Habilitar | **No** (una sola tarjeta por VM) |
| USB | Controlador USB | Deshabilitado |
| Carpetas compartidas | — | Ninguna |

> **Si clonas una VM** (por ejemplo, instalas `hpc-worker1` y la clonas para
> los otros workers): en el asistente de clonación elige **"Generar nuevas
> direcciones MAC para todos los adaptadores de red"**. Luego cambia el nombre
> de host dentro del clon (PASO 1.3).

### 1.4 Hoja de datos del clúster (rellénala al terminar el PASO 2)

Guárdala: sirve para el `/etc/hosts`, el firewall, el gestor y el informe.

| Rol | PC anfitrión (etiqueta de la sala) | Núcleos / RAM del anfitrión | vCPU / RAM de la VM | MAC de la VM | IP (DHCP) | Slots |
|---|---|---|---|---|---|---|
| `hpc-master` | | | | | | |
| `hpc-worker1` | | | | | | |
| `hpc-worker2` | | | | | | |
| `hpc-worker3` | | | | | | |

En el resto de la guía, `IP_MASTER`, `IP_W1`, `IP_W2` e `IP_W3` son las IP de
esta tabla.

---

## PASO 1 — Crear las VMs e instalar Debian 13

### 1.1 Crear la VM

En cada PC: VirtualBox → **Nueva**, con los valores de las tablas 1.2 y 1.3, y
como disco óptico la imagen `debian-13.x.x-amd64-netinst.iso`
(descárgala de debian.org; es la misma para las 4).

### 1.2 Instalar Debian 13 (trixie)

Durante el instalador:

| Pantalla | Qué elegir |
|---|---|
| Idioma / país / teclado | Español / Colombia / Latinoamericano |
| Configurar la red | **Automática (DHCP)**: no cambies nada |
| Nombre de la máquina | `hpc-master`, `hpc-worker1`, `hpc-worker2` o `hpc-worker3` |
| Nombre de dominio | vacío |
| Contraseña de root | **vacía** (así tu usuario recibe `sudo` directamente) |
| Usuario | el tuyo (por ejemplo `admin-cluster`), con contraseña |
| Particionado | Guiado, utilizar todo el disco, todo en una partición |
| Selección de programas | **solo** "servidor SSH" y "utilidades estándar del sistema" (sin escritorio) |
| GRUB | Sí, en `/dev/sda` |

### 1.3 Comprobar

▶ Terminal (en cada VM):

```bash
cat /etc/os-release | grep VERSION=      # VERSION="13 (trixie)"
hostname                                  # hpc-master / hpc-worker1 / ...
sudo -v && echo "sudo OK"
```

Si en una VM clonada el nombre quedó repetido:

▶ Terminal:

```bash
sudo hostnamectl set-hostname hpc-worker2      # el que corresponda
```

---

## PASO 2 — Red: usar la IP que da la universidad, sin modificarla

### 2.1 Ver la IP que recibió cada VM

▶ Terminal (en cada VM):

```bash
ip -4 -br addr                      # la interfaz (ej. enp0s3) con su IP de la U
ip route | grep default             # la puerta de enlace de la U
ip link show enp0s3 | grep ether    # la MAC (cópiala en la hoja 1.4)
ping -c2 deb.debian.org             # hay internet
```

Apunta IP y MAC en la **hoja 1.4**. Las 4 VMs deberían estar en la **misma
subred** que los PC de la sala (por ejemplo `10.152.172.x/24`).

> **No edites `/etc/network/interfaces`.** El instalador ya lo dejó en DHCP, que
> es lo correcto. Si aplicaste la versión anterior de esta guía (IP fijas
> `10.10.10.x`), vuelve a DHCP:
>
> ▶ Terminal:
> ```bash
> sudo nano /etc/network/interfaces
> ```
> 📄 Archivo `/etc/network/interfaces` (reemplaza **todo** el contenido; cambia
> `enp0s3` por el nombre que muestra `ip -br link`):
> ```
> auto lo
> iface lo inet loopback
>
> allow-hotplug enp0s3
> iface enp0s3 inet dhcp
> ```
> ▶ Terminal:
> ```bash
> sudo systemctl restart networking && ip -4 -br addr
> ```

### 2.2 Que nodo3 (el gestor) llegue al maestro

▶ Terminal (en `hpc-master`):

```bash
ping -c2 10.154.12.222       # el maestro llega a nodo3
```

Desde **nodo3** hay que comprobar el camino de vuelta (`ping IP_MASTER`):
pídeselo a quien administra las VPS. Si no hay ruta entre la sala y
`10.154.12.0/24` en ese sentido, el gestor no podrá entregar trabajos: hay que
pedirla al CCA antes de seguir.

### 2.3 Que las IP no cambien (recomendado)

El DHCP de la U puede dar otra IP a una VM tras un reinicio largo. Dos formas
de manejarlo, **sin modificar ninguna IP a mano**:

1. **Reservas DHCP (recomendado):** entrega al CCA la tabla de MAC de la hoja
   1.4 y pide que cada MAC reciba siempre la misma IP. Lo configura la U en su
   servidor; para los demás equipos no cambia nada.
2. **Sin reservas:** al empezar cada sesión de laboratorio, comprueba las IP
   (`ip -4 -br addr`) y si alguna cambió aplica el PASO 14.

### 2.4 Nombres de los nodos (`/etc/hosts`) en las 4 VMs

▶ Terminal (en cada VM):

```bash
sudo nano /etc/hosts
```

📄 Archivo `/etc/hosts`: **borra o comenta** la línea `127.0.1.1 <nombre>` que
dejó el instalador (si queda, el nodo se resuelve a sí mismo como loopback y MPI
falla de forma confusa) y añade al final, con las IP de la hoja 1.4:

```
IP_MASTER   hpc-master
IP_W1       hpc-worker1
IP_W2       hpc-worker2
IP_W3       hpc-worker3
```

(Por ejemplo `10.152.172.61   hpc-master`.) Este archivo solo afecta a la VM
donde lo editas: no cambia nada en la red.

▶ Terminal (en `hpc-master`):

```bash
for n in hpc-worker1 hpc-worker2 hpc-worker3; do
  echo -n "$n: "; ping -c1 -W2 $n >/dev/null && echo OK || echo FALLA
done
```

---

## PASO 3 — Usuario `mpiuser` con el MISMO UID en las 4

NFS identifica a los usuarios por número.

▶ Terminal (en las 4 VMs, exactamente igual):

```bash
sudo groupadd -g 5000 mpigroup
sudo useradd -m -u 5000 -g 5000 -s /bin/bash mpiuser
sudo passwd mpiuser
id mpiuser        # uid=5000(mpiuser) gid=5000(mpigroup) en las 4
```

---

## PASO 4 — Paquetes: OpenMPI 5, mpi4py, NFS y Java

▶ Terminal (en las 4 VMs):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y openmpi-bin libopenmpi-dev build-essential python3-mpi4py nfs-common ufw prometheus-node-exporter
mpirun --version          # Open MPI 5.0.x, IDÉNTICA en las 4
```

> ⚠️ La versión de OpenMPI debe ser **idéntica** en las 4 (misma imagen de
> Debian y `apt upgrade` en todas). Versiones distintas dan errores de protocolo.

▶ Terminal (solo en `hpc-master`):

```bash
sudo apt install -y nfs-kernel-server openjdk-21-jre-headless
java -version             # openjdk 21
```

---

## PASO 5 — SSH sin contraseña del maestro a todos

`mpirun` (y `job-runner`, que comprueba los nodos antes de cada trabajo) entra
por SSH a cada nodo.

▶ Terminal (en `hpc-master`):

```bash
sudo -iu mpiuser
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3; do ssh-copy-id mpiuser@$n; done
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3; do
  echo -n "$n: "; ssh -o BatchMode=yes $n hostname
done
exit
```

Los 4 nombres deben salir **sin pedir nada**. No sigas hasta que funcione.

---

## PASO 6 — `/srv/home` compartido por NFS (servido por el maestro)

### 6.1 En `hpc-master`

▶ Terminal:

```bash
sudo mkdir -p /srv/home/.hpc-trabajos
sudo chown -R mpiuser:mpigroup /srv/home
sudo chmod 775 /srv/home
sudo nano /etc/exports
```

📄 Archivo `/etc/exports`: una línea, **solo con las IP de los 3 workers** (nunca
la subred entera de la sala):

```
/srv/home  IP_W1(rw,sync,no_subtree_check) IP_W2(rw,sync,no_subtree_check) IP_W3(rw,sync,no_subtree_check)
```

▶ Terminal:

```bash
sudo exportfs -ra
sudo systemctl enable --now nfs-kernel-server
sudo exportfs -v
```

### 6.2 En los 3 workers

▶ Terminal:

```bash
sudo mkdir -p /srv/home
echo 'hpc-master:/srv/home  /srv/home  nfs4  defaults,_netdev  0  0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /srv/home
df -h /srv/home
```

### 6.3 Prueba de que es compartido

▶ Terminal:

```bash
# en hpc-master
sudo -u mpiuser sh -c 'echo "prueba desde master" > /srv/home/prueba.txt'
# en cualquier worker
cat /srv/home/prueba.txt
```

Si no se ve el texto, **nada de lo que sigue funcionará** (revisa el PASO 8:
el firewall debe dejar entrar a los workers en el maestro).

---

## PASO 7 — `hostfile`

▶ Terminal (en `hpc-master`, como `mpiuser`):

```bash
sudo -iu mpiuser
nano /srv/home/hostfile
```

📄 Archivo `/srv/home/hostfile`, con los **slots de la hoja 1.4** (ejemplo para
VMs de 4 vCPU):

```
hpc-master  slots=3
hpc-worker1 slots=4
hpc-worker2 slots=4
hpc-worker3 slots=4
```

Total del ejemplo: **15 procesos**. Este archivo es para las pruebas a mano;
`job-runner` escribe uno propio en cada trabajo con los nodos que asigna el
planificador (los de `HPC_NODOS`, PASO 12).

Cada VM tiene una sola tarjeta de red, así que OpenMPI no necesita que se le
indique la interfaz.

---

## PASO 8 — Firewall de cada VM

El firewall (`ufw`) va **dentro de cada VM** y solo decide qué conexiones
acepta esa VM. No afecta a la red ni a los demás equipos.

- Entre los 4 nodos: todo permitido (MPI usa puertos TCP altos aleatorios).
- Desde fuera: solo SSH, y en el maestro el gestor (nodo3) y Prometheus (nodo1).

▶ Terminal (en **cada** VM; el `allow 22` va **antes** de activar, para no
perder el acceso):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
for ip in IP_MASTER IP_W1 IP_W2 IP_W3; do sudo ufw allow from $ip; done
sudo ufw allow from 10.154.12.219 to any port 9100 proto tcp     # Prometheus (nodo1)
sudo ufw enable
```

▶ Terminal (además, **solo en `hpc-master`**):

```bash
sudo ufw allow from 10.154.12.222 to any port 2099:2100 proto tcp   # gestor (nodo3)
sudo ufw status numbered
```

(En los `for`, escribe las IP reales de la hoja 1.4, separadas por espacios.)

---

## PASO 9 — Prueba de humo: "Hola Mundo" en MPI

▶ Terminal (en `hpc-master`, como `mpiuser`):

```bash
sudo -iu mpiuser
cat > /srv/home/hola.c <<'EOF'
#include <mpi.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    char hostname[256];
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    gethostname(hostname, sizeof(hostname));
    printf("Proceso %d de %d ejecutandose en %s\n", rank, size, hostname);
    MPI_Finalize();
    return 0;
}
EOF
cd /srv/home && mpicc hola.c -o hola.bin
mpirun --hostfile /srv/home/hostfile -np 8 /srv/home/hola.bin
```

(Aquí el bloque `cat > … <<'EOF'` **sí** se pega en la terminal: crea el
archivo de una vez.)

Deben aparecer **los 4 nombres** (`hpc-master`, `hpc-worker1..3`). El orden
varía: corren en paralelo. Guarda la salida como evidencia.

---

## PASO 10 — Prueba de comunicación entre nodos

▶ Terminal (en `hpc-master`, como `mpiuser`):

```bash
cat > /srv/home/suma.c <<'EOF'
#include <mpi.h>
#include <stdio.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    int valor_local = rank + 1, suma_total = 0;
    MPI_Reduce(&valor_local, &suma_total, 1, MPI_INT, MPI_SUM, 0, MPI_COMM_WORLD);
    if (rank == 0)
        printf("Suma de 1..%d entre %d procesos = %d (esperado %d)\n",
               size, size, suma_total, size * (size + 1) / 2);
    MPI_Finalize();
    return 0;
}
EOF
cd /srv/home && mpicc suma.c -o suma.bin
mpirun --hostfile /srv/home/hostfile -np 8 /srv/home/suma.bin
mpirun --hostfile /srv/home/hostfile -np 4 \
  python3 -c "from mpi4py import MPI; c=MPI.COMM_WORLD; print(c.rank, MPI.Get_processor_name())"
```

Si la suma coincide con el esperado, los nodos se comunican; la última línea
comprueba Python (lo usan los trabajos `.py`).

---

## PASO 11 — Prueba de tolerancia a fallos

1. Lanza un trabajo largo (añade `sleep(60);` antes de `MPI_Finalize()`).
2. Desde otra terminal: `ssh hpc-worker3 sudo poweroff` (o apaga esa VM en VirtualBox).
3. OpenMPI **aborta el trabajo completo** al perder un nodo.

Con el servicio integrado (PASO 12), el gestor marca el nodo como caído y
**reencola el trabajo** en los nodos sanos (`hpc_nodos_en_falla_total` sube en
Grafana). Documenta las dos cosas: justifican checkpointing y un maestro
secundario como mejoras futuras.

---

## PASO 12 — Conectar el clúster con el servicio HPC

### 12.1 `job-runner` en `hpc-master`

Desde el PC de desarrollo (conectado a la red de la U), copia el `.jar` y los
ejemplos (`<usuario>` es tu usuario de la VM):

▶ Terminal (PowerShell del PC de desarrollo, en la raíz del monorepo; el `.jar`
se compila con `mvn -f RMIUPBCientifica\pom.xml package -DskipTests`):

```powershell
scp RMIUPBCientifica\job-runner\target\job-runner.jar <usuario>@IP_MASTER:/tmp/
scp -r RMIUPBCientifica\job-runner\ejemplos <usuario>@IP_MASTER:/tmp/
```

▶ Terminal (en `hpc-master`):

```bash
sudo install -d /opt/upbc
sudo install -m 644 /tmp/job-runner.jar /opt/upbc/job-runner.jar
sudo -u mpiuser cp -r /tmp/ejemplos /srv/home/ejemplos
sudo nano /etc/default/upbc-job-runner
```

📄 Archivo `/etc/default/upbc-job-runner`:

```
# Registry 2099 y objeto 2100 (los que espera el gestor en nodo3)
RUNNER_PUERTO_REGISTRY=2099
RUNNER_PUERTO_OBJETO=2100
DIR_TRABAJOS=/srv/home/.hpc-trabajos
MAX_RESULTADOS_MB=200
```

▶ Terminal:

```bash
sudo nano /etc/systemd/system/upbc-job-runner.service
```

📄 Archivo `/etc/systemd/system/upbc-job-runner.service` (cambia `IP_MASTER`
por la IP real del maestro):

```
[Unit]
Description=UPB-CIENTIFICA - job-runner (MPI, RMI 2099/2100)
After=network-online.target nfs-server.service
Wants=network-online.target

[Service]
User=mpiuser
Group=mpigroup
WorkingDirectory=/srv/home
EnvironmentFile=/etc/default/upbc-job-runner
# La IP con la que el gestor (nodo3) llama al maestro.
ExecStart=/usr/bin/java -Xmx512m -Djava.rmi.server.hostname=IP_MASTER -jar /opt/upbc/job-runner.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

▶ Terminal:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now upbc-job-runner
journalctl -u upbc-job-runner -n 5 --no-pager     # "[job-runner] Listo. Registry 2099, objeto 2100"
```

> `-Djava.rmi.server.hostname` **debe** ser la IP del maestro en la red de la U:
> RMI le dice al gestor "llámame a esta dirección".

### 12.2 El gestor en `pasd_nodo3`

En nodo3 (lo hace quien administra las VPS), `/etc/upbc/gestor-cluster.env`
hoy apunta a `127.0.0.1:2199`, donde no hay nadie:

▶ Terminal (en nodo3):

```bash
sudo nano /etc/upbc/gestor-cluster.env
```

📄 Cambia estas líneas del archivo:

```
EJECUTOR_HOST=IP_MASTER
EJECUTOR_PUERTO=2099
# nombre:procesos de cada nodo = los slots del hostfile (hoja 1.4)
HPC_NODOS=hpc-master:3,hpc-worker1:4,hpc-worker2:4,hpc-worker3:4
HPC_MAX_PROCESOS=15
```

▶ Terminal (en nodo3):

```bash
nc -zv IP_MASTER 2099                  # debe decir "succeeded"
sudo systemctl restart upbc-gestor-cluster
journalctl -u upbc-gestor-cluster -n 5 --no-pager
```

Los nombres de `HPC_NODOS` los resuelve el **clúster** (van al `hostfile` que
escribe `job-runner`), no nodo3: no hace falta añadirlos al `/etc/hosts` de nodo3.

### 12.3 Prueba de punta a punta

1. Entra al portal `https://10.154.12.219` como `investigador` / `test`.
2. Sube `pi.c` (de `RMIUPBCientifica/job-runner/ejemplos/`) a "Mis archivos".
3. En **HPC**, la tarjeta del clúster debe decir **job-runner en línea** y
   mostrar los 4 nodos.
4. Envía un trabajo con `pi.c`, 8 procesos. Debe pasar por EN_COLA → EJECUTANDO
   → COMPLETADO y dejar `salida.txt` en "Resultados HPC/" de tu Home, con
   procesos en varios nodos.
5. Con `estudiante` / `test` la sección HPC debe responder **403** (el perfil
   estudiantes no tiene el servicio `hpc`).

### 12.4 Equipos externos de la malla (Grid)

Un equipo nuevo se suma con `POST /cluster/nodos {"host": "...",
"capacidadProcesos": N}` (perfil con `hpcadmin`). Debe prepararse igual que un
worker: VM o equipo Debian 13 en la misma red, PASOS 2.4 a 8 (`/etc/hosts` en
todos los nodos, `mpiuser` con UID 5000, la misma versión de OpenMPI, la llave
SSH del maestro, `/srv/home` montado, su IP añadida a `/etc/exports` y al
firewall).

---

## PASO 13 — Monitoreo

Prometheus está en `pasd_nodo1`. Ya recoge del gestor (nodo3, `:9102`) la cola,
los trabajos, los procesos en uso y el estado de cada nodo (`hpc_nodos{estado}`).

Las 4 VMs ya tienen `prometheus-node-exporter` (PASO 4) y su firewall deja
entrar a nodo1 en el 9100 (PASO 8). Quien administra las VPS añade los
objetivos en `/etc/prometheus/prometheus.yml` de nodo1, trabajo `nodos`:

📄 Líneas a añadir en el trabajo `nodos`:

```yaml
      - { targets: ['IP_MASTER:9100'], labels: { nodo: hpc-master } }
      - { targets: ['IP_W1:9100', 'IP_W2:9100', 'IP_W3:9100'], labels: { nodo: hpc-worker } }
```

▶ Terminal (en nodo1):

```bash
curl -X POST http://127.0.0.1:9095/-/reload
```

---

## PASO 14 — Si cambia la IP de alguna VM

Solo pasa sin reservas DHCP (PASO 2.3). Ninguna IP se cambia a mano: se
actualiza **dónde está escrita**.

| Dónde | Qué actualizar |
|---|---|
| `/etc/hosts` de las 4 VMs | la línea del nodo que cambió |
| `/etc/exports` del maestro (si cambió un worker) | su IP; luego `sudo exportfs -ra` |
| `ufw` de las 4 VMs | `sudo ufw allow from <IP nueva>` y borrar la vieja (`sudo ufw status numbered` → `sudo ufw delete N`) |
| Si cambió el **maestro** | `ExecStart` de `upbc-job-runner.service` (`daemon-reload` + `restart`), `EJECUTOR_HOST` en nodo3 (restart del gestor) y el objetivo de Prometheus |

---

## PASO 15 — Checklist de validación

- [ ] Permiso del CCA para conectar las 4 VMs (y reservas DHCP, si las dieron)
- [ ] Ninguna IP fija: las 4 VMs usan DHCP; los PC anfitriones siguen igual
- [ ] Cada VM con **un solo** adaptador, en **puente** sobre el Ethernet, modo promiscuo **Denegar**, MAC única
- [ ] Hoja 1.4 completa (IP, MAC, vCPU, RAM y slots de cada nodo)
- [ ] Las 4 tienen Debian 13 y la **misma** versión de OpenMPI (`mpirun --version`)
- [ ] `ping` por **nombre** entre los 4; no hay `127.0.1.1 <nombre>` en `/etc/hosts`
- [ ] `id mpiuser` da UID 5000 / GID 5000 en las 4
- [ ] `ssh <nodo> hostname` funciona **sin contraseña** desde el maestro (como `mpiuser`) a los 4
- [ ] `/etc/exports` solo con las IP de los 3 workers; `/srv/home` montado en los 3 (en `/etc/fstab`)
- [ ] `ufw` activo en las 4: los nodos entre sí, 9100 solo desde 10.154.12.219, y en el maestro 2099/2100 solo desde 10.154.12.222
- [ ] `hola.bin` muestra los 4 nombres; `suma.bin` da el resultado esperado; mpi4py funciona
- [ ] `upbc-job-runner` activo; desde nodo3 `nc -zv IP_MASTER 2099` responde
- [ ] El portal muestra "job-runner en línea" y un trabajo con `pi.c` termina en COMPLETADO
- [ ] Se probó qué pasa al caer un worker (PASO 11)
- [ ] Las 4 VMs aparecen `up` en Prometheus y Grafana muestra la carga del clúster

---

## PASO 16 — Errores frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `auto: command not found` (o similar) al pegar un bloque | Se pegó un **📄 Archivo** en la terminal | Abrirlo con `sudo nano <ruta>` y escribirlo dentro |
| La VM no recibe IP | Puente sobre la tarjeta equivocada (Wi-Fi / Host-Only) o la red bloquea MAC nuevas | Revisar la tabla 1.3; consultar al CCA |
| Dos VMs se quedan sin red a ratos | MAC repetida tras clonar | Regenerar la MAC del clon (VirtualBox → Red → Avanzadas → botón de MAC) |
| `mpirun` pide contraseña o se cuelga al empezar | Llaves SSH | PASO 5; probar `ssh -o BatchMode=yes <nodo>` como `mpiuser` |
| `mpirun` se cuelga sin mensaje | Firewall de algún nodo bloquea a otro | PASO 8: `ufw allow from` con la IP de cada nodo |
| `No such file or directory` en los workers | El binario no está en `/srv/home` o el NFS no está montado | `df -h /srv/home` en cada worker |
| `mount.nfs: access denied` | La IP del worker no está en `/etc/exports` | PASO 6.1 y `sudo exportfs -ra` |
| `Permission denied` en `/srv/home` | UID/GID distintos | `id mpiuser` en los 4 |
| `There are not enough slots available` | Más procesos que slots | Bajar `-np` o revisar `HPC_NODOS` / `hostfile` |
| Error de protocolo entre nodos | Versiones distintas de OpenMPI | Misma imagen de Debian y `apt upgrade` en los 4 |
| `mpirun` se niega a arrancar | Se ejecutó como root | Ejecutar como `mpiuser` |
| El portal dice "job-runner desconectado" | nodo3 no llega a `IP_MASTER:2099/2100` | `nc -zv IP_MASTER 2099` desde nodo3; ufw del maestro; `EJECUTOR_HOST` |
| El gestor conecta al Registry pero falla al llamar | `java.rmi.server.hostname` no es la IP del maestro | Corregir el `.service` del PASO 12.1 |
| Todo falló tras un reinicio | El DHCP dio otras IP | PASO 14 (y pedir reservas DHCP) |
| Trabajo FALLIDO con "nodo caído" | Una VM apagada o el anfitrión suspendido | El gestor lo reencola en los demás; encender la VM, quitar la suspensión |

---

## PASO 17 — Qué documentar para el informe

1. La hoja 1.4 (hardware de cada anfitrión, recursos de cada VM, IP y slots).
2. `mpirun --version` en los 4 nodos (homogeneidad).
3. Salidas de `hola.bin` (4 nombres) y `suma.bin` (resultado correcto).
4. `hostfile` y `HPC_NODOS`.
5. La prueba de caída de un worker (PASO 11), a mano y con el servicio.
6. Un trabajo enviado desde el portal hasta "Resultados HPC/" (PASO 12.3).
7. Grafana durante un trabajo: cola, procesos en uso, tiempos de ejecución.
8. Las tres diferencias con el diagrama (sección 0) y las reglas de red que se
   siguieron.

---

## Anexo — Ajustes pendientes en la documentación del proyecto

1. **Número de workers:** el profesor pidió mínimo 4 workers; este montaje tiene
   3 + el maestro calculando. Confirmar con el profesor o añadir una VM.
2. **Nodos virtuales y NFS del clúster:** el diagrama de despliegue v2 muestra
   máquinas físicas y `/srv/home` desde `node-repository`; en el laboratorio son
   VMs sobre los PC de la sala y `/srv/home` lo sirve `hpc-master`. Actualizar
   el diagrama y `docs/TRASPASO.md`.
3. **Versiones:** el diagrama dice Debian 12 / OpenMPI 4.1 / OpenJDK 17; el
   clúster real usa Debian 13 / OpenMPI 5.0 / OpenJDK 21.
4. **Identidad de los trabajos:** siguen corriendo como `mpiuser` (RF-20 pide la
   identidad real: nodos como clientes LDAP de node-soap).
5. **Terminología:** "un clúster de 4 nodos", nunca "4 clústeres".
