# upbc-node-web

Servidor web de **UPB-CIENTÍFICA** — implementa la VM `node-web` del diagrama de despliegue.
Proyecto de aula, Sistemas Distribuidos 2026-20, UPB Bucaramanga.

## Correspondencia con el diagrama de despliegue

| Diagrama | En este repositorio |
|---|---|
| `«device» VM node-web` | La máquina donde se ejecuta `despliegue/instalar.sh` |
| `«executionEnvironment» Node.js 20` | Requisito de instalación; lo instala el script |
| `«executable» servidor-web.js` | `servidor-web.js` |
| `«source» spa-ui.js` | `public/spa-ui.js` (copia del repositorio **FrontWebUPBCientifica**) |
| `«file» rutas-servicio.json` | `rutas-servicio.json` |
| `HTTPS :443` desde los clientes | Nginx (`despliegue/nginx-node-web.conf`) |
| `SOAP/HTTPS :8081` → node-soap | `src/identidad.js` |
| `HTTPS :8082` → node-rmi | `src/pasarela.js` (hoy HTTP: job-api no sirve TLS) |
| `HTTP :8083` → node-media | `src/pasarela.js` |
| `HTTP :8084` → node-repository | `src/pasarela.js` |
| `HTTP :8085` → shared-file-svc (VM node-repository) | `src/pasarela.js` |
| `HTTP :3000` → node-monitoreo (Grafana) | `src/pasarela.js`, publicado en `/monitoreo/` |

## Qué hace y qué no hace

Hace dos cosas:

1. Entrega la **interfaz web** (repositorio `FrontWebUPBCientifica`).
2. Es su **pasarela** hacia los servicios. Un navegador no puede hablar SOAP,
   RMI ni gRPC, y llamar a cada VM por separado chocaría con CORS: la interfaz
   llama a `/api/...` en el mismo origen y node-web reenvía.

El contrato completo está en el repositorio del front:
**`FrontWebUPBCientifica/docs/PASARELA.md`**.

No hace, deliberadamente:

- **No interpreta lo que reenvía.** Mismo método, misma ruta sin `/api`, mismo
  cuerpo, misma cabecera `Authorization`. No conoce los DTO de los servicios: si
  uno cambia un campo, la pasarela no se entera.
- **No valida tokens.** Los reenvía; cada servicio los valida y responde 401.
- **No almacena datos ni decide permisos.** Eso es de cada servicio.
- **No es la puerta de los clientes nativos.** La app móvil y el agente de
  escritorio hablan directamente con los servicios. Si esta máquina cae, solo se
  pierde el acceso por navegador.

## Seguridad (análisis de vulnerabilidades, `docs/seguridad/` del monorepo)

- **Cabeceras** en todas las respuestas (`src/seguridad.js`): CSP estricta
  (`script-src 'self'` + hash del único script en línea de `index.html`, calculado
  al arrancar), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`. No se aplican bajo `/monitoreo/` (Grafana trae las suyas).
- **Nada oculto**: cualquier ruta con un segmento que empiece por `.` (`/.git`,
  `/.env`) responde 404. Antes, sirviendo el front desde su repositorio, se podía
  bajar `/.git/config`.
- **Límite de intentos de login** (`src/limiteIntentos.js`): 5 fallos por usuario
  e IP, o 20 por IP, en 15 minutos → `429 DEMASIADOS_INTENTOS` con `Retry-After`.
- **Token en la URL** (`?access_token=` del `<video>`): se pasa a cabecera, se quita
  antes de reenviar y se oculta en el registro.
- `GET /metrics` (Prometheus, `src/metricas.js`): peticiones, errores y latencia.
  Sin autenticación: en producción solo lo alcanza node-monitoreo.

## API

### Lo único que se traduce: la sesión (SOAP)

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/sesion` | `{ usuario, contrasena, origenCliente }` → operación `login` de node-soap → `{ token, expiraEn, roles[], serviciosAutorizados[] }`. 401 con credenciales malas; 503 si node-soap no responde |
| `DELETE` | `/api/sesion` | Operación `logout`. Responde 204 siempre |

Usa `login`/`logout`, las mismas operaciones que la app móvil y el escritorio.

### Reenvío 1 a 1

| La interfaz llama a | node-web reenvía a |
|---|---|
| `/api/storage/**` | node-repository `/storage/**` |
| `/api/album/**` | node-media `/album/**` |
| `/api/streaming/**` | node-media `/streaming/**` |
| `/api/jobs`, `/api/jobs/**` | job-api `/jobs/**` |
| `/api/cluster/**` | job-api `/cluster/**` |
| `/api/shared-file/**` | node-shared-file `/shared-file/**` (puerto 8085, VM node-repository) |
| `/salud` | sonda de vida de node-web |

Detalles que importan:

- **El cuerpo pasa como flujo**, sin parsear: las subidas son multipart y pueden
  pesar cientos de MB. Por eso la pasarela se monta antes de `express.json()`.
- **Estados y cuerpos de error del servicio pasan intactos**: la interfaz muestra
  el `{ error, mensaje }` de cada servicio.
- **`Range`, `Content-Range`, `Accept-Ranges`, `Content-Disposition`,
  `Content-Length`** pasan sin tocarse (descargas y video).
- **`?access_token=…`** (lo usa el `<video>`, que no puede poner cabeceras) se
  pasa a `Authorization` y **se quita de la URL** antes de reenviar. En el
  registro de accesos de node-web aparece como `[oculto]`, y Nginx registra esa
  ruta sin query string.
- Si un servicio no responde: **502** (o **504** tras 2 minutos sin datos) con
  `{ error, mensaje }`.

## La interfaz web

node-web sirve la carpeta indicada en `DIR_INTERFAZ`, o `public/` si no se
define.

- **Para desplegar**, se copia el front a `public/` y `instalar.sh` lo lleva a
  la VM como siempre:

  ```bash
  npm run interfaz          # copia index.html, spa-ui.js, estilos/ y src/
  ```

  Por defecto lo busca en `../../FrontWebUPBCientifica` (clonado junto al
  monorepo); se puede indicar otra ruta con `RUTA_FRONT`. Deja anotado en
  `public/ORIGEN.txt` de qué commit del front salió. **No edites `public/`:** los
  cambios se hacen en el repositorio del front y se vuelve a copiar.

- **Para desarrollar**, no hace falta copiar: arranca node-web con
  `DIR_INTERFAZ=<ruta del front>` y verás los cambios al recargar. El script
  `despliegue/cluster-virtualbox/7-iniciar-servicios-windows.ps1` lo hace solo.

## Instalación en la VM

Debian 12 limpio, como root:

```bash
git clone https://github.com/<organizacion>/upbc-node-web.git
cd upbc-node-web
npm run interfaz                 # si public/ no tiene ya la versión que quieres
sudo bash despliegue/instalar.sh
```

El script instala Node.js 20 y Nginx de forma nativa —sin contenedores—, crea el
usuario de servicio `upbcweb`, deja la aplicación en `/opt/upbc-node-web`, genera
un certificado autofirmado y levanta el servicio con systemd.

Después hay que editar `/etc/upbc/node-web.env` con las IP reales de los demás
nodos y reiniciar:

```bash
sudo systemctl restart node-web
```

Si job-api sirve HTTPS con un certificado de una CA propia, añade al `.env`
`NODE_EXTRA_CA_CERTS=/ruta/ca.crt`: la pasarela verifica el certificado, no
desactiva la comprobación TLS.

Comandos útiles:

```bash
systemctl status node-web        # estado
journalctl -u node-web -f        # registro en vivo
curl localhost:8080/salud        # sonda de vida
```

## Desarrollo local

Con los servicios reales en el mismo PC (guía `docs/Guia_Cluster_VirtualBox_Local.md`
del monorepo), el script 7 arranca node-web ya configurado.

A mano:

```bash
npm install
URL_IDENTIDAD=http://127.0.0.1:8081 URL_ARCHIVOS=http://127.0.0.1:8084 \
URL_MEDIOS=http://127.0.0.1:8083 URL_TRABAJOS=http://192.168.56.10:8082 \
DIR_INTERFAZ=../../FrontWebUPBCientifica npm start
```

Sin ningún servicio, `npm run stubs` levanta imitaciones de los cinco nodos
(`herramientas/nodos-falsos.js`); y el propio front tiene un **modo
demostración** que no necesita servidor.

## Estructura

```
servidor-web.js         Arranque: registro, pasarela, sesión, interfaz, /salud
rutas-servicio.json     Mapa de servicios: qué nodo atiende cada cosa
src/
  config.js             Lee el mapa y permite sobreescribirlo por entorno
  pasarela.js           Reenvío 1 a 1 hacia cada servicio
  identidad.js          Cliente SOAP hacia node-soap (login / logout)
  rutas.js              POST y DELETE /api/sesion (con límite de intentos)
  seguridad.js          CSP y demás cabeceras; 404 a rutas ocultas
  limiteIntentos.js     Freno a la fuerza bruta en el login
  metricas.js           GET /metrics para Prometheus
public/                 Copia del front web (npm run interfaz). No editar aquí.
despliegue/
  instalar.sh           Provisión de la VM
  node-web.service      Unidad systemd
  nginx-node-web.conf   TLS, publicación en :443 y registro sin token
herramientas/
  traer-interfaz.js     Copia el front a public/
  nodos-falsos.js       Imita los otros cinco nodos para pruebas locales
docs/
  contratos.md          Formatos acordados con los demás frentes
```

## Pendiente

- **HPC: el front y job-api no usan el mismo contrato.** El front sigue
  `Contrato_HPC` (`POST /jobs` con `rutaCodigoFuente`, `rutaDataset`,
  `numeroProcesos`) y espera `GET /cluster/estado`; job-api todavía pide un
  `comando` y no tiene esa ruta. La pasarela reenvía igual, así que el arreglo
  es solo en job-api. Mientras, el formulario de envío del front no funciona;
  listar y cancelar sí.
- **Certificado.** El script genera uno autofirmado; hay que reemplazarlo por el del CCA.
