# Guion de exposición: diagramas de UPB-CIENTÍFICA

Tres guiones, uno por diagrama, en el orden recomendado para exponer:

1. **Componentes** (`componentes.png`): *qué* piezas tiene el sistema y *cómo* se hablan.
2. **Despliegue** (`despliegue-real.png`): *dónde* corre cada pieza y *por qué puertos*.
3. **Modelo de datos** (`datos.png`): *qué datos* guarda cada pieza y *cómo se relacionan*.

Cómo leer este guion:

- El texto normal es **lo que se dice**.
- **[Señalar: …]** indica qué mostrar en la pantalla en ese momento.
- *(≈ X min)* es el tiempo aproximado de cada parte. Cada diagrama dura entre 5 y 7 minutos.
- Al final de cada guion hay **preguntas probables** con su respuesta corta.

Frase puente entre diagramas: *"Ya vimos **qué** piezas hay; ahora veamos **dónde** viven"*, y después *"…y por último **qué datos** guarda cada una"*.

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
El Gestor del clúster no ejecuta los trabajos. Requiere **IEjecutorMPI** por RMI, que provee el **Ejecutor MPI** (job-runner, en el nodo maestro). Este, a su vez, requiere **IMPI** de los **nodos de cómputo**, que es OpenMPI sobre SSH, MPI/TCP y NFS.

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
