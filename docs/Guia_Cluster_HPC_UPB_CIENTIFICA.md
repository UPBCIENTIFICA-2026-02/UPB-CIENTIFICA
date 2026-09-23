# Guía de montaje del Clúster HPC — UPB-CIENTÍFICA

Guía paso a paso para montar el clúster MPI sobre las máquinas del Laboratorio,
siguiendo el diagrama de despliegue del proyecto.

---

## 0. Conceptos previos y qué vamos a montar

**Es UN solo clúster, con 5 nodos (máquinas).** Un clúster es el conjunto; los
nodos son las máquinas que lo componen. No son 5 clústeres.

| Rol | Cantidad | Nombre en el diagrama |
|---|---|---|
| Nodo maestro (coordina) | 1 | `hpc-master` |
| Nodos worker (ejecutan) | 4 mínimo | `hpc-worker [1..N]` |

El profesor exigió **mínimo 4 nodos esclavos**, así que N = 4. Total: **5 máquinas**.
(El roadmap del proyecto decía "2-3 nodos" para el MVP; queda anulado por la
indicación del profesor.)

### Qué contiene cada nodo, según el diagrama de despliegue

**hpc-master**
- Debian 12
- OpenMPI 4.1
- OpenJDK 17
- `hostfile` — lista de nodos worker
- `job-runner.jar` — recibe el trabajo desde node-rmi y dispara la ejecución

**hpc-worker [1..N]**
- Debian 12
- OpenMPI 4.1
- `libmpi.so` — librería MPI
- `trabajo.bin` — el ejecutable del trabajo científico del usuario

**Conexiones**
- SSH puerto **22** — el maestro lanza procesos en los workers
- MPI sobre **TCP** — los procesos se comunican entre sí durante la ejecución
- NFSv4 puerto **2049** — montaje de `/srv/home` (viene de `node-repository`)

### ⚠️ Un vacío del diagrama que hay que resolver antes de empezar

El diagrama dibuja el montaje NFSv4 de `/srv/home` únicamente hacia `hpc-master`.
**Pero MPI exige que TODOS los nodos vean el mismo binario en la misma ruta.**
Si solo el maestro tiene el montaje, `mpirun` fallará con "No such file or
directory" en los workers.

Esta guía asume que **los 5 nodos montan `/srv/home`**. Conviene:
1. Confirmarlo con el equipo (afecta a quien lleva Storage/repository).
2. Corregir el diagrama de despliegue para que la línea NFSv4 llegue también a
   `hpc-worker [1..N]`.

### Convención de nombres y direcciones usada en esta guía

Reemplaza las IPs por las reales que asigne el laboratorio.

| Nodo | Nombre | IP de ejemplo |
|---|---|---|
| Maestro | `hpc-master` | 192.168.10.10 |
| Worker 1 | `hpc-worker1` | 192.168.10.11 |
| Worker 2 | `hpc-worker2` | 192.168.10.12 |
| Worker 3 | `hpc-worker3` | 192.168.10.13 |
| Worker 4 | `hpc-worker4` | 192.168.10.14 |
| Servidor NFS | `node-repository` | 192.168.10.20 |

Usuario de ejecución MPI: **`mpiuser`** (se crea en el paso 3).

---

## PASO 1 — Preparar las 5 máquinas con Debian 12

**En las 5 máquinas.**

1. Instala Debian 12 (bookworm) en las 5 máquinas del laboratorio. Instalación
   mínima con servidor SSH es suficiente; no necesitan entorno gráfico.

2. Durante la instalación, asigna el nombre de host correspondiente
   (`hpc-master`, `hpc-worker1`, etc.). Si ya están instaladas, cámbialo así:

```bash
sudo hostnamectl set-hostname hpc-master     # ajusta en cada máquina
```

3. Verifica la versión del sistema:

```bash
cat /etc/os-release
```
Debe mostrar `VERSION="12 (bookworm)"`.

4. Actualiza los paquetes en las 5:

```bash
sudo apt update && sudo apt upgrade -y
```

5. Instala herramientas básicas en las 5:

```bash
sudo apt install -y openssh-server net-tools build-essential nfs-common
```

---

## PASO 2 — Configurar red y resolución de nombres

MPI necesita que los nodos se encuentren **por nombre**, no solo por IP.

**En las 5 máquinas**, edita `/etc/hosts`:

```bash
sudo nano /etc/hosts
```

Agrega estas líneas (ajusta las IPs reales):

```
192.168.10.10   hpc-master
192.168.10.11   hpc-worker1
192.168.10.12   hpc-worker2
192.168.10.13   hpc-worker3
192.168.10.14   hpc-worker4
192.168.10.20   node-repository
```

> **Importante:** si Debian dejó una línea como `127.0.1.1 hpc-master`, **bórrala
> o coméntala**. Es una causa clásica de fallos en MPI: el nodo resuelve su propio
> nombre a una dirección de loopback y los demás no pueden alcanzarlo.

**Verifica desde el maestro** que resuelve y alcanza a todos:

```bash
for n in hpc-worker1 hpc-worker2 hpc-worker3 hpc-worker4; do
  echo -n "$n: "; ping -c 1 -W 2 $n > /dev/null && echo OK || echo FALLA
done
```

Los 4 deben decir OK antes de continuar.

---

## PASO 3 — Crear el usuario `mpiuser` con el MISMO UID en todos los nodos

Este paso es **crítico** y suele saltarse. NFS identifica a los usuarios por
número (UID/GID), no por nombre. Si `mpiuser` tiene UID 1001 en el maestro y 1002
en un worker, los permisos sobre `/srv/home` fallarán de forma confusa.

**En las 5 máquinas**, ejecuta exactamente lo mismo:

```bash
sudo groupadd -g 5000 mpigroup
sudo useradd -m -u 5000 -g 5000 -s /bin/bash mpiuser
sudo passwd mpiuser
```

**Verifica en cada nodo** que el UID/GID coincide:

```bash
id mpiuser
```

Debe imprimir `uid=5000(mpiuser) gid=5000(mpigroup)` en las 5 máquinas. Si en
alguna es distinto, corrígelo antes de seguir:

```bash
sudo usermod -u 5000 mpiuser
sudo groupmod -g 5000 mpigroup
```

---

## PASO 4 — Instalar OpenMPI 4.1

Debian 12 trae OpenMPI 4.1.x en sus repositorios oficiales, que es justo la
versión del diagrama.

**En las 5 máquinas:**

```bash
sudo apt install -y openmpi-bin openmpi-common libopenmpi-dev
```

**Verifica la versión en las 5:**

```bash
mpirun --version
```

Debe mostrar algo como `mpirun (Open MPI) 4.1.4`.

> ⚠️ **La versión debe ser idéntica en los 5 nodos.** Si una máquina tiene 4.1.4
> y otra 4.1.6, la ejecución puede fallar con errores de protocolo difíciles de
> diagnosticar. Si difieren, iguálalas.

**Verifica que `libmpi.so` está presente** (aparece en el diagrama):

```bash
ldconfig -p | grep libmpi
```

**Solo en `hpc-master`**, instala además Java 17 (el diagrama lo pide porque
`job-runner.jar` corre ahí):

```bash
sudo apt install -y openjdk-17-jdk
java -version
```

---

## PASO 5 — Configurar SSH sin contraseña del maestro a los workers

`mpirun` arranca procesos remotos por SSH. Si pide contraseña, la ejecución se
cuelga. Hay que configurar autenticación por llave.

**5.1 — En `hpc-master`, como `mpiuser`:**

```bash
su - mpiuser
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
```

(La opción `-N ""` crea la llave sin passphrase, necesario para que MPI no pida nada.)

**5.2 — Copia la llave a los 4 workers** (te pedirá la contraseña de `mpiuser`
una vez por nodo):

```bash
for n in hpc-worker1 hpc-worker2 hpc-worker3 hpc-worker4; do
  ssh-copy-id mpiuser@$n
done
```

**5.3 — Copia la llave también al propio maestro.** MPI a veces lanza procesos
locales por SSH:

```bash
ssh-copy-id mpiuser@hpc-master
```

**5.4 — Verifica que NO pide contraseña:**

```bash
for n in hpc-master hpc-worker1 hpc-worker2 hpc-worker3 hpc-worker4; do
  echo -n "$n: "; ssh -o BatchMode=yes $n hostname
done
```

Debe imprimir los 5 nombres sin pedir nada. Si alguno pide contraseña o falla,
resuélvelo antes de continuar — **este es el punto donde más se atasca la gente**.

> Nota: la primera conexión a cada host pregunta por la huella (`fingerprint`).
> El bucle del paso 5.2 ya la acepta; si aparece de nuevo, responde `yes` una vez.

---

## PASO 6 — Montar el almacenamiento compartido `/srv/home` por NFS

Todos los nodos deben ver el mismo directorio. Aquí `node-repository` es el
servidor NFS (según el diagrama: *Debian 12 - Servidor NFSv4 - GnuPG 2.4*).

**6.1 — En `node-repository` (el servidor NFS):**

```bash
sudo apt install -y nfs-kernel-server
sudo mkdir -p /srv/home
sudo chown mpiuser:mpigroup /srv/home
sudo chmod 775 /srv/home
```

Edita las exportaciones:

```bash
sudo nano /etc/exports
```

Agrega (ajusta la subred a la real del laboratorio):

```
/srv/home  192.168.10.0/24(rw,sync,no_subtree_check)
```

Aplica y arranca:

```bash
sudo exportfs -ra
sudo systemctl enable --now nfs-kernel-server
sudo exportfs -v          # verifica que aparece la exportación
```

**6.2 — En los 5 nodos del clúster (maestro y los 4 workers):**

```bash
sudo mkdir -p /srv/home
sudo mount -t nfs4 node-repository:/srv/home /srv/home
```

Verifica:

```bash
df -h /srv/home
```

**6.3 — Haz el montaje permanente** (para que sobreviva a un reinicio). En los 5
nodos, edita `/etc/fstab`:

```bash
sudo nano /etc/fstab
```

Agrega:

```
node-repository:/srv/home  /srv/home  nfs4  defaults,_netdev  0  0
```

**6.4 — Prueba de que realmente es compartido.** Desde el maestro:

```bash
su - mpiuser
echo "prueba desde master" > /srv/home/test.txt
```

Desde cualquier worker:

```bash
cat /srv/home/test.txt
```

Debe mostrar el texto. Si no, el montaje no está bien y **nada de lo que sigue
funcionará**.

---

## PASO 7 — Crear el `hostfile`

Este archivo le dice a `mpirun` en qué máquinas lanzar procesos y cuántos por
máquina. Aparece explícitamente en el diagrama, dentro de `hpc-master`.

**7.1 — Averigua cuántos núcleos tiene cada worker:**

```bash
ssh hpc-worker1 nproc
```

Supongamos que cada uno tiene 4 núcleos.

**7.2 — En `hpc-master`, como `mpiuser`**, crea el archivo. Lo ponemos en
`/srv/home` para que sea visible desde todos los nodos:

```bash
su - mpiuser
nano /srv/home/hostfile
```

Contenido:

```
hpc-worker1 slots=4
hpc-worker2 slots=4
hpc-worker3 slots=4
hpc-worker4 slots=4
```

`slots` = número máximo de procesos que se pueden lanzar en ese nodo (normalmente
igual al número de núcleos). Con esta configuración el clúster admite hasta 16
procesos simultáneos.

> **Decisión de diseño:** el maestro **no** se incluye como worker en este
> ejemplo, porque su trabajo es coordinar y ejecutar `job-runner.jar`. Si quieres
> aprovechar también sus núcleos, agrega una línea `hpc-master slots=4` — pero
> ten en cuenta que competirá con el propio gestor de trabajos.

---

## PASO 8 — Abrir puertos / configurar el firewall

OpenMPI usa el puerto 22 (SSH) para arrancar y luego **puertos TCP altos
aleatorios** para la comunicación entre procesos. Si hay firewall, MPI se cuelga
sin mensaje claro.

**Opción A — Red aislada de laboratorio (lo más simple).** Si las 5 máquinas están
en una red cerrada del laboratorio, desactiva el firewall entre ellas:

```bash
sudo ufw status          # si está inactivo, no hay nada que hacer
```

**Opción B — Restringir el rango de puertos de MPI** (más ordenado y defendible
para el informe). En los 5 nodos:

```bash
sudo nano /etc/openmpi/openmpi-mca-params.conf
```

Agrega:

```
btl_tcp_port_min_v4 = 10000
btl_tcp_port_range_v4 = 1000
oob_tcp_dynamic_ipv4_ports = 11000-11999
```

Y luego abre solo ese rango en el firewall:

```bash
sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.10.0/24 to any port 10000:11999 proto tcp
sudo ufw allow from 192.168.10.0/24 to any port 2049 proto tcp
```

---

## PASO 9 — Prueba de humo: "Hola Mundo" en MPI

Este es el paso que **confirma que el clúster está vivo**. El roadmap del proyecto
indica hacerlo antes de escribir nada del HPC Service.

**9.1 — En `hpc-master`, como `mpiuser`**, crea el programa en el directorio
compartido:

```bash
su - mpiuser
nano /srv/home/hola.c
```

Contenido:

```c
#include <mpi.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);

    int rank, size;
    char hostname[256];

    MPI_Comm_rank(MPI_COMM_WORLD, &rank);   // número de este proceso
    MPI_Comm_size(MPI_COMM_WORLD, &size);   // total de procesos
    gethostname(hostname, sizeof(hostname));

    printf("Proceso %d de %d ejecutandose en %s\n", rank, size, hostname);

    MPI_Finalize();
    return 0;
}
```

**9.2 — Compila con el wrapper de MPI** (no con `gcc` directo):

```bash
cd /srv/home
mpicc hola.c -o hola.bin
```

El binario queda en `/srv/home/hola.bin`, visible desde los 5 nodos gracias al NFS.

**9.3 — Verifica que los workers lo ven:**

```bash
ssh hpc-worker3 ls -l /srv/home/hola.bin
```

**9.4 — Ejecuta en el clúster:**

```bash
mpirun -np 8 --hostfile /srv/home/hostfile /srv/home/hola.bin
```

**Salida esperada** (el orden de las líneas varía, es normal — corren en paralelo):

```
Proceso 0 de 8 ejecutandose en hpc-worker1
Proceso 1 de 8 ejecutandose en hpc-worker1
Proceso 2 de 8 ejecutandose en hpc-worker2
Proceso 3 de 8 ejecutandose en hpc-worker2
Proceso 4 de 8 ejecutandose en hpc-worker3
Proceso 5 de 8 ejecutandose en hpc-worker3
Proceso 6 de 8 ejecutandose en hpc-worker4
Proceso 7 de 8 ejecutandose en hpc-worker4
```

**Si ves los 4 nombres de worker distintos en la salida, el clúster funciona.**
Guarda esta salida: sirve como evidencia para el informe y para la bitácora semanal.

**9.5 — Prueba a plena capacidad** (16 procesos, 4 por nodo):

```bash
mpirun -np 16 --hostfile /srv/home/hostfile /srv/home/hola.bin
```

---

## PASO 10 — Prueba de comunicación real entre nodos

El "Hola Mundo" demuestra que los procesos arrancan, pero no que **se comuniquen**.
Esta segunda prueba valida el paso de mensajes, que es el corazón de MPI.

```bash
nano /srv/home/suma.c
```

```c
#include <mpi.h>
#include <stdio.h>

int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);

    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);

    // Cada proceso aporta su propio numero
    int valor_local = rank + 1;
    int suma_total = 0;

    // MPI_Reduce: todos envian su valor, el proceso 0 recibe la suma
    MPI_Reduce(&valor_local, &suma_total, 1, MPI_INT, MPI_SUM, 0, MPI_COMM_WORLD);

    if (rank == 0) {
        printf("Suma de 1..%d calculada entre %d procesos = %d\n",
               size, size, suma_total);
        printf("Valor esperado = %d\n", size * (size + 1) / 2);
    }

    MPI_Finalize();
    return 0;
}
```

```bash
cd /srv/home
mpicc suma.c -o suma.bin
mpirun -np 8 --hostfile /srv/home/hostfile /srv/home/suma.bin
```

Salida esperada:

```
Suma de 1..8 calculada entre 8 procesos = 36
Valor esperado = 36
```

Si ambos números coinciden, **los nodos se están comunicando correctamente por la
red**. Con esto el clúster queda validado.

---

## PASO 11 — Prueba de tolerancia a fallos

El roadmap del proyecto exige probar qué pasa si un worker cae a mitad de
ejecución. Vale la pena hacerlo ahora y documentar el comportamiento.

1. Lanza un trabajo largo (por ejemplo, agrega un `sleep(60)` antes de
   `MPI_Finalize()` y recompila).
2. Desde otra terminal, apaga un worker:
   ```bash
   ssh hpc-worker3 sudo poweroff
   ```
3. Observa qué hace `mpirun`. Por defecto, **OpenMPI aborta el trabajo completo**
   cuando pierde un nodo.

Documenta ese resultado: justifica por qué el proyecto necesita **checkpointing**
(guardar el estado periódicamente) y un **nodo maestro secundario**, que son
justamente las mitigaciones que ya identificó la propuesta de arquitectura.

---

## PASO 12 — Dejar el entorno listo para `job-runner.jar`

El clúster ya funciona a mano. El siguiente paso es que `job-runner.jar` (en
`hpc-master`) haga lo mismo de forma programática cuando llegue un trabajo desde
`node-rmi`.

Lo que ese `.jar` tendrá que hacer, en esencia:

1. Recibir del HPC Service el código fuente y el dataset del usuario.
2. Escribirlos en `/srv/home/trabajos/<id-trabajo>/`.
3. Compilar: `mpicc fuente.c -o trabajo.bin` (el `trabajo.bin` del diagrama).
4. Invocar:
   ```
   mpirun -np <N> --hostfile /srv/home/hostfile /srv/home/trabajos/<id>/trabajo.bin
   ```
5. Capturar salida estándar y error, y el código de salida.
6. Dejar los resultados en `/srv/home/trabajos/<id>/resultados/`.
7. Notificar el estado al HPC Service.

**Prueba desde Java** que la invocación funciona, antes de integrar nada:

```java
ProcessBuilder pb = new ProcessBuilder(
    "mpirun", "-np", "8",
    "--hostfile", "/srv/home/hostfile",
    "/srv/home/hola.bin"
);
pb.redirectErrorStream(true);
Process p = pb.start();
// leer p.getInputStream() y p.waitFor()
```

> Ejecuta esto **como `mpiuser`**, no como root. OpenMPI se niega a correr como
> root por defecto.

---

## PASO 13 — Checklist de validación

Marca cada punto antes de dar el clúster por terminado:

- [ ] Las 5 máquinas tienen Debian 12
- [ ] `mpirun --version` da **exactamente la misma versión** en las 5
- [ ] `ping` por **nombre** funciona entre todos los nodos
- [ ] No hay línea `127.0.1.1 <hostname>` en `/etc/hosts`
- [ ] `id mpiuser` da **UID 5000 y GID 5000** en las 5 máquinas
- [ ] `ssh <nodo> hostname` funciona **sin contraseña** desde el maestro a los 5
- [ ] `/srv/home` está montado en los 5 nodos y un archivo creado en uno se ve en los otros
- [ ] El montaje está en `/etc/fstab` (sobrevive a reinicio)
- [ ] `hostfile` lista los 4 workers con sus `slots`
- [ ] `hola.bin` muestra procesos corriendo en **los 4 workers**
- [ ] `suma.bin` da el resultado correcto (comunicación entre nodos validada)
- [ ] Se probó y documentó qué pasa al caer un worker
- [ ] `hpc-master` tiene OpenJDK 17 instalado

---

## PASO 14 — Errores frecuentes y cómo resolverlos

| Síntoma | Causa probable | Solución |
|---|---|---|
| `mpirun` pide contraseña y se cuelga | Llaves SSH mal configuradas | Repetir paso 5; verificar con `ssh -o BatchMode=yes` |
| `No such file or directory` en los workers | El binario no está en una ruta compartida | Compilar dentro de `/srv/home`; verificar el montaje NFS en TODOS los nodos |
| Todos los procesos salen en `hpc-master` | El `hostfile` no se está leyendo | Verificar la ruta pasada en `--hostfile` |
| `There are not enough slots available` | Pediste más procesos que `slots` totales | Bajar `-np` o subir `slots` en el hostfile |
| Cuelgue sin mensaje al iniciar | Firewall bloqueando puertos altos de MPI | Aplicar el paso 8 (rango de puertos + reglas ufw) |
| `Permission denied` sobre `/srv/home` | UID/GID distintos entre nodos | Verificar `id mpiuser` en los 5; corregir con `usermod -u` |
| Error de protocolo entre nodos | Versiones distintas de OpenMPI | Igualar versiones en los 5 nodos |
| `mpirun` se niega a arrancar como root | Protección de OpenMPI | Ejecutar como `mpiuser` |
| El nodo no se ve desde otros aunque hay ping | Línea `127.0.1.1` en `/etc/hosts` | Comentarla o borrarla (paso 2) |

---

## PASO 15 — Qué documentar para el informe y la bitácora

Guarda como evidencia:

1. Salida de `mpirun --version` en los 5 nodos (prueba de homogeneidad).
2. Salida completa de `hola.bin` con los 4 workers visibles.
3. Salida de `suma.bin` con el resultado correcto.
4. Contenido del `hostfile`.
5. Resultado de la prueba de caída de un worker (paso 11) y su interpretación.
6. Captura de `df -h /srv/home` en varios nodos mostrando el montaje compartido.

Esto alimenta directamente las secciones **Metodología** y **Resultados** del
informe, que están vacías, y sirve como avance verificable para la bitácora semanal.

---

## Anexo — Ajustes a la documentación del proyecto derivados de esta guía

1. **Número de nodos:** el roadmap dice "2-3 nodos" para el MVP; el profesor exigió
   mínimo 4 workers. Actualizar el roadmap y el acta de requerimientos.
2. **Montaje NFS:** el diagrama de despliegue solo dibuja el montaje NFSv4 hacia
   `hpc-master`. Debe llegar también a `hpc-worker [1..N]`, o `mpirun` no funciona.
3. **Terminología:** asegurarse de que el informe diga "un clúster de 5 nodos" y
   nunca "5 clústeres".
4. **`trabajo.bin`:** el diagrama lo muestra como artefacto dentro de los workers.
   En realidad vive en `/srv/home` (compartido) y se ejecuta en los workers;
   conviene aclararlo o representarlo sobre el almacenamiento compartido.
