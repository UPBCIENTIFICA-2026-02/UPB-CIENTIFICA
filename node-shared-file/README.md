# node-shared-file — Shared File Service

Implementa `Contrato_SharedFile` (`docs/contratos/Contrato SharedFile.pdf`): compartir
archivos y carpetas con otros usuarios o grupos, con permisos de tres niveles.

Es el ejecutable **`shared-file-svc`** que el diagrama de despliegue pone en la
**VM node-repository**, junto a Storage. Node.js 20 + Express + PostgreSQL, puerto
**8085** (el diagrama no le asigna puerto; es el siguiente libre del plan).

## Cómo encaja

```
cliente ──REST──► Shared File (8085) ──REST, con el token del usuario──► Storage (8084)
                       │                                                    │
                  BD comparticiones                                 tabla accesos
                  (quién comparte                                   (lo que Storage APLICA
                   con quién)                                        al servir los bytes)
```

Reparto de responsabilidades, tal como lo pide el contrato:

- **Shared File decide y registra** quién comparte qué con quién (`relaciones`,
  el `RelacionCompartido` del contrato). No guarda bytes ni metadatos de archivos.
- **Storage aplica** cada compartición en sus propias validaciones (paso 6 del
  flujo): `GET/PUT/DELETE /storage/nodos/{id}/accesos`. Es Storage quien calcula
  el **permiso efectivo** —bits Unix + comparticiones propias y heredadas de las
  carpetas, prevaleciendo la más permisiva (§3.6)— con una sola regla, en
  `node-repository/src/dominio/accesos.js`.
- Shared File llama a Storage **con el token del usuario**: Storage vuelve a
  comprobar que quien comparte tiene el nivel "compartir". Shared File no puede
  dar más acceso del que el propio usuario tiene.
- Registrar la relación y aplicarla en Storage van en **una transacción**: si
  Storage rechaza o no responde, no queda una relación que Storage no aplique.

El destinatario abre y descarga lo compartido **directamente en Storage** con su
propio token (`/storage/archivos/{id}/descargar`, `/storage/directorios/{id}`):
Storage ya lo deja pasar. Por eso las operaciones fachada `SubirArchivo` y
`DescargarArchivo` no se duplican aquí.

## API

Todas bajo `/shared-file`, con `Authorization: Bearer <token>`. El `uid` sale
siempre del token, nunca del cuerpo. Errores: `{ error, mensaje }` con los
códigos del contrato.

| Operación del contrato | Ruta |
|---|---|
| CompartirArchivo | `POST /compartir` `{ archivoId, destinatarioTipo, destinatarioId, nivelPermiso, expiracion? }` → 201 `{ compartidoId, fechaCompartido, estadoInvitacion }` |
| CompartirDirectorio | `POST /compartir-directorio` `{ directorioId, ... }` (se hereda a todo el contenido, presente y futuro) |
| ActualizarPermisosCompartidos | `PATCH /compartir/{compartidoId}` `{ nuevoNivelPermiso }` → `{ compartidoId, nivelPermiso, advertencia }` |
| DejarDeCompartir | `DELETE /compartir/{compartidoId}` o `DELETE /compartir?elementoId=&destinatarioTipo=&destinatarioId=` → 204 |
| ListarCompartidosConmigo | `GET /compartidos-conmigo?pagina=N` |
| ListarQueYoComparto | `GET /que-yo-comparto?pagina=N` |
| ObtenerPermisosEfectivos | `GET /permisos-efectivos/{elementoId}` |
| ObtenerHome / ListarContenidoHome | `GET /home`, `GET /home/contenido` |
| ObtenerCuotaUsuario | `GET /cuota` |

`destinatarioTipo`: `USUARIO` | `GRUPO`. `nivelPermiso`: `LECTURA` |
`LECTURA_ESCRITURA` | `LECTURA_ESCRITURA_COMPARTIR`. `expiracion`: ISO-8601, opcional.

Los listados devuelven `RelacionCompartido` con los metadatos actuales del
elemento: `compartidoId, elementoId, elementoTipo, nombre, tamanoBytes,
propietario, compartidoPor, destinatarioTipo, destinatarioId, nivelPermiso,
estadoInvitacion, fechaCompartido, fechaExpiracion`.

| Código | HTTP | Cuándo |
|---|---|---|
| `SHR-001` | 404 | El archivo o la relación no existe, o no es accesible para el solicitante |
| `SHR-101` | 404 | Igual, para un directorio |
| `SHR-002` | 403 | El solicitante no tiene el nivel "compartir" |
| `SHR-003` | 404 | El usuario destinatario no existe en Authentication |
| `SHR-004` | 409 | Ya hay una compartición vigente con ese destinatario |
| `SHR-201` | 200 + `advertencia` | Se degrada a alguien que ya volvió a compartir: sus subcomparticiones siguen vigentes |
| `STG-103` | 409 | Storage rechazó aplicar el permiso |

## Decisiones y límites (para revisar con el equipo)

- **Política de invitaciones: automática** (`estadoInvitacion = ACTIVO`). El
  contrato dice que `AceptarInvitacion`/`RechazarInvitacion` aplican solo si la
  política exige aceptación explícita, así que no se exponen.
- **Grupos destinatarios no se validan**: `users.wsdl` no tiene una operación para
  comprobar que un grupo existe, y el contrato admite compartir con un grupo sin
  miembros (§8). Los usuarios sí se validan (`obtenerUsuario`).
- **`homePath`** debería venir de Authentication, pero `obtenerPerfilUsuario` no
  lo publica: se usa la convención `/srv/home/<uid>` (`PLANTILLA_HOME`), la misma
  de node-sync.
- **`ObtenerPermisosEfectivos` solo para uno mismo**: calcularlo para otro usuario
  requiere sus grupos, y Authentication no los entrega a terceros.
- **Eventos** (`ArchivoCompartido`, `ComparticionRevocada`): se escriben como una
  línea JSON en el registro del servicio hasta que exista Monitoring.
- **node-media no muestra lo compartido** en Fotos/Streaming del destinatario: su
  catálogo copia solo los bits Unix. Se ve y se abre desde Compartidos.

## Arrancar

```bash
psql -U postgres -f ../despliegue/cluster-virtualbox/0-crear-bases.sql   # crea BD comparticiones y usuario shared_svc
cp .env.example .env
npm install
npm start
```

En el PC de desarrollo lo arranca `despliegue/cluster-virtualbox/7-iniciar-servicios-windows.ps1`.

## Estructura

```
src/
  index.js                      Composition root
  config.js
  auth/ValidadorToken.js        Strategy simulado / soap (copia del de Storage)
  middleware/                   autenticación y traducción de errores a HTTP
  rutas/compartidos.js          HTTP <-> dominio
  dominio/ComparticionService.js  reglas del contrato
  dominio/errores.js            SHR-xxx
  datos/ComparticionesRepository.js  tabla relaciones
  datos/StorageCliente.js       IAlmacenamiento (con el token del usuario)
  datos/DirectorioUsuarios.js   Strategy simulado / soap (obtenerUsuario)
  datos/EmisorEventos.js
db/schema.sql
```
