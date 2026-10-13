# node-sync — servidor gRPC de sincronización (`syncd`)

Servidor **gRPC de sincronización de archivos** de UPB-CIENTÍFICA (File Sync).
Corresponde al nodo **`node-sync`** del diagrama de despliegue (VM *Go 1.22*,
binario **`syncd`**, contrato **`filesync.proto`**, puerto **9090**).

Mantiene una **copia síncrona** de una carpeta del escritorio o del celular en
una carpeta del Home del usuario. **Guarda a través de Distributed Storage**
(API REST de node-repository, con el token del propio usuario), como pide el
contrato (*"delegando en Storage toda la persistencia real"*): lo sincronizado
aparece en "Mis archivos", cuenta para la cuota, respeta los permisos y cada
cambio crea una versión nueva en Storage.

> **ANTES** escribía directo en el montaje NFS `/srv/home`, saltándose cuota,
> permisos e índice de Storage. Ese almacén (`FSStore`) sigue disponible solo
> para pruebas aisladas: `-almacen=fs`. **Contradice el diagrama**, que dibuja
> node-sync → node-repository por NFSv4 (TRASPASO §2.6).

## Arquitectura del código (por capas)

```
node-sync/
├── proto/filesync/filesync.proto   # Contrato (fuente de verdad) + stubs Go generados
├── cmd/syncd/main.go               # Composition root: config, almacén, validador, TLS, gRPC
└── internal/
    ├── config/config.go            # Banderas y variables de entorno
    ├── auth/
    │   ├── interceptor.go          # Valida el token (simulado | SOAP contra node-soap)
    │   └── servicios.go            # Mapa de servicios: exige "filesync" (validarAccesoServicio)
    ├── syncsvc/service.go          # Presentación: gRPC <-> dominio, errores -> códigos gRPC
    ├── dominio/plan.go             # Reglas puras: qué hacer con cada archivo (sync de 3 vías)
    └── storage/
        ├── store.go                # Interfaz Store (sesión con uid + token)
        ├── storagestore.go         # Por defecto: API REST de Storage
        ├── fsstore.go              # Solo pruebas: directo al disco
        └── registro.go             # Versión por usuario + caché de hashes (JSON)
```

## API gRPC (servicio `FileSync`)

| RPC | Tipo | Descripción |
|---|---|---|
| `IniciarSync` | unario | Recibe el estado del dispositivo (ruta, hash, `hash_base` de la última sync, `eliminado`) y devuelve una acción por archivo |
| `SubirArchivo` | client-stream | Sube un archivo por fragmentos (el 1.er fragmento trae la ruta) → nueva versión en Storage |
| `DescargarArchivo` | server-stream | Descarga un archivo por fragmentos |
| `EliminarArchivo` | unario | Borra en Storage lo que el dispositivo borró |
| `EstadoSync` | unario | Versión, última sincronización y número de archivos |

**Acciones:** `IGUAL`, `SUBIR`, `BAJAR`, `BORRAR` (borrado en el servidor → borrar
la copia local), `BORRAR_SERVIDOR` (borrado local → llamar a `EliminarArchivo`) y
`CONFLICTO` (cambió en ambos lados → **MANTENER_AMBOS**: la copia del dispositivo
se renombra a `ruta_conflicto`, p. ej. `informe (conflicto - movil-ana - 2026-10-12 17.05).pdf`,
se sube, y se baja la del servidor). Un cambio siempre gana a un borrado; "borrado
local + modificado remoto" es conflicto, nunca borrado. Tabla completa en
`internal/dominio/plan.go`.

**Rutas:** relativas al Home, con `/`. `SyncRequest.carpeta` es la carpeta del Home
que sincroniza el dispositivo ("Respaldo celular", "Respaldo <PC>"); todas las
rutas deben estar dentro de ella.

**Autenticación:** metadata `authorization: Bearer <token>`. El uid sale del token,
nunca del mensaje (los campos `uid` del .proto están obsoletos y se ignoran). En
modo `soap` se exige además que el perfil tenga `filesync` en su mapa de servicios.

**Errores** (prefijo del Contrato_FileSync en el mensaje): `SYNC-002` ruta fuera de
la carpeta o sin permiso (`PERMISSION_DENIED`), `SYNC-004` Storage no disponible
(`UNAVAILABLE`), `SYNC-005` checksum inválido (`INVALID_ARGUMENT`); token inválido
→ `UNAUTHENTICATED`; cuota llena → `RESOURCE_EXHAUSTED`.

Los cambios respecto al contrato PDF están en
`docs/contratos/Adendas a los contratos.md` (sección D).

## Configuración

| Bandera / Variable | Por defecto | Descripción |
|---|---|---|
| `-addr` / `SYNC_ADDR` | `:9090` | Dirección de escucha |
| `-almacen` / `SYNC_ALMACEN` | `storage` | `storage` (API de Storage) o `fs` (disco, solo pruebas) |
| `-storage-url` / `SYNC_STORAGE_URL` | `http://127.0.0.1:8084/storage` | Raíz de la API de Storage |
| `-storage-ca` / `SYNC_STORAGE_CA` | *(vacío)* | CA del HTTPS de node-repository |
| `-registro` / `SYNC_REGISTRO` | `./estado/registro-sync.json` | Versión por usuario y caché de hashes |
| `-data` / `SYNC_DATA_DIR` | `/srv/home` | Solo con `-almacen=fs` |
| `-tls-cert`, `-tls-key` / `SYNC_TLS_CERT`, `SYNC_TLS_KEY` | *(vacío)* | Con ambos, gRPC sobre TLS (obligatorio en producción) |
| `-auth-mode` / `SYNC_AUTH_MODE` | `simulado` | `simulado` o `soap` |
| `-auth-url` / `SYNC_AUTH_URL` | `https://192.168.1.195:8081/soap/user.php` | Endpoint de node-soap |
| `SYNC_AUTH_NS` | `http://192.168.1.195/soap` | targetNamespace del WSDL |
| `-auth-ca` / `SYNC_AUTH_CA` | *(vacío)* | CA del HTTPS de node-soap |

## Compilar y ejecutar

Requisitos: Go 1.22; para regenerar los stubs, `protoc` + `protoc-gen-go` +
`protoc-gen-go-grpc` (`make proto`).

```bash
go build -o bin/syncd ./cmd/syncd
./bin/syncd -addr :9090 -storage-url http://node-repository:8084/storage \
            -auth-mode soap -auth-url https://node-soap:8081/soap/user.php \
            -tls-cert /etc/ssl/node-sync/server.crt -tls-key /etc/ssl/node-sync/server.key
go test ./internal/...      # reglas de sincronización y mapa de servicios
```

**En el PC de desarrollo (Windows)** el Control inteligente de aplicaciones
bloquea los ejecutables de Go recién compilados (también `go run` y `go test`).
`syncd` corre en una VM Ubuntu con el 9090 reenviado; se compila en Windows para
Linux y se copia:

```powershell
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
& "$env:USERPROFILE\sdk\go\bin\go.exe" build -o bin\syncd-linux-amd64 ./cmd/syncd
```

Pasos completos (VM, servicio systemd, `10.0.2.2`): `docs/Guia_Cluster_VirtualBox_Local.md`, paso 7.4.

## Clientes

- **App Android** (`FrontUPBCientifica`, `data/filesync/`): carpeta del teléfono
  (SAF); se sincroniza sola al conectarse al Wi-Fi donde responde el servidor, o en
  el horario elegido (WorkManager).
- **App de escritorio** (`FrontDesktopUPBCientifica`, `app/data/filesync.py`):
  carpeta del PC; manual, al conectarse a la red del servidor, cada hora o diaria.
  Corre mientras la app está abierta (no hay `fsagent` aparte).
- `examples/client/main.go`: cliente mínimo de prueba (no usa `carpeta` ni
  `hash_base`; sirve para comprobar conexión y TLS).

## Seguridad

- **TLS** para el transporte (obligatorio en producción).
- Rutas normalizadas: nunca salen del Home ni de la carpeta sincronizada (`..` se rechaza).
- Checksum SHA-256 obligatorio en cada archivo; las descargas se verifican en el cliente.
- node-sync no tiene privilegios propios en Storage: actúa siempre con el token del usuario.

## Verificado

19/19 pruebas de extremo a extremo contra Storage real (en Windows y con `syncd`
en la VM): subida, versión nueva, cambios remotos, borrados en ambos sentidos,
conflicto con MANTENER_AMBOS, aislamiento entre usuarios, checksum y rutas inválidas,
token inválido.
