# Guion de exposición: diagramas de UPB-CIENTÍFICA

Seis guiones, uno por diagrama, en el orden recomendado para exponer:

1. **Componentes** (`componentes.png`): *qué* piezas tiene el sistema y *cómo* se hablan.
2. **Despliegue** (`despliegue-real.png`): *dónde* corre cada pieza y *por qué puertos*.
3. **Modelo de datos** (`datos.png`): *qué datos* guarda cada pieza y *cómo se relacionan*.
4. **Secuencia: enviar un trabajo al clúster** (`secuencia-hpc.png`): *en qué orden* se hablan las piezas, desde el portal web.
5. **Secuencia: ver las fotos** (`secuencia-album.png`): Photo Album desde el portal web.
6. **Secuencia: sincronizar una carpeta** (`secuencia-sync.png`): File Sync desde las apps nativas.

Cómo leer este guion:

- El texto normal es **lo que se dice**.
- **[Señalar: …]** indica qué mostrar en la pantalla en ese momento.
- *(≈ X min)* es el tiempo aproximado de cada parte. Cada diagrama dura entre 5 y 7 minutos.
- Al final de cada guion hay **preguntas probables** con su respuesta corta.

Frase puente entre diagramas: *"Ya vimos **qué** piezas hay; ahora veamos **dónde** viven"*, después *"…y **qué datos** guarda cada una"*, y por último *"Ahora pongamos todo en movimiento: veamos **en qué orden** se hablan en tres casos de uso reales"*.

---

## 1. Diagrama de componentes

### Apertura *(≈ 30 s)*

Este es el diagrama de componentes de UPB-CIENTÍFICA. Muestra el sistema **por dentro**: qué componentes de software lo forman, qué ofrece cada uno y qué necesita de los demás. Todavía no hablamos de máquinas; eso viene en el de despliegue.

La arquitectura es **orientada a servicios (SOA)**: servicios de grano grueso que se comunican solo a través de **contratos estables**, es decir, WSDL para SOAP, REST, `.proto` para gRPC e interfaces RMI. Las capas siguen la Figura 1 del enunciado.

### Cómo leer la notación *(≈ 45 s)*

**[Señalar: la leyenda de abajo]**

Antes de recorrerlo, tres símbolos de UML:

- El **círculo** (*lollipop*) es una **interfaz provista**: lo que un componente ofrece.
- La **media luna** (*socket*) es una **interfaz requerida**: lo que un componente necesita.
- Cuando una media luna abraza un círculo hay un **conector de ensamble**: el que requiere usa la interfaz del que la provee.
- La **línea punteada con flecha** es una dependencia `«use»`.
- Debajo de cada interfaz va su protocolo, por ejemplo `«REST»` o `«gRPC/TLS»`.

### Recorrido, de izquierda a derecha *(≈ 4 min)*

**1. Navegador web.** **[Señalar: Interfaz web (SPA)]**
El navegador ejecuta la aplicación web de una sola página (`spa-ui.js`). Solo necesita una interfaz, **IPortal**, por HTTPS. El navegador nunca habla directamente con los servicios.

**2. Consumidores de los servicios.** **[Señalar: el paquete del centro izquierda]**
Hay tres consumidores:
- el **Portal web** (node-web), que además de servir la página es una **pasarela**: recibe las peticiones de `/api` y las reenvía al servicio que corresponde;
- la **App de escritorio**, en Python;
- la **App Android**, en Kotlin.

Los tres requieren el mismo **bus de siete interfaces**: autenticación, almacenamiento, compartidos, álbum, streaming, sincronización y trabajos HPC. La única excepción es que el portal no usa sincronización, porque un navegador no puede sincronizar carpetas del disco.

Importante: **la pasarela solo reenvía**. No tiene lógica de negocio. Toda la lógica vive en cada servicio.

**3. Servicios SOA.** **[Señalar: la columna de 7 componentes]**
Este es el corazón del sistema. Cada servicio provee **una** interfaz, cada una con su contrato:

| Servicio | Interfaz | Tecnología |
|---|---|---|
| Authentication | IAutenticación (SOAP/HTTPS) | PHP 8 |
| Distributed Storage | IAlmacenamiento (REST) | Node.js |
| Shared File | ICompartidos (REST) | Node.js |
| Photo Album | IÁlbum (REST) | Node.js |
| Streaming | IStreaming (REST) | Node.js + FFmpeg |
| File Sync | ISincronización (gRPC/TLS) | Go |
| Gestor del clúster | ITrabajosHPC (REST) | Java (RMI + fachada REST) |

La heterogeneidad (PHP, Node.js, Go, Java) es justamente la razón de elegir SOA: se integran por contrato, no por código compartido.

**4. Dependencias entre servicios.** **[Señalar: las líneas a la derecha de los servicios]**
Los servicios también se necesitan entre sí:

- **Storage es la única persistencia real de archivos.** Por eso Shared File, Photo Album, Streaming, File Sync y el Gestor del clúster **requieren IAlmacenamiento**: ninguno guarda bytes por su cuenta.
- Photo Album y Streaming **requieren ICompartidos**, para mostrar también lo que otros usuarios compartieron contigo.
- **[Señalar: la flecha punteada de arriba, "«use» validarToken"]** Todos los servicios **validan el token** en Authentication. El usuario inicia sesión una vez y cada servicio comprueba el token y si su perfil tiene permiso para usarlo (el *mapa de servicios*).

**5. Recursos de datos.** **[Señalar: paquete "Recursos de datos"]**
- Authentication lee el **Directorio OpenLDAP** (IDirectorio, por LDAPS).
- Storage escribe en el **Repositorio de archivos** `/srv/home` (IArchivos).
- Los servicios usan **PostgreSQL**, con una base por servicio para sus metadatos.

**6. Clúster HPC.** **[Señalar: paquete "Clúster HPC (malla Grid)"]**
El Gestor del clúster no ejecuta los trabajos. Requiere **IEjecutorMPI** por RMI, que provee el **Ejecutor MPI** (job-runner, en el nodo maestro). Este, a su vez, requiere **IMPI** de los **nodos de cómputo**, que es OpenMPI sobre SSH, MPI/TCP y NFS. Los nodos de cómputo son el **maestro y los tres workers**: el maestro también ejecuta procesos.

**7. Monitoreo.** **[Señalar: paquete "Monitoreo (transversal)"]**
Es transversal porque observa a todos: **Prometheus** lee las métricas de cada servicio y de cada máquina, y **Grafana** las consulta para los tableros y las alertas.

### Cierre *(≈ 20 s)*

En resumen: siete servicios independientes, cada uno con su contrato, que solo se comunican por interfaces. Ninguno toca los datos de otro, y la autenticación es común a todos. Ahora veamos dónde corre cada uno.

### Preguntas probables

- **¿Por qué SOA y no microservicios?** Porque el enunciado impone tecnologías distintas (PHP/SOAP, Java/RMI, Go/gRPC) que se integran mejor por contratos estables. No buscamos despliegue por contenedores, que además está prohibido, ni consistencia eventual: son servicios de grano grueso con contratos versionados.
- **¿La pasarela no es un punto único de falla?** Para el navegador, sí. Las apps nativas no dependen de ella: llaman directo a cada servicio. Y la pasarela no tiene estado, así que es fácil de reiniciar o replicar.
- **¿Cómo sabe un servicio que el usuario puede usarlo?** Llama a `validarAccesoServicio` en Authentication. El directorio define qué perfil (investigadores o estudiantes) puede usar cada servicio. Por ejemplo, un estudiante recibe 403 en HPC.
- **¿Por qué el gestor usa RMI y además REST?** El contrato HPC es RMI, pero Android y el navegador no hablan RMI. Por eso job-api es una **fachada REST** delante del gestor RMI.

---

## 2. Diagrama de despliegue

### Apertura *(≈ 30 s)*

Este es el diagrama de despliegue. Muestra **dónde corre** cada componente que vimos: en qué máquina, sobre qué entorno de ejecución, y **por qué puerto y protocolo** se comunican. Refleja el sistema **realmente desplegado**: tres servidores virtuales (VPS) de la universidad y el clúster en la sala del laboratorio.

### Cómo leer la notación *(≈ 40 s)*

**[Señalar: un cubo cualquiera y la leyenda]**

- Un **cubo 3D `«device»`** es una máquina, física o virtual.
- Dentro hay **cubos `«executionEnvironment»`**: el software que ejecuta los programas, como Node.js, Apache con PHP, la JVM o PostgreSQL.
- Dentro de ellos están los **artefactos**, el rectángulo con el ícono de documento: lo que se despliega, como un ejecutable, un `.jar` o un esquema de base de datos.
- Cada **línea** es una ruta de comunicación con su protocolo y puerto, y **termina en el servicio exacto que la atiende**.
- La **línea punteada** es la validación del token.
- El **pequeño arco** indica que dos líneas se cruzan sin conectarse.

### Recorrido *(≈ 4–5 min)*

**1. Consumidores.** **[Señalar: paquete CONSUMIDORES]**
El navegador solo entra por **HTTPS 443** al portal. Las apps nativas (Android y escritorio) inician sesión por **SOAP/HTTPS 8081** y luego llaman **directamente** a cada servicio:
- **[Señalar: la línea de arriba]** a File Sync por **gRPC/TLS 9090** y a Storage y Shared File por **8084-8085**;
- **[Señalar: las dos líneas de abajo]** a Álbum y Streaming por **8083** y a job-api por **8082**.

**2. pasd_nodo1 (10.154.12.219): la puerta de entrada.** **[Señalar: nodo1]**
- **Nginx** termina el HTTPS (443) y pasa a **node-web**, la pasarela.
- **Apache con PHP** atiende **node-soap**, la autenticación, en 8081 por HTTPS.
- **OpenLDAP** guarda el directorio de usuarios. Solo node-soap lo consulta, por **LDAPS 636**.
- **Prometheus y Grafana** hacen el monitoreo. node-web publica Grafana en `/monitoreo` (puerto 3000 interno).

**3. pasd_nodo2 (10.154.12.221): los datos.** **[Señalar: nodo2]**
- **Storage y Shared File** en Node.js, puertos 8084 y 8085. Usan **PostgreSQL** local por el **5432**, que nunca se expone fuera de la máquina.
- **syncd**, el File Sync en Go, guarda a través de Storage (8084), no en disco por su cuenta.
- Aquí vive `/srv/home`, los archivos de todos los usuarios.

**4. pasd_nodo3 (10.154.12.222): medios y cómputo.** **[Señalar: nodo3]**
- **Álbum y Streaming** en Node.js con FFmpeg (8083), con su propia base `catalogo_medios`. Lee los archivos de Storage y lo compartido de Shared File (**8084-8085**, la línea vertical hacia nodo2).
- La **JVM** ejecuta el **gestor del clúster** y **job-api** (8082). El gestor baja el código y el dataset de Storage (**8084**) y entrega el trabajo al clúster.

**5. Validación del token.** **[Señalar: las dos líneas punteadas hacia node-soap]**
Todos los servicios de nodo2 y nodo3 consultan a node-soap por **8081** para validar cada petición. La identidad sale siempre del token, nunca del cuerpo del mensaje.

**6. Clúster HPC.** **[Señalar: paquete CLÚSTER HPC]**
Son **cuatro máquinas virtuales Debian 13**, una por PC del laboratorio, conectadas en modo puente a la red de la universidad, sin tocar las IP de nadie.
- El gestor entrega los trabajos al **nodo maestro** por **RMI 2099/2100**.
- **job-runner** compila el código (`mpicc`) y lanza **`mpirun`**.
- El maestro llega a cada **worker** por **SSH 22** y los procesos se comunican por **MPI/TCP**. Todos comparten el espacio de trabajo `/srv/home` por **NFSv4 2049**.
- Al terminar, el resultado vuelve al Home del usuario a través de Storage.

### Seguridad, para mencionar al cerrar *(≈ 30 s)*

- **Todo lo que viaja con credenciales va cifrado:** HTTPS en el portal y en node-soap, LDAPS hacia el directorio y TLS en File Sync. Los certificados los firma una **CA interna** del proyecto, que las apps traen incluida.
- **Cada máquina tiene firewall (ufw)** con **solo** los puertos que aparecen en el diagrama. Por ejemplo, PostgreSQL y Grafana escuchan solo de forma local.

### Cierre *(≈ 15 s)*

Tres VPS con responsabilidades claras (entrada, datos y cómputo) y un clúster en el laboratorio. Cada flecha tiene un protocolo y un puerto concretos, y el firewall solo deja pasar esas.

### Preguntas probables

- **¿Por qué 3 servidores y no 7 como en el diseño original?** La universidad asignó tres VPS. Se agruparon por afinidad (entrada y autenticación, datos, medios y cómputo), manteniendo los nombres lógicos del diseño (node-soap, node-repository…) como alias.
- **El profesor pidió 4 workers y hay 3.** El maestro también ejecuta procesos, así que hay 4 nodos de cómputo. Si se exigen 4 workers además del maestro, basta con una quinta VM con los mismos pasos de la guía.
- **¿Por qué job-api va por HTTP y no HTTPS?** Es un desacuerdo conocido con el diseño, documentado como pendiente. Viaja dentro de la red de la universidad y siempre con token validado.
- **¿Qué pasa si se cae un worker?** OpenMPI aborta ese trabajo. El gestor marca el nodo como caído y lo reencola en los nodos sanos. Mientras tanto, Grafana muestra la alerta.

---

## 3. Modelo de datos

### Apertura *(≈ 30 s)*

Este es el modelo de datos. Muestra **qué información guarda** el sistema y **cómo se relaciona**. Está hecho como **diagrama de clases UML con perfil de datos**: cada clase es una tabla o una entrada del directorio.

La idea clave es que **cada servicio es dueño de sus datos**. Por eso hay varios paquetes, uno por almacén, cada uno en su máquina.

### Cómo leer la notación *(≈ 40 s)*

**[Señalar: una clase, por ejemplo Nodo]**

- El estereotipo arriba del nombre dice qué es: `«table»` es una tabla de PostgreSQL, `«entry»` una entrada de LDAP y `«serializable»` un objeto guardado en archivo.
- `{PK}` es la clave primaria y `{FK}` una clave foránea.
- En los extremos de cada línea van las **multiplicidades**: `1` es exactamente uno, `0..1` cero o uno, y `*` o `0..*` cero o muchos.
- La **línea continua** es una relación con clave foránea real, dentro de la misma base.
- La **línea punteada `«references»`** es una referencia **entre almacenes distintos**: no hay clave foránea en la base, la valida la API del servicio dueño del dato.

### Recorrido *(≈ 4 min)*

**1. Directorio (OpenLDAP, nodo1).** **[Señalar: paquete Directorio]**
- **Usuario** se identifica por su `uid` y tiene su carpeta personal (`homeDirectory`).
- Un usuario es **miembro de** uno o varios **Perfiles** (investigadores o estudiantes): muchos a muchos.
- Cada perfil **autoriza** **Servicios** (storage, hpc…). Este es el *mapa de servicios*: así se decide, por ejemplo, que un estudiante no puede enviar trabajos HPC.

**2. metadatos_storage (PostgreSQL, nodo2).** **[Señalar: paquete metadatos_storage]**
Es el centro del modelo.
- **Nodo** representa **un archivo o una carpeta** (`tipo`). Tiene propietario y permisos al estilo Unix (`rwx`).
- **[Señalar: la línea "contiene"]** Es una relación **recursiva**: una carpeta *contiene* cero o muchos nodos, y cada nodo está en cero o una carpeta (cero cuando está en la raíz del Home). Así se forma el árbol de carpetas.
- Un nodo **tiene** cero o muchas **Versiones**: el historial de cada archivo.
- Un nodo **concede** cero o muchos **Accesos**: a qué usuario o grupo, y con qué nivel (lectura, escritura, compartir).

Importante: **los archivos en sí (los bytes) no están en la base**. Están en `/srv/home`. La base guarda solo los metadatos.

**3. comparticiones (PostgreSQL, nodo2).** **[Señalar: Comparticion y su línea punteada]**
Shared File registra **quién compartió qué con quién**, con su nivel y su estado (pendiente, activa, revocada). `elemento_id` **referencia** un Nodo de Storage. Shared File **decide** la compartición y Storage **aplica** el permiso en Acceso.

**4. catalogo_medios (PostgreSQL, nodo3).** **[Señalar: Medio y Album]**
- **Medio** es una foto o un video ya indexado (tipo, título, miniatura…). **Referencia** el Nodo de Storage donde está el archivo real.
- Un **Álbum** **agrupa** muchos medios y un medio puede estar en muchos álbumes: muchos a muchos.

**5. trabajos HPC (archivo, nodo3).** **[Señalar: TrabajoHPC]**
Cada trabajo tiene su propietario, cuántos procesos pide, su prioridad y su estado (en cola, ejecutando, completado…). **Referencia** dos Nodos de Storage: el código fuente y el dataset.

**6. La referencia que une todo.** **[Señalar: la línea "«references» propietario" hacia Usuario]**
Todos los campos `propietario` y `destinatario` se refieren al **uid del Usuario** del directorio. Así cualquier dato del sistema se puede atribuir a un usuario.

### La regla de diseño, para remarcar *(≈ 30 s)*

**[Señalar: las líneas punteadas que convergen en Nodo]**

Fíjense en que casi todas las líneas punteadas apuntan a **Nodo**. Eso es SOA aplicado a los datos:
- **ninguna base lee la base de otro servicio**: si Álbum necesita un archivo, se lo pide a Storage por su API;
- hay **una sola fuente de verdad para los archivos**, que es Storage;
- cada servicio tiene su base solo para **sus** índices y relaciones.

### Cierre *(≈ 15 s)*

Cinco almacenes, cada uno con un único dueño, unidos por referencias lógicas que se validan a través de los contratos. Así se puede cambiar o mover un servicio sin romper los datos de los demás.

### Preguntas probables

- **¿Una base por servicio no es microservicios?** No del todo. Cada servicio guarda solo sus metadatos; los archivos están centralizados en Storage y no hay consistencia eventual entre réplicas. Lo que exige el requisito es que *ningún componente lea o escriba en la base de otro*, y eso se cumple.
- **¿Cómo se garantiza la integridad sin claves foráneas entre bases?** La valida la API del dueño. Por ejemplo, al compartir, Shared File le pregunta a Storage si el nodo existe y si el usuario es su dueño. Si un nodo se borra, quien lo referencia lo detecta al consultar a Storage.
- **¿Por qué los trabajos HPC están en un archivo y no en PostgreSQL?** Es una decisión de la primera versión: el gestor guarda su estado en un archivo para sobrevivir a reinicios. Pasarlo a PostgreSQL está registrado como mejora futura.
- **¿Dónde están los respaldos?** El respaldo cifrado con GPG está diseñado (RF-11) y la copia va fuera del nodo, a nodo3. Está pendiente de generar la llave del custodio.

---

## Cómo leer los diagramas de secuencia (para los tres siguientes)

Decirlo **una sola vez**, antes del primer diagrama de secuencia *(≈ 45 s)*:

**[Señalar: las cabeceras y las líneas punteadas verticales]**

- Cada **columna** es un participante: el usuario (monigote) o un componente. Debajo del nombre va **dónde corre** (`pasd_nodo1`, `hpc-master`…), igual que en el diagrama de despliegue.
- La **línea punteada vertical** es su *línea de vida*. El tiempo avanza **hacia abajo**.
- El **rectángulo blanco** sobre la línea de vida es una **activación**: el participante está trabajando o esperando una respuesta.
- **Flecha con punta rellena**: mensaje **síncrono** (quien llama espera). **Punta abierta**: mensaje **asíncrono** (no espera). **Línea punteada**: la **respuesta**.
- Los mensajes van **numerados** en orden y llevan su protocolo entre comillas angulares, por ejemplo `«HTTPS» 443`, `«RMI»`, `«gRPC/TLS»`.
- Los **marcos** son fragmentos combinados: `alt` es un si/si no (cada rama con su condición entre corchetes), `opt` es un "solo si…" y `loop` es una repetición.

---

## 4. Secuencia: enviar un trabajo al clúster (portal web)

### Apertura *(≈ 30 s)*

Este diagrama muestra qué pasa cuando un investigador **envía un trabajo MPI al clúster desde el portal web**, hasta que ve el resultado en su Home. Es el caso que más servicios atraviesa: el navegador, node-web, job-api, el gestor, la autenticación, Storage, job-runner y los nodos del clúster.

### Recorrido *(≈ 4–5 min)*

**1. El envío pasa solo por node-web (mensajes 1 a 4).** **[Señalar: las primeras flechas, de izquierda a derecha]**
El investigador elige el código fuente y el dataset de su Home, el número de procesos y la prioridad. El navegador hace `POST /api/jobs` por **HTTPS 443**, con el token. **El navegador nunca habla con otro servicio que no sea node-web.**
node-web **reenvía sin interpretar** a job-api (8082), que traduce de REST a **RMI** y llama a `enviarTrabajo(token, solicitud)` en el gestor.

**2. Validación (mensajes 5 y 6).** **[Señalar: las dos flechas hacia Authentication]**
Quien valida es el **gestor**, no node-web. Primero `validarToken`, que devuelve el uid y el perfil. Luego `validarAccesoServicio(perfil, "hpc")`, que comprueba el *mapa de servicios*. **El uid sale del token, nunca del cuerpo del mensaje.**

**3. El `alt` (mensaje 7 y 8).** **[Señalar: el marco alt y sus dos ramas]**
- Si el token no es válido o el perfil no tiene "hpc" (un estudiante, por ejemplo), la excepción vuelve por la misma cadena y el navegador recibe **401 o 403**.
- Si está autorizado, el gestor le pregunta a **Storage** si existen el código y el dataset, valida las reglas (cuota de procesos, formato) y **encola** el trabajo.

**4. Respuesta inmediata.** **[Señalar: "201 {trabajoId, estadoInicial}" y "Trabajo en cola"]**
El navegador recibe enseguida un **201** con el id del trabajo. **No espera a que el trabajo corra**: la ejecución puede tardar minutos u horas.

**5. Ejecución asíncrona (mensajes 9 a 14).** **[Señalar: la nota amarilla y el primer loop]**
El **planificador** del gestor trabaja por su cuenta. Ordena la cola por prioridad con **envejecimiento** (para que un trabajo de prioridad baja no espere para siempre) y asigna nodos según su carga. Mientras el trabajo está en cola:
- descarga el código y el dataset de Storage **con el token del usuario** (así Storage aplica sus permisos);
- le pregunta a job-runner si todos los nodos responden (`nodosSinRespuesta`);
- y le envía la orden con `iniciar(...)`. **[Señalar: la punta abierta]** Es un mensaje **asíncrono**: el gestor no se queda bloqueado.

En el maestro, **job-runner** escribe los archivos en `/srv/home/.hpc-trabajos` (compartido por NFS), arma el *hostfile*, compila con **`mpicc`** y lanza **`mpirun`**. Los procesos corren en el **maestro y los tres workers** (SSH + MPI/TCP).

**6. Recoger el resultado (mensajes 15 a 18).** **[Señalar: el segundo loop y las flechas a Storage]**
El gestor **sondea** a job-runner hasta que el trabajo termina, pide los resultados (`salida.txt`, `errores.txt` y los archivos generados) y los **guarda en Storage**, en `Resultados HPC/<nombre>-<id>` del Home del usuario. El estado pasa a **COMPLETADO**.

**7. El navegador consulta (mensajes 19 a 21).** **[Señalar: el loop de abajo a la izquierda]**
Mientras tanto, la pantalla de HPC pide cada **3 segundos** `GET /api/jobs`, también **por node-web**. job-api lo traduce a `listarTrabajosUsuario(token)` y el gestor devuelve **solo los trabajos de ese usuario**. Cuando aparece COMPLETADO, el investigador abre el resultado en su Home.

### Cierre *(≈ 20 s)*

Tres ideas: el navegador **solo** pasa por node-web; el envío y la ejecución están **desacoplados** (cola + mensaje asíncrono), y el clúster **no guarda nada propio**: código, dataset y resultado viven en Storage.

### Preguntas probables

- **¿Por qué no se ejecuta el trabajo en la misma petición?** Un trabajo MPI puede tardar mucho; una petición HTTP no puede quedar abierta tanto tiempo. Por eso se encola y se responde de inmediato con el id.
- **¿Qué pasa si un nodo se cae?** `nodosSinRespuesta` lo detecta antes de lanzar; si falla durante la ejecución, el gestor marca el nodo **EN_FALLA** y devuelve el trabajo a la cola para asignarlo a nodos sanos.
- **¿Por qué el navegador no llama a job-api directamente?** Porque el enunciado pide que la interfaz web entre solo por node-web. Además así el navegador solo necesita el puerto 443 y un único certificado.
- **¿Con qué usuario corren los procesos?** Hoy como `mpiuser` en los nodos. Para la identidad real del investigador, los nodos tendrían que ser clientes LDAP (RF-20), pendiente documentado.

---

## 5. Secuencia: ver las fotos (Photo Album, portal web)

### Apertura *(≈ 20 s)*

Este diagrama muestra qué pasa cuando un usuario **abre la sección Fotos en el portal web**: cómo se arma la galería, cómo llegan las miniaturas y cómo se ve una foto en tamaño original.

### Recorrido *(≈ 3–4 min)*

**1. Pedir la lista (mensajes 1 a 4).** **[Señalar: las primeras flechas]**
El navegador pide `GET /api/album/fotos` por **HTTPS 443** a node-web, que **reenvía** a Photo Album (node-media, 8083, en nodo3). Photo Album **valida el token** y el permiso `"album"` en Authentication.

**2. Refrescar el índice, solo si hace falta (mensajes 5 a 10).** **[Señalar: el marco opt]**
Photo Album **no guarda fotos**: guarda un **índice** (catálogo) de las que hay en Storage. Ese índice se refresca solo si es la primera página y pasó más de un minuto desde el último refresco:
- lista el Home del usuario en **Storage**;
- **[Señalar: el loop interno]** por cada imagen nueva o cambiada, la descarga, **FFmpeg** la inspecciona y genera la **miniatura**, y guarda los metadatos en `catalogo_medios`;
- luego pregunta a **Shared File** qué le han compartido al usuario, para incluir también esas fotos.

**3. Responder la lista (mensaje 11).** **[Señalar: SELECT y las respuestas hacia la izquierda]**
Con el índice al día, Photo Album consulta su base (fotos propias y compartidas, ordenadas) y la lista vuelve **por node-web** al navegador.

**4. Miniaturas (mensajes 12 y 13).** **[Señalar: el loop "cada foto que entra en pantalla"]**
El navegador pide cada miniatura **solo cuando entra en pantalla** (carga perezosa), otra vez por node-web. Photo Album la entrega desde su **caché local**: no molesta a Storage.

**5. Ver la foto original (mensajes 14 a 17).** **[Señalar: la parte de abajo]**
Al abrir una foto, el navegador pide `/contenido` por node-web. Photo Album **no tiene el archivo**: se lo pide a **Storage con el token del usuario**, y es Storage quien decide si tiene permiso (porque es suya o porque se la compartieron). Los bytes viajan Storage → Photo Album → node-web → navegador.

### Cierre *(≈ 15 s)*

Photo Album es un servicio de **índice y presentación**: los archivos siguen siendo de Storage, los permisos los aplica Storage y lo compartido lo decide Shared File. Cada servicio hace lo suyo, unidos solo por contratos.

### Preguntas probables

- **¿Por qué no se refresca el índice en cada petición?** Recorrer el Home y generar miniaturas es costoso. Con el umbral de un minuto, la galería responde rápido y sigue estando al día.
- **¿Las fotos se duplican en nodo3?** No. En nodo3 solo hay metadatos y miniaturas pequeñas. La foto original siempre se lee de Storage.
- **¿Qué pasa si me revocan una foto compartida?** Al refrescar, Shared File ya no la devuelve y desaparece de la galería. Y aunque alguien conserve el enlace, Storage rechazaría la lectura.

---

## 6. Secuencia: sincronizar una carpeta (File Sync, apps nativas)

### Apertura *(≈ 30 s)*

Este diagrama muestra la **sincronización de una carpeta** entre el dispositivo y el servidor. Aquí el cliente es una **app nativa** (escritorio o Android), porque un navegador no puede leer carpetas del disco. Las apps **no pasan por node-web**: inician sesión directamente en node-soap (8081) y hablan con **syncd** por **gRPC/TLS 9090**, como se vio en el despliegue.

### Recorrido *(≈ 4 min)*

**1. El disparo (mensajes 1 y 2).** **[Señalar: el primer alt]**
La sincronización empieza de dos formas: **manual**, cuando el usuario pulsa *Sincronizar*, o **automática**, al conectarse al Wi-Fi del servidor o a la hora programada.

**2. Trabajo local (mensajes 3 y 4).** **[Señalar: los automensajes de la App]**
La app calcula el **SHA-256** de cada archivo local (con una caché para no recalcular los que no cambiaron) y los compara con la **base**: el estado que quedó en la última sincronización.

**3. Pedir el plan (mensajes 5 a 10).** **[Señalar: IniciarSync y lo que hace File Sync]**
La app llama a `IniciarSync` por gRPC con la lista de archivos y sus hashes; el token va en el *metadata* de gRPC.
- syncd **valida el token** y el permiso `"filesync"` en Authentication.
- Lista la carpeta del usuario en **Storage**.
- **[Señalar: el opt]** Si no conoce el hash de una versión del servidor, la descarga una vez, lo calcula y lo guarda en su caché.
- Hace la **comparación a tres vías**: local, base y servidor. Así sabe **dónde** cambió cada archivo, y no solo que son distintos.

Devuelve una **lista de acciones**, una por archivo.

**4. Ejecutar las acciones (mensajes 11 a 19).** **[Señalar: el loop y el alt de cinco ramas]**
Por cada acción distinta de "igual":
- **SUBIR**: la app envía el archivo en trozos (*stream*) y syncd lo guarda en Storage, que crea una **nueva versión**.
- **BAJAR**: syncd lo lee de Storage y lo envía en trozos; la app lo escribe.
- **BORRAR_SERVIDOR**: se borró en el dispositivo, así que se borra en Storage.
- **BORRAR**: se borró en el servidor, así que se borra la copia local.
- **CONFLICTO**: cambió en los dos lados. **No se pierde nada**: la copia local se renombra como copia en conflicto y se sube, y se baja la del servidor (política *MANTENER_AMBOS* del contrato).

**5. Cerrar (mensaje 20).** **[Señalar: el final]**
La app guarda la **nueva base** y muestra un resumen: subidos, bajados, borrados y conflictos.

### Cierre *(≈ 15 s)*

File Sync **no guarda archivos**: toda la persistencia es de Storage, con su historial de versiones. syncd solo coordina: compara, decide y transmite.

### Preguntas probables

- **¿Por qué gRPC y no REST?** gRPC permite enviar los archivos en *streams* de trozos de forma eficiente, y el contrato `.proto` fija exactamente los mensajes. Además va cifrado con TLS.
- **¿Por qué comparar a tres vías y no solo local contra servidor?** Con dos versiones no se sabe quién cambió. La base permite distinguir "lo cambié yo" de "lo cambió el servidor" y detectar los conflictos reales.
- **¿Por qué la web no sincroniza?** Un navegador no tiene acceso libre a las carpetas del disco. Por eso File Sync solo lo usan las apps de escritorio y Android.
- **¿Qué pasa si se corta la conexión a mitad?** Las acciones ya hechas quedan en Storage; la base solo se actualiza al final, así que la siguiente sincronización recalcula lo que falte.
