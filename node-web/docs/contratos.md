# Contratos entre node-web y los demás servicios

node-web es una **pasarela**: no adapta ni traduce los formatos de los servicios,
los reenvía tal cual (ver `README.md`). Por eso este documento ya no repite los
DTO de cada servicio — duplicarlos aquí solo sirve para que se desactualicen.

| Qué | Dónde está el contrato |
|---|---|
| Rutas que node-web expone al navegador | `FrontWebUPBCientifica/docs/PASARELA.md` |
| Storage (`/storage/**`) | `docs/contratos/Contrato Storage.pdf` del monorepo |
| Photo Album y Streaming (`/album/**`, `/streaming/**`) | `docs/contratos/Contrato Streaming.pdf` (falta el de Photo Album) |
| HPC (`/jobs/**`, `/cluster/**`) | `docs/contratos/Contrato HPC.pdf` |
| Shared File (`/shared-file/**`) | `docs/contratos/Contrato SharedFile.pdf` — servicio sin implementar, node-web responde 501 |
| Authentication (SOAP) | `docs/contratos/Contrato Auth.pdf` y `node-soap/soap/users.wsdl` |

## Lo único que node-web traduce: la sesión

`POST /api/sesion` y `DELETE /api/sesion` llaman a las operaciones SOAP `login`
y `logout` de node-soap (namespace `http://192.168.1.195/soap`, endpoint
`/soap/user.php`), las mismas que usan la app móvil y el escritorio.

| SOAP `loginResponse` | JSON que devuelve node-web |
|---|---|
| `token` | `token` |
| `expiraEn` | `expiraEn` |
| `roles` (separados por comas) | `roles` (arreglo) |
| `serviciosAutorizados` (separados por comas) | `serviciosAutorizados` (arreglo) |
| sin `token` + `message` | 401 `{ error: "CREDENCIALES_INVALIDAS", mensaje }` |
| node-soap no responde | 503 `{ error: "AUTH_NO_DISPONIBLE", mensaje }` |

## Desacuerdos conocidos (no los resuelve node-web)

1. **HPC.** El front envía `POST /jobs` con `{ nombre, rutaCodigoFuente,
   rutaDataset, numeroProcesos, prioridad }` y consulta `GET /cluster/estado`,
   como dice `Contrato_HPC`. El job-api de `RMIUPBCientifica` todavía exige
   `{ nombre, comando, prioridad }` y no tiene `/cluster/estado` (responde 500
   en vez de 404 a rutas desconocidas). Se arregla en job-api, no aquí.
2. **Monitoreo.** node-monitoreo no existe; el front abre `/monitoreo/` y node-web
   aún no lo publica.
3. **Puertos.** El plan del diagrama es la referencia: 8081 identidad,
   8082 trabajos, 8083 medios, 8084 archivos, 3000 monitoreo.
