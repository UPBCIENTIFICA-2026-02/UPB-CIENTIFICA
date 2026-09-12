# upbc-node-web

Servidor web de **UPB-CIENTÍFICA** — implementa la VM `node-web` del diagrama de despliegue.
Proyecto de aula, Sistemas Distribuidos 2026-20, UPB Bucaramanga.

## Correspondencia con el diagrama de despliegue

| Diagrama | En este repositorio |
|---|---|
| `«device» VM node-web` | La máquina donde se ejecuta `despliegue/instalar.sh` |
| `«executionEnvironment» Node.js 20` | Requisito de instalación; lo instala el script |
| `«executable» servidor-web.js` | `servidor-web.js` |
| `«source» spa-ui.js` | `public/spa-ui.js` |
| `«file» rutas-servicio.json` | `rutas-servicio.json` |
| `HTTPS :443` desde los clientes | Nginx (`despliegue/nginx-node-web.conf`) |
| `SOAP/HTTPS :8081` → node-soap | `src/identidad.js` |
| `HTTPS :8082` → node-rmi | `src/servicios.js` |
| `HTTP :8083` → node-media | `src/servicios.js` |
| `HTTP :8084` → node-repository | `src/servicios.js` |
| `HTTP :3000` → node-monitoreo | `src/servicios.js` |

## Qué hace y qué no hace

Hace dos cosas:

1. Entrega la interfaz (`spa-ui.js`) al navegador.
2. Expone la API que esa interfaz consume, delegando cada operación en el nodo correspondiente.

No hace, deliberadamente:

- **No almacena datos.** Todo lo persistente vive en `node-repository`.
- **No valida credenciales.** Delega en `node-soap`, la única pieza que consulta LDAP.
- **No decide permisos.** Cada servicio aplica permisos Unix y cuota por usuario.
- **No es la puerta de los clientes nativos.** El agente de escritorio y la app móvil hablan directamente con los servicios. Si esta máquina cae, solo se pierde el acceso por navegador.

## Instalación en la VM

Debian 12 limpio, como root:

```bash
git clone https://github.com/<organizacion>/upbc-node-web.git
cd upbc-node-web
sudo bash despliegue/instalar.sh
```

El script instala Node.js 20 y Nginx de forma nativa —sin contenedores—, crea el usuario de servicio `upbcweb`, deja la aplicación en `/opt/upbc-node-web`, genera un certificado autofirmado y levanta el servicio con systemd.

Después hay que editar `/etc/upbc/node-web.env` con las IP reales de los demás nodos y reiniciar:

```bash
sudo systemctl restart node-web
```

Comandos útiles:

```bash
systemctl status node-web        # estado
journalctl -u node-web -f        # registro en vivo
curl localhost:8080/salud        # sonda de vida
```

## Desarrollo local

El servidor llama a servicios reales por HTTP. Como los demás nodos todavía no existen, el repositorio incluye una herramienta que los imita respetando los contratos acordados:

```bash
npm install
cp .env.example .env

npm run stubs      # terminal 1: levanta los cinco nodos falsos
npm start          # terminal 2: levanta el servidor
```

Abre `http://localhost:8080` y entra con cualquier usuario y contraseña.

`herramientas/nodos-falsos.js` **no forma parte del servidor**: es una herramienta de pruebas. El código de `src/` llama siempre por HTTP real, así que cuando un frente entregue su servicio basta apuntar la variable de entorno correspondiente y ese servicio deja de ser falso. La migración es servicio por servicio.

## Estructura

```
servidor-web.js         Arranque, archivos estáticos, montaje de la API, cierre ordenado
rutas-servicio.json     Mapa de servicios: qué nodo atiende cada cosa
src/
  config.js             Lee el mapa y permite sobreescribirlo por entorno
  identidad.js          Cliente SOAP hacia node-soap y middleware de sesión
  servicios.js          Un adaptador por servicio, sin lógica de negocio
  rutas.js              Endpoints de la API del portal
public/
  index.html            Estructura y estilos de la interfaz
  spa-ui.js             Lógica de la interfaz (sin framework, sin compilación)
despliegue/
  instalar.sh           Provisión de la VM
  node-web.service      Unidad systemd
  nginx-node-web.conf   TLS y publicación en :443
herramientas/
  nodos-falsos.js       Imita los otros cinco nodos para pruebas locales
docs/
  contratos.md          Formatos acordados con los demás frentes
```

## API del portal

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/sesion` | Inicia sesión contra node-soap; devuelve el token |
| `GET` | `/api/sesion` | Datos del usuario autenticado |
| `GET` | `/api/archivos` | Lista el Home del usuario, con cuota y permisos |
| `POST` | `/api/archivos/compartir` | Comparte un archivo con otro usuario |
| `GET` | `/api/album` | Fotografías del espacio del usuario |
| `GET` | `/api/videos` | Videos disponibles |
| `GET` | `/api/trabajos` | Trabajos MPI enviados al clúster |
| `POST` | `/api/trabajos` | Envía un trabajo nuevo |
| `GET` | `/api/monitoreo` | Ocupación de recursos por nodo |
| `GET` | `/salud` | Sonda de vida para el módulo de monitoreo |

Todas las rutas bajo `/api`, salvo `POST /api/sesion`, exigen `Authorization: Bearer <token>`.

Cuando un servicio no responde, la ruta devuelve **503** con un mensaje legible y la interfaz degrada solo esa sección: si `node-media` está caído, las fotos fallan pero los archivos y los trabajos siguen funcionando.

## Pendiente

- **Tipo de token.** Hoy `identidad.js` consulta a node-soap en cada petición. Si el equipo elige un token autocontenido, solo cambia `validarToken`.
- **Carga de archivos.** Falta el endpoint de subida; hay que acordar antes el contrato con `shared-file-svc`.
- **Reproducción de video.** La interfaz lista los videos pero no los reproduce; depende del formato que exponga `streaming-svc`.
- **Interfaz definitiva.** `public/spa-ui.js` es funcional pero mínima. Quien desarrolle la interfaz reemplaza ese archivo sin tocar el servidor.
- **Certificado.** El script genera uno autofirmado; hay que reemplazarlo por el del CCA.
