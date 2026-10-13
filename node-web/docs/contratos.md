# Contratos entre node-web y los demás servicios

node-web es una **pasarela**: no adapta ni traduce los formatos de los servicios,
los reenvía tal cual (ver `README.md`). Por eso este documento ya no repite los
DTO de cada servicio — duplicarlos aquí solo sirve para que se desactualicen.

| Qué | Dónde está el contrato |
|---|---|
| Rutas que node-web expone al navegador | `FrontWebUPBCientifica/docs/PASARELA.md` |
| Storage (`/storage/**`) | `docs/contratos/Contrato Storage.pdf` del monorepo |
| Photo Album (`/album/**`) | `docs/contratos/Contrato PhotoAlbum.md` |
| Streaming (`/streaming/**`) | `docs/contratos/Contrato Streaming.pdf` |
| HPC (`/jobs/**`, `/cluster/**`) | `docs/contratos/Contrato HPC.pdf` |
| Shared File (`/shared-file/**`) | `docs/contratos/Contrato SharedFile.pdf` (servicio `node-shared-file`, 8085) |
| Monitoreo (`/monitoreo/**`) | Grafana de `node-monitoreo` (`node-monitoreo/README.md`) |
| Authentication (SOAP) | `docs/contratos/Contrato Auth.pdf` y `node-soap/back/users.wsdl` |

Los cambios de API que aún no están en los PDF:
`docs/contratos/Adendas a los contratos.md`.

## Lo único que node-web traduce: la sesión

`POST /api/sesion` y `DELETE /api/sesion` llaman a las operaciones SOAP `login`
y `logout` de node-soap (namespace `http://192.168.1.195/soap`, endpoint
`/soap/user.php`), las mismas que usan la app móvil y el escritorio.

| SOAP `loginResponse` | JSON que devuelve node-web |
|---|---|
| `token` | `token` |
| `expiraEn` | `expiraEn` |
| `roles` (separados por comas) | `roles` (arreglo) |
| `mapaServiciosAutorizados` (separados por comas) | `serviciosAutorizados` (arreglo) |
| sin `token` + `message` | 401 `{ error: "CREDENCIALES_INVALIDAS", mensaje }` |
| node-soap no responde | 503 `{ error: "AUTH_NO_DISPONIBLE", mensaje }` |
| 5 fallos en 15 min (usuario + IP) | 429 `{ error: "DEMASIADOS_INTENTOS", mensaje }` + `Retry-After` |

## Desacuerdos conocidos (no los resuelve node-web)

1. ~~**HPC.**~~ Resuelto (2026-10-13): job-api implementa `Contrato_HPC`
   (`POST /jobs` con `nombreTrabajo`, `rutaCodigo`, `rutaDataset`,
   `numeroProcesos`, `tiempoMaximoEjecucion`, `prioridad`…; `GET /cluster/estado`).
2. **Puertos.** El plan del diagrama es la referencia: 8081 identidad,
   8082 trabajos, 8083 medios, 8084 archivos, 8085 compartidos, 3000 monitoreo.
