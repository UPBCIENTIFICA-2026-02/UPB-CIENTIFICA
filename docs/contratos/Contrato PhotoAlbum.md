# Contrato de Servicio: Photo Album Service

> Mismo formato que los demás contratos de `docs/contratos/`. Describe la API
> **tal como está implementada** en `node-media` (rutas `/album/*`), verificada
> contra el servicio en ejecución. Si cambia el código, se cambia este contrato.

## 1. Información general

| Campo | Valor |
|---|---|
| Nombre del servicio | Photo Album Service (`album-svc`, VM node-media) |
| Descripción | Explora en el Home del usuario las imágenes, las ordena y las presenta, junto con las que otros usuarios le compartieron. Permite organizarlas en álbumes. |
| Objetivo | Que el usuario vea y organice sus fotos sin descargarlas, con miniaturas, respetando los permisos de Storage y Shared File. |
| Responsabilidad | Catálogo de fotos (índice, no almacén), miniaturas, búsqueda, orden, álbumes. Los bytes viven en Distributed Storage. |
| Tecnología | Node.js 20 + Express, PostgreSQL 15 (BD `catalogo-medios`), FFmpeg (miniaturas). Comparte proceso con Streaming. |
| Protocolo de comunicación | HTTP/REST + JSON. Puerto 8083; desde el portal, `/api/album/*` (node-web). |
| Servicios consumidores | Portal web, cliente de escritorio, app Android. |
| Servicios proveedores | Authentication (`validarToken`, `validarAccesoServicio` con servicio `album`), Distributed Storage (`GET /storage/directorios/{id}`, `GET /storage/archivos/{id}/descargar`, `DELETE /storage/archivos/{id}`), Shared File (`ListarCompartidosConmigo`). |

## 2. Funcionalidades

| # | Operación | Método y ruta |
|---|---|---|
| 1 | ListarFotos | `GET /album/fotos?pagina=&ordenPor=` |
| 2 | BuscarFotos | `GET /album/fotos/buscar?criterioTexto=&ordenPor=` |
| 3 | ObtenerFoto | `GET /album/fotos/{id}` |
| 4 | ObtenerMiniatura | `GET /album/fotos/{id}/miniatura` |
| 5 | ObtenerContenidoFoto | `GET /album/fotos/{id}/contenido` |
| 6 | EliminarFoto | `DELETE /album/fotos/{id}` |
| 7 | IndexarHome | `POST /album/indexar` |
| 8 | ListarAlbumes | `GET /album/albumes` |
| 9 | CrearAlbum | `POST /album/albumes` |
| 10 | VerAlbum | `GET /album/albumes/{id}` |
| 11 | AgregarFotoAAlbum | `POST /album/albumes/{id}/fotos` |
| 12 | QuitarFotoDeAlbum | `DELETE /album/albumes/{id}/fotos/{medioId}` |
| 13 | EliminarAlbum | `DELETE /album/albumes/{id}` |

**Seguridad común a todas:** cabecera `Authorization: Bearer <token>`. El usuario
sale del token, nunca del cuerpo. En modo `soap` se exige además que el perfil
tenga `album` en su mapa de servicios (`validarAccesoServicio`).

**Errores comunes a todas** (cuerpo `{ "error": "<código>", "mensaje": "<texto>" }`):

| HTTP | `error` | Cuándo |
|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token o no es válido |
| 403 | `SERVICIO_NO_AUTORIZADO` | El perfil no tiene `album` en su mapa de servicios |
| 503 | `AUTH_NO_DISPONIBLE` | No se pudo consultar a Authentication (no es lo mismo que token inválido) |
| 503 | `FUENTE_NO_DISPONIBLE` | Storage no responde |
| 500 | `ERROR_INTERNO` | Fallo no previsto (el detalle solo queda en el registro del servidor) |

## 3. Contrato de cada operación

### 3.1 ListarFotos

**Descripción:** fotos visibles para el usuario: **propias + compartidas con él**,
paginadas y ordenadas en el servidor.

| Parámetro | Tipo | Obligatorio | Descripción | Restricciones |
|---|---|---|---|---|
| `pagina` | int | No | Página (50 por página) | ≥ 0; por defecto 0 |
| `ordenPor` | enum | No | `RECIENTES` (fecha de captura o de indexación, descendente) o `ALFABETICO` | Por defecto `RECIENTES` |

**Salida:** `200` con `[Foto]` (ver §4).

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `SOLICITUD_INVALIDA` | `pagina` negativa, u `ordenPor` distinto de los dos valores (incluido `MAS_VISTOS`, que solo existe en Streaming) |

**Reglas de negocio:**
- La página 0 **refresca antes el índice** (Home + compartidos) si tiene más de
  un minuto. Lo nuevo aparece sin indexar a mano; una revocación o un borrado
  desaparece en la siguiente consulta.
- Nunca se lista algo que el usuario no pueda leer: el filtro se aplica en la
  consulta, antes de paginar.

### 3.2 BuscarFotos

**Entrada:** `criterioTexto` (mín. 2 caracteres, coincide en el título sin
distinguir mayúsculas), `ordenPor` (por defecto `ALFABETICO`). **Salida:** hasta
100 `[Foto]`. **Errores:** `400 SOLICITUD_INVALIDA` (criterio corto u orden inválido).

### 3.3 ObtenerFoto / 3.4 ObtenerMiniatura / 3.5 ObtenerContenidoFoto

| Operación | Salida |
|---|---|
| ObtenerFoto | `200` `Foto` |
| ObtenerMiniatura | `200 image/jpeg` (320 px de ancho, alto proporcional; generada con FFmpeg al indexar; caché privada 24 h) |
| ObtenerContenidoFoto | `200` el archivo original, leído de Storage con el token del usuario |

| HTTP | `error` | Cuándo |
|---|---|---|
| 404 | `NO_ENCONTRADO` | No existe, el id no es un UUID, o el usuario no puede verla (no se distingue, para no revelar qué ids existen); en la miniatura, también si no se pudo generar |

### 3.6 EliminarFoto

**Descripción:** borra el **archivo en Storage** y su entrada del catálogo (y de
los álbumes que la contenían). Solo borrar del catálogo no serviría: reaparecería
al reindexar. **Salida:** `204`.

| HTTP | `error` | Cuándo |
|---|---|---|
| 404 | `NO_ENCONTRADO` | No existe o no es visible |
| 400 | `SOLICITUD_INVALIDA` | El id es de un video (se borra con Streaming) |
| 403 | `PERMISO_DENEGADO` | Sin permiso de escritura: una foto **compartida** no la puede borrar quien la recibe |

**Regla:** Storage vuelve a comprobar el permiso sobre los bytes con el token del usuario.

### 3.7 IndexarHome

**Descripción:** recorre el Home del usuario en Storage y lo que Shared File
indica como compartido con él; registra fotos y videos, genera miniaturas y
lee duración y dimensiones con FFmpeg. **Salida:** `200`
`{ "indexados": int, "revisados": int, "compartidos": int }`.

**Reglas de negocio:**
- Idempotente: reindexar no duplica; quita del catálogo lo que ya no está en Storage.
- Un archivo compartido se registra a nombre de su **dueño real**, no de quien lo indexa.
- Un archivo que FFmpeg no entiende se omite sin abortar la indexación. Sin FFmpeg
  el servicio funciona igual, sin miniaturas ni duración (la miniatura es una mejora,
  no un bloqueante).
- Si Shared File no responde se conserva la lista anterior de compartidos.

### 3.8 ListarAlbumes / 3.9 CrearAlbum

**ListarAlbumes:** `200` `[{ id, nombre, descripcion, totalFotos, creadoEn }]`, solo los del usuario, más recientes primero.

**CrearAlbum:** cuerpo `{ "nombre": string, "descripcion"?: string }` → `201` `{ id, nombre, descripcion }`.

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `SOLICITUD_INVALIDA` | `nombre` vacío |
| 409 | `CONFLICTO` | El usuario ya tiene un álbum con ese nombre |

### 3.10 VerAlbum

`200` `{ id, nombre, descripcion, fotos: [Foto] }` con las fotos en el orden del
álbum. `404 NO_ENCONTRADO` si no existe o no es del usuario.

**Regla:** al listar se vuelve a comprobar que cada foto siga siendo visible: si
revocaron una compartición, deja de salir en el álbum aunque siga añadida.

### 3.11 AgregarFotoAAlbum / 3.12 QuitarFotoDeAlbum / 3.13 EliminarAlbum

| Operación | Entrada | Salida |
|---|---|---|
| AgregarFotoAAlbum | `{ "medioId": UUID, "orden"?: int }` (por defecto 0; si ya estaba, actualiza el orden) | `204` |
| QuitarFotoDeAlbum | — | `204` (la foto no se borra de Storage) |
| EliminarAlbum | — | `204` (las fotos no se borran) |

`404 NO_ENCONTRADO` si el álbum no es del usuario, o la foto no existe / no es visible / no está en el álbum.

**Regla:** un álbum es del usuario, pero puede contener fotos **compartidas con él**.

## 4. Modelo de datos

**Foto** (respuesta):

| Atributo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Id en el catálogo (no es el id de Storage) |
| `titulo` | string | Nombre del archivo sin extensión |
| `tipo` | string | `foto` |
| `tamanoBytes` | int | |
| `ancho`, `alto` | int \| null | Leídos con FFmpeg |
| `tieneMiniatura` | bool | |
| `fecha` | datetime | Captura si se conoce; si no, indexación |
| `propietario` | string | uid del dueño |
| `compartido` | bool | `true` si es de otro usuario y llegó por una compartición |

**Persistencia** (`node-media/db/schema.sql`): `medios` (índice regenerable, con
copia de propietario, grupo y permisos de Storage), `medios_compartidos` (qué
medios ve cada usuario por compartición), `albumes`, `album_medios`.

## 5. Eventos

No emite eventos: el sistema no tiene bus. La actividad se observa en el
monitoreo (`GET /metrics`: `http_peticiones_total{servicio="media",ruta=~"/album.*"}`,
latencia y errores).

## 6. Integración

- **Quién consume:** los tres clientes; el portal a través de la pasarela node-web.
- **Quién responde:** node-media, delegando los bytes en Storage y la visibilidad
  de lo compartido en Shared File.
- **Momento del flujo:** posterior a Authentication.

## 7. Consideraciones de escalabilidad

- El refresco de la página 0 recorre el Home completo (como mucho una vez por minuto
  y usuario). Con Homes muy grandes conviene que Storage notifique altas y bajas.
- Generar miniaturas es costoso: solo se hace para archivos nuevos o cambiados.

## 8. Casos límite

| Operación | Caso límite | Comportamiento |
|---|---|---|
| ListarFotos | Revocan una compartición mientras el usuario mira el álbum | Desaparece en el siguiente refresco (≤ 1 min); la miniatura deja de servirse |
| EliminarFoto | El archivo ya no existe en Storage | Se quita del catálogo igual (204) |
| CrearAlbum | Dos álbumes con el mismo nombre | `409 CONFLICTO` |
| Cualquiera con id | Id mal formado | `404 NO_ENCONTRADO`, igual que un id inexistente |
| IndexarHome | Archivo corrupto o formato desconocido | Se omite; el resto se indexa |
