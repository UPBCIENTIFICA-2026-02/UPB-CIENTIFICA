# Guía de montaje del Clúster HPC — UPB-CIENTÍFICA

Guía paso a paso para montar el clúster MPI en la sala del laboratorio y
conectarlo con los servicios que **ya están desplegados** en las VPS
(`pasd_nodo1..3`).

> Para practicar en tu PC antes del laboratorio, los mismos pasos están
> automatizados con VirtualBox en [`Guia_Cluster_VirtualBox_Local.md`](Guia_Cluster_VirtualBox_Local.md)
> (scripts de `despliegue/cluster-virtualbox/`).
>
> Última revisión: 2026-10-13. Clúster de **4 máquinas con Debian 13** (1 maestro
> + 3 workers) en un **switch aislado**; servicios ya desplegados en las VPS.

---

## 0. Punto de partida y qué vamos a montar

### Lo que ya funciona (no se toca en esta guía, salvo lo indicado)

| VPS | IP | Servicios |
|---|---|---|
| `pasd_nodo1` | 10.154.12.219 | node-soap (8081) + OpenLDAP, node-web (443), Prometheus + Grafana |
| `pasd_nodo2` | 10.154.12.221 | Storage (8084), Shared File (8085), node-sync (9090), PostgreSQL |
| `pasd_nodo3` | 10.154.12.222 | node-media (8083), **gestor del clúster** (RMI 2099/2100, métricas 9102) y **job-api** (8082) |

Hoy el gestor responde "job-runner desconectado": falta exactamente lo que monta
esta guía. Al terminar, un usuario envía código + dataset desde la web, el
escritorio o el móvil; el gestor (nodo3) los baja de Storage y se los pasa por
RMI a `job-runner` en `hpc-master`, que compila y lanza `mpirun` en el clúster.

### Lo que vamos a montar

**Un solo clúster de 4 máquinas** (un clúster es el conjunto; los nodos son las
máquinas):

| Rol | Nombre | Interfaz al switch del clúster | Interfaz a la red del laboratorio |
|---|---|---|---|
| Maestro (coordina **y** calcula) | `hpc-master` | 10.10.10.1 | IP de la red cableada (ej. 10.152.172.X) |
| Worker 1 | `hpc-worker1` | 10.10.10.11 | — |
| Worker 2 | `hpc-worker2` | 10.10.10.12 | — |
| Worker 3 | `hpc-worker3` | 10.10.10.13 | — |

```
   Red cableada del laboratorio  ──────────  VPS pasd_nodo1..3 (10.154.12.x)
              │ (2ª interfaz)
        ┌─────┴──────┐
        │ hpc-master │  job-runner (RMI 2099/2100), NFS /srv/home, OpenMPI
        └─────┬──────┘
              │ 10.10.10.1
      ┌───────┴──────── switch aislado (10.10.10.0/24) ───────┐
 hpc-worker1 (.11)      hpc-worker2 (.12)      hpc-worker3 (.13)
```

> ⚠️ **Diferencias con el diagrama de despliegue v2** (anótalas en el informe):
> 1. **Workers:** el diagrama y la indicación del profesor piden **mínimo 4
>    workers**; aquí hay 3. Para tener 4 nodos de cómputo, el maestro también
>    ejecuta procesos (entra en el `hostfile`). Si el profesor exige 4 workers
>    *además* del maestro, hace falta una quinta máquina: los pasos son los
>    mismos que para cualquier worker.
> 2. **NFS:** el diagrama dibuja `/srv/home` exportado desde `node-repository`.
>    Con el clúster aislado, `/srv/home` lo exporta **el maestro** a los workers.
>    No se pierde nada: el código y el dataset le llegan a `job-runner` por RMI
>    (el gestor los baja de Storage con el token del usuario) y el resultado
>    vuelve al Home del usuario por la API de Storage. En el clúster, `/srv/home`
>    es solo el **espacio de trabajo compartido** que MPI necesita.
> 3. **Debian 13** en vez de Debian 12: trae **OpenMPI 5.0** (no 4.1) y
>    **OpenJDK 21** (no 17). `job-runner.jar` está compilado para Java 17 y corre
>    igual en 21.

### Qué hay en cada máquina

**hpc-master:** Debian 13, OpenMPI 5, OpenJDK 21, servidor NFS (`/srv/home`),
`hostfile`, `job-runner.jar` (servicio `systemd`), `node_exporter`.

**hpc-worker1..3:** Debian 13, OpenMPI 5 (`libmpi.so`), `python3-mpi4py`,
cliente NFS. El ejecutable del trabajo (`programa`) no se instala: vive en
`/srv/home/.hpc-trabajos/<id>/`, compartido.

**Conexiones**

| Origen → destino | Puerto | Para qué |
|---|---|---|
| `hpc-master` → workers | SSH 22 | `mpirun` arranca los procesos remotos |
| todos ↔ todos (switch) | TCP altos | comunicación MPI entre procesos |
| workers → `hpc-master` | NFSv4 2049 | `/srv/home` |
| `pasd_nodo3` (gestor) → `hpc-master` | RMI **2099** (Registry) y **2100** (objeto) | entrega de trabajos y consulta de estado |
| `pasd_nodo1` (Prometheus) → `hpc-master` | 9100 | métricas del nodo (PASO 14) |

Usuario de ejecución MPI: **`mpiuser`** (UID/GID 5000). OpenMPI no corre como root.

---

## PASO 1 — Instalar Debian 13 en las 4 máquinas

1. Instala **Debian 13 (trixie)**, instalación mínima: en "Selección de
   programas" marca solo **servidor SSH** y **utilidades estándar** (sin
   escritorio).
2. Nombres de host: `hpc-master`, `hpc-worker1`, `hpc-worker2`, `hpc-worker3`.
   Si ya están instaladas: `sudo hostnamectl set-hostname hpc-worker1`.
3. Si en la instalación pusiste contraseña de **root**, tu usuario no tendrá
   `sudo`. Arréglalo una vez en cada máquina:
   ```bash
   su -
   apt install -y sudo
   usermod -aG sudo <tu-usuario>
   exit        # y vuelve a iniciar sesión
   ```
4. Comprueba la versión: `cat /etc/os-release` → `VERSION="13 (trixie)"`.

> Instala las 4 **conectadas a la red del laboratorio** (con internet) para que
> el instalador y `apt` funcionen. En el PASO 2 los workers pasan al switch
> aislado; si después necesitan internet, salen por el maestro (PASO 2.4).

---

## PASO 2 — Red: switch aislado + segunda interfaz del maestro

### 2.1 Conexiones físicas

- Las 4 máquinas a un **switch** propio, sin conexión a la red del laboratorio.
- `hpc-master` con una **segunda tarjeta de red** (puede ser un adaptador
  USB-Ethernet) conectada a la red cableada del laboratorio, la misma desde la
  que se alcanzan las VPS.

Mira los nombres de las interfaces con `ip -br link` (en Debian 13 son tipo
`enp1s0`, `enp2s0`, `enx…` para USB).

### 2.2 Direcciones fijas (Debian 13 usa `/etc/network/interfaces`)

**En `hpc-master`** (ejemplo: `enp1s0` = switch, `enp2s0` = laboratorio):

```bash
sudo nano /etc/network/interfaces
```
```
auto lo
iface lo inet loopback

# Red del laboratorio: por aquí llegan el gestor (nodo3) y Prometheus (nodo1)
auto enp2s0
iface enp2s0 inet dhcp

# Switch aislado del clúster
auto enp1s0
iface enp1s0 inet static
    address 10.10.10.1/24
```

> Pide a quien administra la red del laboratorio que la IP de `enp2s0` sea
> **fija** (reserva DHCP o estática): el gestor de nodo3 se conecta a ella.
> En esta guía la llamamos `IP_MASTER_LAB`.

**En cada worker** (una sola interfaz, al switch; cambia `.11` por `.12`, `.13`):

```
auto lo
iface lo inet loopback

auto enp1s0
iface enp1s0 inet static
    address 10.10.10.11/24
    gateway 10.10.10.1
    dns-nameservers 1.1.1.1
```

Aplica con `sudo systemctl restart networking` (o reinicia) y comprueba con
`ip -br addr`.

### 2.3 Nombres (`/etc/hosts`) en las 4 máquinas

```
10.10.10.1    hpc-master
10.10.10.11   hpc-worker1
10.10.10.12   hpc-worker2
10.10.10.13   hpc-worker3
```

> **Importante:** borra o comenta la línea `127.0.1.1 <nombre>` que deja el
> instalador. Si queda, el nodo se resuelve a sí mismo como loopback y MPI falla
> de forma confusa.

Desde el maestro:

```bash
for n in hpc-worker1 hpc-worker2 hpc-worker3; do
  echo -n "$n: "; ping -c1 -W2 $n >/dev/null && echo OK || echo FALLA
done
```

### 2.4 (Opcional) Internet para los workers a través del maestro

Solo si los workers necesitan `apt` después de pasar al switch. En `hpc-master`:

```bash
sudo apt install -y nftables
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/90-nat.conf && sudo sysctl --system
sudo tee /etc/nftables.conf >/dev/null <<'EOF'
#!/usr/sbin/nft -f
flush ruleset
table ip nat {
  chain postrouting {
    type nat hook postrouting priority 100;
    ip saddr 10.10.10.0/24 oifname "enp2s0" masquerade
  }
}
EOF
sudo systemctl enable --now nftables
```

Cuando el clúster esté terminado puedes desactivarlo (`sudo systemctl disable
--now nftables`) para que los workers queden totalmente aislados.

### 2.5 Comprobar que el gestor llega al maestro

Desde **`pasd_nodo3`** (el gestor), a la IP de laboratorio del maestro:

```bash
ping -c2 IP_MASTER_LAB
```

Si no responde, la red de la universidad no enruta entre `10.154.12.0/24` y la
sala: pídeselo a quien administra la red **antes de seguir** (sin esa ruta el
gestor no puede entregar trabajos).

---

## PASO 3 — Usuario `mpiuser` con el MISMO UID en las 4

NFS identifica a los usuarios por número. **En las 4 máquinas**, exactamente igual:

```bash
sudo groupadd -g 5000 mpigroup
sudo useradd -m -u 5000 -g 5000 -s /bin/bash mpiuser
sudo passwd mpiuser
id mpiuser        # uid=5000(mpiuser) gid=5000(mpigroup) en las 4
```

---

## PASO 4 — Paquetes: OpenMPI 5, mpi4py, NFS y Java

**En las 4 máquinas:**

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y openmpi-bin libopenmpi-dev build-essential python3-mpi4py nfs-common
mpirun --version          # Open MPI 5.0.x, IDÉNTICA en las 4
ldconfig -p | grep libmpi.so
```

> ⚠️ La versión de OpenMPI debe ser **idéntica** en las 4 (misma versión de
> Debian y `apt upgrade` en todas). Versiones distintas dan errores de protocolo.

**Solo en `hpc-master`:**

```bash
sudo apt install -y nfs-kernel-server openjdk-21-jre-headless prometheus-node-exporter
java -version             # openjdk 21
```

---

## PASO 5 — SSH sin contraseña del maestro a todos

`mpirun` (y `job-runner`, que comprueba los nodos antes de cada trabajo) entra
por SSH a cada nodo. **En `hpc-master`, como `mpiuser`:**

```bash
sudo -iu mpiuser
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3; do ssh-copy-id mpiuser@$n; done
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3; do
  echo -n "$n: "; ssh -o BatchMode=yes $n hostname
done
```

Los 4 nombres deben salir **sin pedir nada**. Este es el punto donde más se
atasca la gente: no sigas hasta que funcione.

---

## PASO 6 — `/srv/home` compartido por NFS (servido por el maestro)

**6.1 — En `hpc-master`:**

```bash
sudo mkdir -p /srv/home/.hpc-trabajos
sudo chown -R mpiuser:mpigroup /srv/home
sudo chmod 775 /srv/home
echo '/srv/home  10.10.10.0/24(rw,sync,no_subtree_check)' | sudo tee /etc/exports
sudo exportfs -ra
sudo systemctl enable --now nfs-kernel-server
sudo exportfs -v
```

La exportación es **solo para el switch** (10.10.10.0/24), nunca para la red
del laboratorio.

**6.2 — En los 3 workers:**

```bash
sudo mkdir -p /srv/home
echo 'hpc-master:/srv/home  /srv/home  nfs4  defaults,_netdev  0  0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /srv/home
df -h /srv/home
```

**6.3 — Prueba de que es compartido:**

```bash
# en hpc-master
sudo -u mpiuser sh -c 'echo "prueba desde master" > /srv/home/prueba.txt'
# en cualquier worker
cat /srv/home/prueba.txt
```

Si no se ve el texto, **nada de lo que sigue funcionará**.

---

## PASO 7 — `hostfile` y la interfaz de red de MPI

**7.1 — Núcleos de cada nodo:**

```bash
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3; do echo -n "$n: "; ssh $n nproc; done
```

**7.2 — `hostfile`** (como `mpiuser`, en `/srv/home/hostfile`). Ejemplo con 4
núcleos por máquina:

```
hpc-master  slots=2
hpc-worker1 slots=4
hpc-worker2 slots=4
hpc-worker3 slots=4
```

El maestro entra con menos slots porque también corre `job-runner` y el NFS.
Total del ejemplo: **14 procesos**. Este archivo es para las pruebas a mano;
`job-runner` escribe uno propio en cada trabajo con los nodos que le asigna el
planificador (los de `HPC_NODOS`, PASO 12).

**7.3 — Que MPI use solo el switch.** El maestro tiene dos interfaces; si OpenMPI
intenta comunicarse por la del laboratorio, los workers no la alcanzan y
`mpirun` se cuelga. **En las 4 máquinas:**

```bash
echo 'btl_tcp_if_include = 10.10.10.0/24' | sudo tee -a /etc/openmpi/openmpi-mca-params.conf
```

Y para el arranque de procesos (PRRTE, el lanzador de OpenMPI 5), en las pruebas
a mano añade `--prtemca oob_tcp_if_include 10.10.10.0/24` a `mpirun` (el
`job-runner` lo lleva en `MPIRUN_OPCIONES`, PASO 12).

---

## PASO 8 — Firewall

- **Switch del clúster:** sin firewall entre los 4 (red aislada; MPI usa puertos
  TCP altos aleatorios).
- **Interfaz del laboratorio de `hpc-master`:** solo lo imprescindible.

**En `hpc-master`:**

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw allow in on enp1s0                                              # switch del clúster: todo
sudo ufw allow in on enp2s0 to any port 22 proto tcp                     # administración
sudo ufw allow in on enp2s0 from 10.154.12.222 to any port 2099:2100 proto tcp   # gestor (nodo3)
sudo ufw allow in on enp2s0 from 10.154.12.219 to any port 9100 proto tcp        # Prometheus (nodo1)
sudo ufw enable
sudo ufw status verbose
```

> Si activaste el NAT del PASO 2.4, ufw bloquea el reenvío por defecto: añade
> `sudo ufw route allow in on enp1s0 out on enp2s0`.

Los workers no necesitan firewall: no tienen interfaz fuera del switch.

---

## PASO 9 — Prueba de humo: "Hola Mundo" en MPI

**En `hpc-master`, como `mpiuser`:**

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
mpirun --hostfile /srv/home/hostfile --prtemca oob_tcp_if_include 10.10.10.0/24 -np 8 /srv/home/hola.bin
```

Deben aparecer **los 4 nombres** (`hpc-master`, `hpc-worker1..3`). El orden
varía: corren en paralelo. Guarda la salida como evidencia.

---

## PASO 10 — Prueba de comunicación entre nodos

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
mpirun --hostfile /srv/home/hostfile --prtemca oob_tcp_if_include 10.10.10.0/24 -np 8 /srv/home/suma.bin
```

Si el resultado coincide con el esperado, los nodos se comunican por el switch.
Prueba también Python (lo usan los trabajos `.py`):

```bash
mpirun --hostfile /srv/home/hostfile --prtemca oob_tcp_if_include 10.10.10.0/24 -np 4 \
  python3 -c "from mpi4py import MPI; c=MPI.COMM_WORLD; print(c.rank, MPI.Get_processor_name())"
```

---

## PASO 11 — Prueba de tolerancia a fallos

1. Lanza un trabajo largo (añade `sleep(60);` antes de `MPI_Finalize()`).
2. Desde otra terminal: `ssh hpc-worker3 sudo poweroff`.
3. OpenMPI **aborta el trabajo completo** al perder un nodo.

Con el servicio ya integrado (PASO 12), el gestor marca ese nodo como caído y
**reencola el trabajo** en los nodos sanos (`hpc_nodos_en_falla_total` sube en
Grafana). Documenta las dos cosas: justifican checkpointing y un maestro
secundario como mejoras futuras.

---

## PASO 12 — Conectar el clúster con el servicio HPC

### 12.1 `job-runner` en `hpc-master`

Desde el PC de desarrollo (red cableada), copia el `.jar` y los ejemplos:

```powershell
# PowerShell, en la raíz del monorepo (el .jar ya compilado: mvn -f RMIUPBCientifica\pom.xml package -DskipTests)
scp RMIUPBCientifica\job-runner\target\job-runner.jar <usuario>@IP_MASTER_LAB:/tmp/
scp -r RMIUPBCientifica\job-runner\ejemplos <usuario>@IP_MASTER_LAB:/tmp/
```

En `hpc-master`:

```bash
sudo install -d -o root -g root /opt/upbc
sudo install -m 644 /tmp/job-runner.jar /opt/upbc/job-runner.jar
sudo -u mpiuser cp -r /tmp/ejemplos /srv/home/ejemplos

sudo tee /etc/default/upbc-job-runner >/dev/null <<'EOF'
# Registry 2099 y objeto 2100 (los que espera el gestor en nodo3)
RUNNER_PUERTO_REGISTRY=2099
RUNNER_PUERTO_OBJETO=2100
DIR_TRABAJOS=/srv/home/.hpc-trabajos
# MPI solo por el switch del clúster (el maestro tiene dos interfaces)
MPIRUN_OPCIONES=--mca btl_tcp_if_include 10.10.10.0/24 --prtemca oob_tcp_if_include 10.10.10.0/24
MAX_RESULTADOS_MB=200
EOF

sudo tee /etc/systemd/system/upbc-job-runner.service >/dev/null <<'EOF'
[Unit]
Description=UPB-CIENTIFICA - job-runner (MPI, RMI 2099/2100)
After=network-online.target nfs-server.service
Wants=network-online.target

[Service]
User=mpiuser
Group=mpigroup
WorkingDirectory=/srv/home
EnvironmentFile=/etc/default/upbc-job-runner
# La IP de LABORATORIO del maestro: es la que el gestor (nodo3) puede alcanzar.
ExecStart=/usr/bin/java -Xmx256m -Djava.rmi.server.hostname=IP_MASTER_LAB -jar /opt/upbc/job-runner.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo sed -i "s/IP_MASTER_LAB/$(ip -4 -br addr show enp2s0 | awk '{print $3}' | cut -d/ -f1)/" \
  /etc/systemd/system/upbc-job-runner.service
sudo systemctl daemon-reload
sudo systemctl enable --now upbc-job-runner
journalctl -u upbc-job-runner -n 5 --no-pager     # "[job-runner] Listo. Registry 2099, objeto 2100"
```

> `-Djava.rmi.server.hostname` **debe** ser la IP de laboratorio: RMI le dice al
> gestor "llámame a esta dirección", y si fuera 10.10.10.1 el gestor (fuera del
> switch) no podría conectarse.

### 12.2 El gestor en `pasd_nodo3`

Edita `/etc/upbc/gestor-cluster.env` en nodo3 (hoy apunta a `127.0.0.1:2199`,
donde no hay nadie):

```bash
sudo nano /etc/upbc/gestor-cluster.env
```
```
EJECUTOR_HOST=IP_MASTER_LAB
EJECUTOR_PUERTO=2099
# nombre:procesos de cada nodo, los MISMOS nombres que resuelve el clúster
HPC_NODOS=hpc-master:2,hpc-worker1:4,hpc-worker2:4,hpc-worker3:4
HPC_MAX_PROCESOS=14
```

```bash
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
"capacidadProcesos": N}` (perfil con `hpcadmin`). Como el clúster está aislado,
el equipo debe **conectarse al switch** y prepararse igual que un worker
(PASOS 2.3–6: `/etc/hosts`, `mpiuser` con UID 5000, OpenMPI 5 de la misma
versión, llave SSH del maestro y `/srv/home` montado). Un equipo fuera del
switch no puede participar en un `mpirun` del clúster.

---

## PASO 13 — Checklist de validación

- [ ] Las 4 máquinas tienen Debian 13 y la **misma** versión de OpenMPI (`mpirun --version`)
- [ ] `hpc-master` tiene IP fija en la red del laboratorio y 10.10.10.1 en el switch
- [ ] `ping` por **nombre** funciona entre los 4; no hay `127.0.1.1 <nombre>` en `/etc/hosts`
- [ ] `id mpiuser` da UID 5000 / GID 5000 en las 4
- [ ] `ssh <nodo> hostname` funciona **sin contraseña** desde el maestro (como `mpiuser`) a los 4
- [ ] `/srv/home` montado en los 3 workers (está en `/etc/fstab`) y un archivo se ve en todos
- [ ] `btl_tcp_if_include = 10.10.10.0/24` en `/etc/openmpi/openmpi-mca-params.conf` de los 4
- [ ] `hola.bin` muestra los 4 nombres; `suma.bin` da el resultado esperado; mpi4py funciona
- [ ] `ufw` en `hpc-master`: 2099/2100 solo desde 10.154.12.222 y 9100 solo desde 10.154.12.219
- [ ] `upbc-job-runner` activo y el gestor de nodo3 apunta a `IP_MASTER_LAB:2099`
- [ ] El portal muestra "job-runner en línea" y un trabajo con `pi.c` termina en COMPLETADO
- [ ] Se probó qué pasa al caer un worker (PASO 11)
- [ ] `hpc-master` aparece `up` en Prometheus y Grafana muestra la carga del clúster

---

## PASO 14 — Monitoreo

Prometheus está en `pasd_nodo1`. Ya recoge del gestor (nodo3, `:9102`) la cola,
los trabajos, los procesos en uso y el estado de cada nodo (`hpc_nodos{estado}`,
calculado por `job-runner`, que comprueba los nodos por SSH antes de cada
trabajo).

**Nodo maestro:** `prometheus-node-exporter` ya quedó instalado (PASO 4) y el
firewall deja entrar a nodo1 (PASO 8). En `pasd_nodo1` hay que añadir el
objetivo en `/etc/prometheus/prometheus.yml`, trabajo `nodos`:

```yaml
      - { targets: ['IP_MASTER_LAB:9100'], labels: { nodo: hpc-master } }
```

y recargar: `curl -X POST http://127.0.0.1:9095/-/reload`.

**Workers:** están aislados y Prometheus no los alcanza. Si quieres su CPU y
memoria en Grafana, instala `prometheus-node-exporter` en ellos y publícalos a
través del maestro con nftables (DNAT de `IP_MASTER_LAB:9111..9113` a
`10.10.10.11..13:9100`, abriendo esos puertos en ufw solo para 10.154.12.219).
Sin eso, su estado se ve igual en el tablero por `hpc_nodos` (en línea / caído).

---

## PASO 15 — Errores frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `mpirun` pide contraseña o se cuelga al empezar | Llaves SSH | PASO 5; probar `ssh -o BatchMode=yes <nodo>` como `mpiuser` |
| `mpirun` se cuelga sin mensaje | OpenMPI usa la interfaz del laboratorio del maestro | PASO 7.3: `btl_tcp_if_include` y `--prtemca oob_tcp_if_include` |
| `No such file or directory` en los workers | El binario no está en `/srv/home` o el NFS no está montado | `df -h /srv/home` en cada worker |
| `Permission denied` en `/srv/home` | UID/GID distintos | `id mpiuser` en los 4 |
| `There are not enough slots available` | Más procesos que slots | Bajar `-np` o revisar `HPC_NODOS` / `hostfile` |
| Error de protocolo entre nodos | Versiones distintas de OpenMPI | Misma versión de Debian y `apt upgrade` en los 4 |
| `mpirun` se niega a arrancar | Se ejecutó como root | Ejecutar como `mpiuser` |
| El portal dice "job-runner desconectado" | nodo3 no llega a `IP_MASTER_LAB:2099/2100` | `nc -zv IP_MASTER_LAB 2099` desde nodo3; ufw del maestro; `EJECUTOR_HOST` |
| El gestor conecta al Registry pero falla al llamar | `java.rmi.server.hostname` no es la IP de laboratorio | Corregir el `.service` del PASO 12.1 |
| Trabajo FALLIDO con "nodo caído" | Un worker apagado o sin SSH | El gestor lo reencola en los demás; revisar el worker |

---

## PASO 16 — Qué documentar para el informe

1. `mpirun --version` en los 4 nodos (homogeneidad).
2. Salidas de `hola.bin` (4 nombres) y `suma.bin` (resultado correcto).
3. `hostfile` y `HPC_NODOS`.
4. La prueba de caída de un worker (PASO 11), a mano y con el servicio.
5. Un trabajo enviado desde el portal hasta "Resultados HPC/" (PASO 12.3).
6. Grafana durante un trabajo: cola, procesos en uso, tiempos de ejecución.
7. Las tres diferencias con el diagrama (sección 0): 3 workers + maestro de
   cómputo, NFS servido por el maestro, Debian 13 / OpenMPI 5 / Java 21.

---

## Anexo — Ajustes pendientes en la documentación del proyecto

1. **Número de workers:** el profesor pidió mínimo 4 workers; este montaje tiene
   3 + el maestro calculando. Confirmar con el profesor o añadir una máquina.
2. **NFS del clúster:** el diagrama de despliegue v2 lo dibuja desde
   `node-repository`; en el laboratorio lo sirve `hpc-master` (clúster aislado).
   Actualizar el diagrama y `docs/TRASPASO.md`.
3. **Versiones:** el diagrama dice Debian 12 / OpenMPI 4.1 / OpenJDK 17; el
   clúster real usa Debian 13 / OpenMPI 5.0 / OpenJDK 21.
4. **Identidad de los trabajos:** siguen corriendo como `mpiuser` (RF-20 pide la
   identidad real: nodos como clientes LDAP de node-soap; con el clúster aislado
   habría que exponer LDAPS al maestro).
5. **Terminología:** "un clúster de 4 nodos", nunca "4 clústeres".
