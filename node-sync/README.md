# node-sync — servidor gRPC de sincronización (`syncd`)

Servidor **gRPC de sincronización de archivos** de UPB-CIENTÍFICA. Corresponde al
nodo **`node-sync`** del diagrama de despliegue (VM *Go 1.22*, binario **`syncd`**,
contrato **`filesync.proto`**, **gRPC sobre TLS**).

Recibe los cambios de **`fsagent`** (agente del escritorio) y de la **app móvil**
y los escribe en el **Home del usuario (`/srv/home`)** montado por **NFS**. Es el
único servicio que acepta conexiones directas de clientes sin pasar por
`node-web`, porque gRPC sobre HTTP/2 no tiene sentido intermediarlo con una API
REST.

## Arquitectura del código (por capas)

```
node-sync/
├── go.mod
├── Makefile
├── README.md
├── proto/filesync/
│   ├── filesync.proto          # Contrato Protocol Buffers (fuente de verdad)
│   ├── filesync.pb.go          # Generado (mensajes)
│   └── filesync_grpc.pb.go     # Generado (cliente/servidor gRPC)
├── cmd/syncd/
│   └── main.go                 # Binario syncd: config, TLS, servidor gRPC, apagado
├── internal/
│   ├── config/config.go        # Configuración (flags + entorno, incluye TLS)
│   ├── storage/                # Capa de almacenamiento
│   │   ├── store.go            #   Interfaz Store (permite cambiar de backend)
│   │   ├── fsstore.go          #   Implementación sobre el Home NFS (/srv/home)
│   │   └── hash.go             #   SHA-256
│   └── syncsvc/service.go      # Lógica del servicio gRPC FileSync
├── examples/client/main.go     # Cliente de prueba (simula fsagent; TLS-aware)
└── scripts/gen-cert.sh         # Certificado TLS autofirmado para desarrollo
```

`syncsvc` depende de la interfaz `storage`, no de su implementación; `cmd/syncd`
ensambla todo. Cambiar el almacenamiento no toca la lógica del servicio.

## API gRPC (servicio `FileSync`)

| RPC | Tipo | Descripción |
|---|---|---|
| `IniciarSync` | unario | Compara el estado local del cliente con el Home y devuelve acciones (SUBIR / BAJAR / IGUAL) |
| `SubirArchivo` | client-stream | Sube un archivo por fragmentos (el 1.er fragmento trae `uid` y `ruta`) |
| `DescargarArchivo` | server-stream | Descarga un archivo por fragmentos |
| `EstadoSync` | unario | Versión, última sincronización y número de archivos |

## Requisitos

- Go 1.21+
- Para **regenerar** los stubs: `protoc` + `protoc-gen-go` + `protoc-gen-go-grpc`
- Para TLS de desarrollo: `openssl`

## Compilar y ejecutar

```bash
go mod tidy                 # dependencias (requiere Internet la 1.ª vez)
make build                  # -> bin/syncd

# Desarrollo SIN TLS (Home en ./data):
make run

# Desarrollo CON TLS (genera certs/ autofirmados y arranca cifrado):
make run-tls

# Producción (ejemplo): Home en el montaje NFS y certificado de la CA del CCA
./bin/syncd -addr :9090 -data /srv/home \
            -tls-cert /etc/ssl/node-sync/server.crt \
            -tls-key  /etc/ssl/node-sync/server.key
```

Probar con el cliente de ejemplo (en otra terminal):

```bash
mkdir -p client-data/docs && echo "hola" > client-data/readme.txt
# sin TLS:
SYNC_ADDR=localhost:9090 SYNC_CLIENT_DIR=./client-data SYNC_UID=jperez go run ./examples/client
# con TLS (usando el certificado del servidor como CA):
SYNC_ADDR=localhost:9090 SYNC_TLS_CA=certs/server.crt SYNC_TLS_SERVERNAME=localhost \
  SYNC_CLIENT_DIR=./client-data SYNC_UID=jperez go run ./examples/client
```

## Configuración

| Bandera / variable | Por defecto | Descripción |
|---|---|---|
| `-addr` / `SYNC_ADDR` | `:9090` | Dirección de escucha |
| `-data` / `SYNC_DATA_DIR` | `/srv/home` | Raíz de los Home (montaje **NFS** en producción; use `./data` en local) |
| `-tls-cert` / `SYNC_TLS_CERT` | *(vacío)* | Certificado TLS (PEM). Con `-tls-key` habilita TLS |
| `-tls-key` / `SYNC_TLS_KEY` | *(vacío)* | Llave privada TLS (PEM) |

Cliente de ejemplo: `SYNC_TLS_CA` (CA/cert para validar el servidor) y
`SYNC_TLS_SERVERNAME` (nombre esperado en el certificado).

## Cómo encaja en el diagrama de despliegue

- Se despliega en la VM **`node-sync`** (Go 1.22).
- El Home **`/srv/home`** es el export **NFSv4** de **`node-repository`**, con cuota
  y permisos Unix gestionados allí.
- Los clientes directos son **`fsagent`** (escritorio) y la **app móvil**.

### Pendientes de integración (marcados como `TODO` en el código)

- **Autenticación**: interceptor gRPC que valide el token (metadata
  `authorization`) contra **LDAP** vía **`node-soap`** antes de cada RPC.
- **Metadatos**: el almacén de versión/última-sync (JSON) puede migrarse a
  **PostgreSQL** si se centraliza el estado de sincronización.

## Seguridad

- **TLS** para el transporte (obligatorio en producción).
- Prevención de *path traversal*: las rutas se normalizan y nunca salen del Home
  del usuario.
- Escrituras atómicas (archivo temporal + `rename`).

## Nota

Compilado y probado de extremo a extremo **sobre TLS**. El `go.mod` fija versiones
recientes de gRPC/protobuf; ejecuta `go mod tidy` para generar el `go.sum`. Los
stubs `*.pb.go` están incluidos y pueden regenerarse con `make proto`. (Este
proyecto reemplaza al `sync-server` anterior, ahora renombrado a `node-sync` /
`syncd` / `filesync.proto` para calzar con la arquitectura.)
