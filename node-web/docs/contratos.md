# Contratos entre node-web y los demás servicios

Estado a la fecha: dos servicios ya existen y este documento refleja **lo que
realmente exponen**, no lo que se propuso al principio. Los otros tres siguen
siendo propuesta.

`herramientas/nodos-falsos.js` imita exactamente estos formatos, así que sirve
como especificación ejecutable: basta comparar la respuesta real contra la falsa.

---

## node-rmi · Trabajos MPI — YA EXISTE

Repositorio `RMIUPBCientifica`, módulo `job-api` (Spring Boot + cliente RMI).

| Operación | Endpoint |
|---|---|
| Listar | `GET /jobs` → **arreglo** de trabajos |
| Consultar | `GET /jobs/{id}` |
| Estado | `GET /jobs/{id}/estado` |
| Crear | `POST /jobs` con `{ nombre, comando, prioridad }` → `{ id }` |
| Cancelar | `DELETE /jobs/{id}` → `{ id, cancelado }` |

Trabajo completo:

```json
{ "id": "uuid", "nombre": "...", "comando": "mpirun -np 4 ./sim",
  "prioridad": 5, "estado": "RUNNING",
  "fechaCreacion": "...", "fechaInicio": "...", "fechaFin": "...",
  "resultado": "...", "mensajeError": "..." }
```

Estados: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`.
node-web los traduce a `EN_COLA`, `EJECUTANDO`, `TERMINADO`, `FALLIDO`, `CANCELADO`.

**Pendientes con este servicio:**
- Escucha en `8080`; el plan de puertos del diagrama le asigna **8082**.
- No exige token ni filtra por usuario: cualquiera ve y cancela los trabajos de todos.
- El registro RMI usa `1099`; el diagrama de despliegue dice `2099`.

---

## node-repository · Shared File — YA EXISTE

Repositorio `UPB-CIENTIFICA`, módulo `node-repository`. Puerto `8084`. ✔

| Operación | Endpoint |
|---|---|
| Listar directorio | `GET /storage/directorios/{id}` (`root` para la raíz) → **arreglo** |
| Crear directorio | `POST /storage/directorios` con `{ nombre, directorioPadreId }` |
| Subir | `POST /storage/archivos` multipart, campo `archivo` |
| Descargar | `GET /storage/archivos/{id}/descargar` |
| Eliminar | `DELETE /storage/archivos/{id}` |
| Cuota | `GET /storage/cuota` → `{ usados, cuota, disponibles }` en bytes |
| Salud | `GET /health` |

Nodo de archivo:

```json
{ "id": "...", "nombre": "...", "tipo": "archivo|directorio",
  "tamanoBytes": 251658240, "version": 2, "directorioContenedorId": null }
```

Autenticación: `Authorization: Bearer <token>`. En modo simulado acepta
`mock-token-<usuario>`.

**Pendientes con este servicio:**
- No expone compartición entre usuarios. node-web responde `501` en esa ruta.
- El modelo es por identificador de nodo, no por ruta del Home.

---

## node-soap · Identidad — PROPUESTA

**`iniciarSesion(usuario, clave, codigoMfa)`** → `<token>`, `<expiraEn>`

**`validarToken(token)`** → `<valido>`, `<usuario>`, `<nombre>`, `<uid>`, `<gid>`, `<cuotaMb>`

node-repository necesita además **roles y grupos** para evaluar los permisos Unix
del segmento de grupo. Debe incluirse en la respuesta.

---

## node-media · Álbum y streaming — PROPUESTA

**`GET /album?orden=<fecha|nombre>`** → `{ orden, fotos: [{ id, titulo, fecha }] }`

**`GET /videos`** → `{ videos: [{ id, titulo, duracionSeg, fecha }] }`

Pendiente de acordar cómo se entrega el flujo de reproducción.

---

## node-monitoreo · Estado — PROPUESTA

**`GET /api/estado`** → `{ nodos: [{ nombre, cpu, memoria, disco, arriba }] }`

Porcentajes de 0 a 100 como número.

---

## Decisiones que faltan y afectan a todos

1. **Formato del token.** Cada frente inventó su marcador de posición: node-web
   consulta por SOAP, node-repository acepta `mock-token-<usuario>`, node-rmi no
   pide nada. Hasta que node-soap defina el formato, no hay integración real.
2. **Quién aplica los permisos.** node-repository ya los evalúa; node-rmi no.
3. **Puertos.** El plan del diagrama es la referencia: 8081 identidad,
   8082 trabajos, 8083 medios, 8084 archivos, 3000 monitoreo.
