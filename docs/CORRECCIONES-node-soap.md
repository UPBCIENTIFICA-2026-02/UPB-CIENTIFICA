# Correcciones pendientes — `node-soap` (Authentication Service)

Revisión del código de `node-soap/back/` (4 archivos: `user.php`, `users.wsdl`,
`mfa.php`, `mfa.wsdl`) contra `CLAUDE.md`, `docs/TRASPASO.md` y lo que los otros
cinco servicios esperan de él.

**Alcance:** solo `node-soap`. Los desajustes que este servicio provoca en
`node-repository`, `node-media`, `node-sync` y `node-web` están en la auditoría
de consistencia; aquí solo se indica qué tiene que cambiar *de este lado*.

**Cómo leer las referencias:** `user.php:137` = archivo
`node-soap/back/user.php`, línea 137.

---

## Estado: la mayor parte ya está aplicada en el repositorio

Este documento se escribió como auditoría, y después se aplicaron los cambios.
Los números de línea de los apartados siguientes corresponden al código **de
antes**; se conservan porque explican qué estaba mal y por qué.

**Ya corregido en el repo** (bloque 0 completo, casi todo el 1, el 2.1 y el 3):

| # | Qué se hizo |
|---|---|
| 0.1, 0.2 | Los comentarios ya no van antes de `<?php` ni antes de la declaración XML |
| 1.2 | `ldap_escape()` en las 6 interpolaciones, con `LDAP_ESCAPE_FILTER` o `_DN` según el sitio, más validación del formato del uid |
| 1.3 | Se rechazan usuario y contraseña vacíos antes de llegar a `ldap_bind` |
| 1.4 | La clave del bind sale de `LDAP_SERVICE_BIND_PW`, **con respaldo al valor de antes** para no romper la VM |
| 1.5 | `random_int()` en vez de `rand()` |
| 1.7 | El MFA se encadena dentro de `iniciarSesion` |
| 2.1 | **Nuevas operaciones `iniciarSesion`, `validarToken` y `cerrarSesion`**, en el código y en el WSDL |
| 2.2 | `roles` (el perfil) y `grupos` se devuelven por separado; el perfil sale de la lista **ordenada**, así que ya no depende del orden de LDAP |
| 3.1–3.6 | `?? null` en los atributos, comprobación de `ldap_search` en `validarAccesoServicio`, mensaje de grupos corregido, `?? ""` en las entradas, `conectarLDAPAdmin()` extraído y `LDAP_OPT_REFERRALS = 0` |
| D3 (2026-10-12) | `obtenerUsuario` devuelve **`homeDirectory`** (atributo de LDAP; elemento opcional en el WSDL). Shared File lo usa como `homePath` |
| D2 (2026-10-12) | `validarAccesoServicio` no cambió, pero ahora **todos los servicios lo llaman** para exigir el mapa de servicios. Nombres que deben existir en `ou=services`: `storage`, `sharedfile`, `album`, `streaming`, `filesync`, `hpc` |

**Lo que hace falta hacer EN LA VM** (los tres cambios llevan respaldo, así que
el servicio sigue funcionando sin tocar nada, pero conviene hacerlos):

1. Copiar a `/var/www/html/soap/` los archivos nuevos y modificados:
   **`sesion.php`** (nuevo, obligatorio), `user.php`, `users.wsdl`, `mfa.php`,
   `mfa.wsdl`. **Lo hace `despliegue/node-soap/desplegar-node-soap.sh`**, que
   además carga `despliegue/node-soap/directorio.ldif` (usuarios con
   `homeDirectory`, grupos y el mapa de servicios en `ou=services`) y comprueba
   que `estudiante` quede sin `hpc`.
2. Añadir a `/etc/apache2/soap-config.php` las constantes
   `LDAP_SERVICE_BIND_PW`, `LDAP_HOST` y `AUTH_TOKEN_SECRET`. La plantilla está
   en `node-soap/back/soap-config.php.example`.
3. **Rotar la clave de la cuenta de servicio de LDAP**: la anterior (`soap`)
   está en el historial de Git y cambiarla en el código no la borra de ahí.

Cada punto que toca la VM está marcado con un comentario `>>> AFECTA A LA
CONFIGURACIÓN DE LA VM <<<` en el archivo correspondiente, con el «antes» y el
«ahora».

**Sigue pendiente** (requiere decisión de equipo o infraestructura, no se tocó):

- **1.1** — las cuatro operaciones de consulta siguen sin exigir sesión. Ahora ya
  existe el token con el que exigirla, pero añadirlo cambia la firma de
  operaciones que el compañero puede estar usando, así que es una decisión suya.
- **1.6** — los OTP siguen en `/tmp` con el código en claro.
- **1.8** — sin límite de intentos en node-soap. (El portal sí limita: 5 fallos
  en 15 min por usuario e IP → 429, en node-web.)
- **4.1–4.3** — el `targetNamespace` sigue siendo la IP y sin versionar, a
  propósito: cambiarlo invalida los stubs de todos los clientes y hay que
  coordinarlo.
- **4.4** — ya hay `.ldif` y script de despliegue en `despliegue/node-soap/`.
  Siguen fuera del repo `slapd.conf` y el *vhost* de Apache (se asumen los de la
  VM del equipo).
- **4.5** — el archivo sigue llamándose `user.php` (no se renombró para no
  romper el despliegue).
- **4.6** — sin verificar si el 8081 sirve TLS de verdad.

---

## Índice

- [Bloque 0 — Impiden que el servicio arranque](#bloque-0--impiden-que-el-servicio-arranque)
- [Bloque 1 — Seguridad](#bloque-1--seguridad)
- [Bloque 2 — Falta el contrato de sesión](#bloque-2--falta-el-contrato-de-sesión)
- [Bloque 3 — Robustez y PHP 8](#bloque-3--robustez-y-php-8)
- [Bloque 4 — Contrato, namespace y despliegue](#bloque-4--contrato-namespace-y-despliegue)
- [Checklist](#checklist)
- [Decisiones que no puedo tomar por el equipo](#decisiones-que-no-puedo-tomar-por-el-equipo)

---

## Bloque 0 — Impiden que el servicio arranque

Dos bugs del mismo tipo: texto emitido antes de donde debe empezar el documento.
Son cuatro líneas en total y bloquean absolutamente todo lo demás.

### 0.1 Comentario HTML antes de `<?php`

`user.php:1` y `mfa.php:1`:

```php
<!-- Servicio SOAP principal (Auth, Perfiles, Grupos, Servicios en LDAP). -->
<?php
```

Todo lo que está fuera de `<?php ... ?>` PHP lo escribe tal cual en la salida.
Ese comentario y su salto de línea se emiten **antes** del sobre SOAP, así que:

- las cabeceras HTTP ya están enviadas cuando `SoapServer` intenta poner
  `Content-Type: text/xml`, y PHP registra un *headers already sent*;
- la respuesta deja de ser XML bien formado (hay texto antes del prólogo), y
  cualquier cliente SOAP la rechaza al parsearla.

Afecta a **todas** las respuestas de ambos endpoints, incluidas las correctas.

**Debería decir** — mover el comentario dentro del bloque PHP:

```php
<?php
/* Servicio SOAP principal (Auth, Perfiles, Grupos, Servicios en LDAP). */
```

Y lo mismo en `mfa.php:1` con su propio texto.


## Bloque 1 — Seguridad

### 1.1 Ninguna de las cinco operaciones exige que el llamante esté autenticado

Este es el hallazgo más grave del servicio.

`user.php:397-403` registra cinco operaciones. Ninguna recibe token, ni
credencial, ni comprueba quién pregunta:

| Operación | Quién puede llamarla hoy | Qué devuelve |
|---|---|---|
| `obtenerUsuario` | cualquiera con acceso al puerto 8081 | nombre, apellido y **correo** de cualquier usuario |
| `obtenerGruposUsuario` | cualquiera | los grupos de cualquier usuario |
| `obtenerPerfilUsuario` | cualquiera | el perfil de cualquier usuario |
| `validarAccesoServicio` | cualquiera | a qué servicios accede cualquier usuario |

Es decir: `node-soap` funciona hoy como una **API de volcado del directorio sin
autenticar**. Basta enumerar `uid` para reconstruir la plantilla de la empresa
con correos incluidos, y para mapear qué perfil accede a qué servicio — que es
justo el reconocimiento previo a un ataque dirigido.

`autenticarUsuario` es la única que tiene sentido sin credencial previa, porque
la credencial *es* su argumento.

**Debería decir:** las cuatro operaciones de consulta tienen que exigir una
sesión válida. Esto no se puede arreglar bien hasta tener el Bloque 2 (no hay
token que exigir todavía), así que el orden correcto es: **primero 2.1, luego
volver aquí**. Dos formas de hacerlo, a elegir:

- añadir un parámetro `token` a cada operación y validarlo al entrar;
- o mover la credencial a una cabecera SOAP (`WS-Security` `UsernameToken`, o
  una cabecera propia), que es más limpio porque no contamina la firma de cada
  operación.

Mientras tanto, y como mitigación inmediata que **no** sustituye a lo anterior:
restringir por IP en la configuración de Apache el acceso a `/soap/` a las VMs
que legítimamente lo consultan.

### 1.2 Inyección de filtro LDAP en cinco sitios

Ninguna entrada se escapa antes de concatenarla en un filtro o en un DN:

| Archivo:línea | Código | Entrada controlada por el llamante |
|---|---|---|
| `user.php:59` | `"uid=" . $usuario . ",ou=people," . $baseDn` | `$usuario` (DN) |
| `user.php:137` | `"(uid=" . $usuario . ")"` | `$usuario` (filtro) |
| `user.php:225` | `"(memberUid=" . $usuario . ")"` | `$usuario` (filtro) |
| `user.php:299` | `"(memberUid=" . $usuario . ")"` | `$usuario` (filtro) |
| `user.php:356` | `"(memberUid=" . $usuario . ")"` | `$usuario` (filtro) |
| `user.php:371` | `"(&(cn=" . $servicio . ")(memberUid=" . $perfilUsuario . "))"` | `$servicio` (filtro) |

Dos explotaciones concretas, sin necesidad de credenciales (ver 1.1):

**Volcado de un usuario arbitrario.** `obtenerUsuario` con `usuario = "*"` genera
el filtro `(uid=*)`, que casa con **todas** las entradas de `ou=people`.
`user.php:175` toma `$datosUsuario[0]`, así que devuelve el registro completo —
correo incluido — del primer usuario del directorio, sin conocer ningún `uid`.

**Autorización falsa.** `validarAccesoServicio` con `servicio = "*"` genera
`(&(cn=*)(memberUid=<perfil>))`: casa con cualquier entrada de `ou=services` que
tenga ese perfil. Si el perfil tiene acceso a **algún** servicio, la operación
responde `success: true` y `"Acceso PERMITIDO al servicio *"`. Un llamante que
pregunte por el servicio `*` obtiene un permiso que nadie le concedió. Con
`servicio = "x)(cn=*"` se puede además reescribir el filtro entero.

**Debería decir** — escapar cada valor con la función de PHP prevista para esto,
usando el contexto correcto en cada caso:

```php
// para filtros (líneas 137, 225, 299, 356, 371)
$usuarioSeguro = ldap_escape($usuario, "", LDAP_ESCAPE_FILTER);
$filtro = "(uid=" . $usuarioSeguro . ")";

// para DN (línea 59)
$usuarioSeguro = ldap_escape($usuario, "", LDAP_ESCAPE_DN);
$userDn = "uid=" . $usuarioSeguro . ",ou=people," . $baseDn;
```

`LDAP_ESCAPE_FILTER` y `LDAP_ESCAPE_DN` **no** son intercambiables: escapan
conjuntos de caracteres distintos. Hay que usar el que corresponde al sitio donde
se interpola.

Conviene además validar el formato del `uid` antes de usarlo (por ejemplo
`preg_match('/^[a-z0-9._-]+$/', $usuario)`), como segunda línea de defensa y para
devolver un error claro en vez de un resultado raro.

### 1.3 El código no comprueba que la contraseña no esté vacía

`user.php:72-76`:

```php
$autenticado = @ldap_bind($ldap, $userDn, $password);
```

`$password` sale directo de `$datos->password` (`user.php:53`) y se pasa a
`ldap_bind` sin ninguna comprobación. Dos rutas llevan a un valor vacío o nulo:

- un cliente que envíe `<password></password>`;
- un cliente que **omita** el elemento. El WSDL lo declara obligatorio
  (`users.wsdl:23`, sin `minOccurs="0"`), pero **`SoapServer` de PHP no valida
  la petición contra el esquema**: `$datos->password` queda sin definir, PHP 8
  emite un *warning* y el valor llega como `null`.

Un *bind* simple con DN presente y credencial vacía es, según RFC 4513 §5.1.1,
un **bind no autenticado**, no un intento fallido de autenticación. Que eso se
traduzca en un acceso concedido depende por completo de la opción
`allow bind_anon_dn` de `slapd`.

> **Sin verificar:** `slapd.conf` no está en el repositorio (ver 4.4), así que no
> puedo comprobar cómo está configurado el directorio. OpenLDAP rechaza estos
> *binds* por omisión, pero eso es una propiedad de la configuración del
> servidor, no de este código.

**Debería decir** — no delegar la decisión en la configuración de LDAP. Rechazar
explícitamente antes de intentar el *bind*:

```php
$usuario  = $datos->usuario  ?? "";
$password = $datos->password ?? "";

if ($usuario === "" || $password === "") {
    return [
        "success" => false,
        "message" => "Usuario o contraseña incorrectos"
    ];
}
```

El `?? ""` resuelve a la vez el *warning* de propiedad no definida. Y conviene
que el mensaje sea el mismo que el de credenciales incorrectas, para no
distinguir "campo vacío" de "clave mala" ante quien sondea.

### 1.4 Contraseña del bind administrativo escrita en el código

`user.php:123`, `user.php:211`, `user.php:290`, `user.php:347`:

```php
$bind = ldap_bind($ldap, LDAP_SERVICE_BIND_DN, "soap");
```

El DN sí está externalizado en `/etc/apache2/soap-config.php`, pero la
contraseña — `"soap"` — está **en el código y versionada en Git**, repetida en
cuatro sitios. Es además una contraseña trivial para una cuenta con permiso de
lectura sobre todo el directorio.

**Debería decir** — sacarla a la misma configuración que el DN y no repetirla:

```php
// en /etc/apache2/soap-config.php, fuera del árbol web y fuera de Git
define("LDAP_SERVICE_BIND_PW", "<clave-fuerte-generada>");
```

```php
// en user.php, en las cuatro llamadas
$bind = ldap_bind($ldap, LDAP_SERVICE_BIND_DN, LDAP_SERVICE_BIND_PW);
```

Y como las cuatro funciones repiten el mismo bloque de "conectar + bind
administrativo + comprobar", conviene extraerlo a una sola función
`conectarLDAPAdmin()` que devuelva la conexión ya autenticada o `false`. Así la
credencial aparece una vez, no cuatro.

**Importante:** la clave `"soap"` ya está en el historial de Git. Cambiarla en el
código no la borra de los commits anteriores, así que hay que **rotarla en el
directorio**, no solo sustituirla en el archivo.

### 1.5 El OTP de MFA se genera con `rand()`

`mfa.php:16`:

```php
$codigo = str_pad(rand(0, 999999), 6, "0", STR_PAD_LEFT);
```

`rand()` no es criptográficamente seguro: su estado interno es reconstruible
observando salidas, así que un atacante que consiga algunos códigos puede
predecir los siguientes. Para un segundo factor eso anula su función.

**Debería decir:**

```php
$codigo = str_pad((string) random_int(0, 999999), 6, "0", STR_PAD_LEFT);
```

`random_int()` usa el generador criptográfico del sistema y tiene la misma firma.

### 1.6 Los OTP se guardan en `/tmp` con nombre predecible

`mfa.php:13` y `mfa.php:42`:

```php
$archivoToken = "/tmp/mfa_" . md5($usuario) . ".json";
```

Tres problemas en una línea:

- **`/tmp` es legible por cualquier proceso del servidor.** El código OTP está en
  claro dentro del JSON (`mfa.php:21`), así que cualquier otro script alojado en
  la misma máquina puede leer el segundo factor de cualquier usuario.
- **El nombre es predecible**: `md5(<uid>)` sin sal. Conocido el `uid`, se conoce
  la ruta exacta.
- **No hay limpieza.** El archivo solo se borra al validarlo o al detectar que
  expiró (`mfa.php:54`, `mfa.php:62`). Los OTP que nadie usa se acumulan
  indefinidamente en `/tmp`.

**Debería decir:** guardar solo un *hash* del código, no el código
(`password_hash()` al generar, `password_verify()` al validar), en un directorio
propio fuera de `/tmp` con permisos `0700` del usuario de Apache. Si el equipo
decide meter estado de sesión en PostgreSQL para el Bloque 2, este estado debería
irse allí también en vez de a disco.

### 1.7 `generarTokenMFA` no exige haber superado la contraseña

`mfa.php:10-33` genera un OTP para **cualquier** `usuario` que se le pase, sin
pedir nada antes. Y `validarTokenMFA` (`mfa.php:38-73`) devuelve
`success: true` pero **no emite nada**: no hay ningún objeto de sesión que
recuerde "este usuario pasó la contraseña *y* pasó el OTP".

Consecuencia de diseño: **el MFA no puede actuar como segundo factor**, porque
los dos factores nunca se combinan en un mismo estado. Son dos comprobaciones
independientes que un cliente puede hacer en cualquier orden, o saltarse.
Y como `generarTokenMFA` no está autenticada (1.1), cualquiera puede generar
códigos para cualquier usuario — lo que además sirve para molestar o para llenar
`/tmp`.

Esto no se arregla con un parche local: es parte del Bloque 2. El flujo correcto
es que la primera fase de `iniciarSesion` devuelva un identificador de intento y
que `generarTokenMFA`/`validarTokenMFA` solo acepten ese identificador.

### 1.8 Sin límite de intentos ni registro

No hay control de intentos en ninguna operación. `autenticarUsuario` acepta
peticiones ilimitadas, así que se puede probar diccionario contra LDAP a la
velocidad que dé la red. Tampoco hay `error_log()` en ningún camino de fallo: un
ataque no deja rastro en ningún sitio.

**Debería decir:** contador de intentos fallidos por `uid` y por IP con bloqueo
temporal, y una línea de `error_log()` en cada rama de fallo (autenticación
fallida, bind administrativo fallido, LDAP inaccesible). El bloqueo puede vivir
donde acabe el estado de sesión del Bloque 2.

---

## Bloque 2 — Falta el contrato de sesión

### 2.1 No existe el concepto de token de sesión. Es lo que bloquea al equipo.

Esto es lo que hay que resolver primero de cara al resto del sistema.

**Lo que `node-soap` expone hoy** (`users.wsdl`, `mfa.wsdl`):

| Operación | Entrada | Salida |
|---|---|---|
| `autenticarUsuario` | `usuario`, `password` | `success`, `message` |
| `obtenerUsuario` | `usuario` | `success`, `message`, `usuario`, `nombre`, `apellido`, `correo` |
| `obtenerGruposUsuario` | `usuario` | `success`, `message`, `grupos[]` |
| `obtenerPerfilUsuario` | `usuario` | `success`, `message`, `usuario`, `perfil` |
| `validarAccesoServicio` | `usuario`, `servicio` | `success`, `message`, `perfil`, `servicio` |
| `generarTokenMFA` | `usuario` | `success`, `message`, `usuario`, `token` |
| `validarTokenMFA` | `usuario`, `token` | `success`, `message` |

**No hay ninguna operación que emita un token de sesión, ni ninguna que valide
uno.** `autenticarUsuario` devuelve un booleano y se olvida del usuario: no deja
nada con lo que el cliente pueda demostrar después que se autenticó.

El único "token" del servicio es el OTP de MFA, y no sirve como credencial de
portador: son 6 dígitos, se consume al validarlo (`mfa.php:62`) y caduca en 5
minutos (`mfa.php:17`).

**Qué está esperando el resto del sistema.** Los cuatro servicios están
construidos alrededor de un token que `node-soap` todavía no emite:

| Servicio | Qué tiene hoy | Qué necesita de `node-soap` |
|---|---|---|
| `node-repository` | `ValidadorSimulado`; `ValidadorSoap.validar()` lanza excepción | `validarToken(token)` → `{ uid, roles[], grupos[] }`. **Los grupos son imprescindibles**: su modelo de permisos Unix evalúa el segmento de grupo |
| `node-media` | copia literal del validador de Storage | lo mismo |
| `node-sync` | `MockValidator` en `interceptor.go` | lo mismo (hoy su interfaz solo contempla `uid`; también hay que ampliarla de su lado) |
| `node-web` | llama por SOAP a operaciones que no existen | `iniciarSesion` → token, y `validarToken` → datos del usuario |
| `job-api` (RMI) | nada | pendiente de decidir cómo entra la identidad en el contrato RMI |

Mientras no exista, los cuatro `TODO` idénticos de los validadores no tienen
contra qué escribirse, y el sistema entero sigue apoyado en tokens
`mock-token-*`. Es el punto 7.1 de `TRASPASO.md`.

**Operaciones que hay que añadir.** Propuesta concreta, tomando como base lo que
`TRASPASO.md §3.4` documenta que espera el cliente móvil y lo que necesitan los
validadores:

| Operación | Entrada | Salida |
|---|---|---|
| `iniciarSesion` | `usuario`, `password`, `origenCliente` | `success`, `message`, `token`, `expiraEn`, `roles[]`, `grupos[]` |
| `validarToken` | `token` | `valido`, `uid`, `roles[]`, `grupos[]`, `expiraEn` |
| `cerrarSesion` | `token` | `success` |

`validarToken` es la crítica: la llaman Storage, media y sync en cada petición.
Tiene que devolver `uid`, `roles` y `grupos` en una sola llamada — si obliga a
encadenar `obtenerGruposUsuario` después, cada petición de archivo cuesta dos
viajes SOAP.

`TRASPASO.md §3.4` menciona además `registrarUsuario`, `obtenerRoles`,
`obtenerPermisos` y `mapaServiciosAutorizados` como parte del contrato de Auth.
De esas, `validarAccesoServicio` cubre parcialmente `obtenerPermisos` pero
pregunta de a un servicio en vez de devolver el mapa completo; las otras tres no
existen. Hay que decidir si entran o si se recorta el contrato — pero no dejarlas
declaradas en la documentación y ausentes del código.

### 2.2 No hay concepto de `roles`, y `perfil` es un invento local

Los otros servicios modelan al usuario como `{ uid, roles[], grupos[] }`: roles y
grupos son cosas distintas. `node-soap` tiene:

- `grupos[]` — los `cn` de `ou=groups` (`user.php:246-274`). Esto sí encaja.
- `perfil` — **el primer grupo que devuelva LDAP** (`user.php:324`,
  `user.php:368`).
- `roles` — **no existe**.

Dos problemas con `perfil`:

**Depende del orden de LDAP, que no está garantizado.** `ldap_search` no ordena;
si el directorio devuelve los grupos en otro orden, el perfil del usuario cambia
solo. Y `node-repository` hace exactamente la misma suposición por su cuenta
(`grupo: usuario.grupos?.[0] || "usuarios"`): coinciden por casualidad, no por
contrato.

**Usa `memberUid` para guardar nombres de grupo.** `user.php:371` busca en
`ou=services` con `(memberUid=<nombre-de-grupo>)`. Según RFC 2307, `memberUid`
contiene `uid` **de usuarios**, no nombres de grupos. Funciona porque LDAP no
valida la semántica, pero es un uso indebido del esquema que confundirá a
cualquiera que mire el directorio.

**Debería decir:** decidir con el equipo qué es un rol y qué es un grupo en este
sistema, y que la respuesta de `validarToken` los devuelva por separado. Si
"perfil" va a ser el grupo primario del usuario, debe salir de un atributo
explícito (`gidNumber`, o un `employeeType`/atributo propio), no de la posición 0
de una lista sin orden. Para `ou=services` conviene un atributo de pertenencia
adecuado (`member` con DN completos, u `objectClass` propia) en lugar de
`memberUid`.

### 2.3 `node-web` habla un contrato que nadie del lado PHP aceptó

No es un bug de `node-soap`, pero afecta directamente a cómo se diseñe el Bloque
2, así que conviene tenerlo delante. `node-web/src/identidad.js` está escrito
contra esto:

| `identidad.js` | node-web envía | node-soap ofrece |
|---|---|---|
| línea 31 | `POST /identidad.php` | `/soap/user.php` y `/soap/mfa.php` |
| línea 18 | namespace `urn:upbc:identidad` | `http://192.168.1.195/soap` |
| línea 46 | `iniciarSesion(usuario, clave, codigoMfa)` | `autenticarUsuario(usuario, password)` |
| líneas 47, 53 | espera `<token>`, `<expiraEn>` | no existen |
| línea 58 | `validarToken(token)` | no existe |
| líneas 59-65 | espera `<valido>`, `<usuario>`, `<nombre>`, `<uid>`, `<gid>`, `<cuotaMb>` | ninguno existe |

`node-web` lo construyó contra su propio simulador
(`node-web/herramientas/nodos-falsos.js:35`) y su propia documentación
(`node-web/docs/contratos.md`) lo marca como «PROPUESTA».

Ojo con dos detalles al conciliar, porque van en direcciones distintas:

- `node-web` espera `uid` y `gid` **numéricos** (`Number(...)`, líneas 63-64).
  `node-soap` maneja el `uid` de LDAP, que es una **cadena** (`jperez`), igual
  que `node-repository` y `node-sync`. `Number("jperez")` da `NaN`. El modelo de
  `node-web` es el que está fuera de línea, pero hay que decirlo explícitamente
  para que lo cambien.
- `node-web` espera `cuotaMb` en la respuesta de identidad. La cuota vive en
  `node-repository` (`cuotas.conf`, y `GET /storage/cuota`), no en LDAP. Ese
  campo no debería estar en el contrato de Auth.

**Debería decir:** acordar un solo contrato entre los dos frentes antes de
escribir código. El de 2.1 es la propuesta desde el lado de `node-soap`; si se
adopta, `identidad.js` tiene que cambiar el endpoint, el namespace, los nombres
de operación y el modelo de usuario.

---

## Bloque 3 — Robustez y PHP 8

### 3.1 Atributos de LDAP leídos sin comprobar que existan

`user.php:181-184`:

```php
"usuario" => $usuarioLDAP["uid"][0],
"nombre"  => $usuarioLDAP["cn"][0],
"apellido"=> $usuarioLDAP["sn"][0],
"correo"  => $usuarioLDAP["mail"][0]
```

En LDAP ningún atributo está garantizado salvo los que exija el `objectClass`.
`mail` es opcional en `inetOrgPerson`. Si una entrada no lo tiene, PHP 8 emite un
*warning* de índice no definido y el valor sale vacío — o la petición acaba en un
*fault* genérico, dependiendo de la configuración de errores.

Mismo patrón en `user.php:266` (`["cn"][0]` de cada grupo), `user.php:324` y
`user.php:368`.

**Debería decir:**

```php
"correo" => $usuarioLDAP["mail"][0] ?? null,
```

Y declarar esos elementos `nillable="true"` en el WSDL, o dejarlos con el
`minOccurs="0"` que ya tienen (`users.wsdl:53-56`) y omitirlos de la respuesta
cuando no haya valor.

### 3.2 `ldap_get_entries` sobre un resultado sin comprobar

`user.php:357-358`:

```php
$busquedaPerfil = ldap_search($ldap, "ou=groups," . $baseDn, $filtroPerfil);
$resPerfil = ldap_get_entries($ldap, $busquedaPerfil);
```

Si `ldap_search` falla devuelve `false`, y en PHP 8 pasar `false` a
`ldap_get_entries` lanza un `TypeError` — que sin `try/catch` se convierte en un
*fault* SOAP sin información útil. Mismo caso en `user.php:372-373`
(`$busquedaServicio`).

Las otras tres funciones **sí** comprueban (`user.php:145`, `user.php:235`,
`user.php:302`). Es una omisión solo en `validarAccesoServicio`.

**Debería decir** — comprobar antes de usar, como hacen las demás:

```php
if (!$busquedaPerfil) {
    ldap_unbind($ldap);
    return [
        "success" => false,
        "message" => "No fue posible consultar los grupos"
    ];
}
$resPerfil = ldap_get_entries($ldap, $busquedaPerfil);
```

### 3.3 «No se encontraron grupos» nunca se dispara por no tener grupos

`user.php:235-243` interpreta `!$busqueda` como «no hay grupos». Pero
`ldap_search` devuelve un recurso válido cuando la búsqueda va bien y no casa
nada; solo devuelve `false` si la búsqueda **falla**. Así que ese mensaje aparece
ante un error de LDAP, y un usuario sin grupos recibe `success: true` con
`grupos` vacío.

El comportamiento (`success: true`, lista vacía) es el correcto; el mensaje es el
que engaña, y contrasta con `obtenerPerfilUsuario`, que sí distingue el caso
comprobando `count == 0` (`user.php:313`).

**Debería decir:** dejar el mensaje de error para el fallo real («No fue posible
consultar los grupos») y, si hace falta distinguir, comprobar
`$gruposLDAP["count"] == 0` aparte.

### 3.4 Propiedades de entrada leídas sin comprobar

`$datos->usuario`, `$datos->password`, `$datos->servicio` y `$datos->token` se
leen directamente en las siete funciones. `SoapServer` **no valida la petición
contra el esquema del WSDL**, así que un cliente que omita un elemento provoca un
*warning* de propiedad no definida y un `null` que sigue camino hacia LDAP (es la
vía de 1.3).

**Debería decir:** `$usuario = $datos->usuario ?? "";` en las siete funciones, y
rechazar explícitamente los valores vacíos con un mensaje de dominio.

### 3.5 Bloque de conexión repetido cuatro veces

`obtenerUsuario`, `obtenerGruposUsuario`, `obtenerPerfilUsuario` y
`validarAccesoServicio` repiten el mismo bloque: `conectarLDAP()`, comprobar,
`ldap_bind` administrativo, comprobar, `ldap_unbind` al salir por cada rama. Son
unas 20 líneas duplicadas por función, y es la razón por la que la credencial de
1.4 está en cuatro sitios y por la que 3.2 se olvidó en una de ellas.

**Debería decir:** extraer `conectarLDAPAdmin()` que devuelva la conexión
autenticada o `false`. Reduce la superficie de los tres problemas anteriores a un
único punto.

### 3.6 `conectarLDAP()` no desactiva las referencias

`user.php:14-45` fija `LDAP_OPT_PROTOCOL_VERSION` pero no
`LDAP_OPT_REFERRALS`. Con referencias activas, ciertas respuestas del directorio
hacen que la búsqueda intente seguir un enlace a otro servidor y falle de forma
difícil de diagnosticar.

**Debería decir:** añadir, junto a la opción de versión:

```php
ldap_set_option($ldap, LDAP_OPT_REFERRALS, 0);
```

No cambia nada en el caso normal; evita un fallo intermitente y opaco.

---

## Bloque 4 — Contrato, namespace y despliegue

### 4.1 El namespace es una dirección IP

`users.wsdl:6-7` y `mfa.wsdl:4-5`:

```xml
targetNamespace="http://192.168.1.195/soap"
xmlns:tns="http://192.168.1.195/soap"
```

El `targetNamespace` es la identidad del contrato: entra en los stubs generados
de todos los clientes (Java, PHP, y el XML manual del móvil). Atarlo a una IP
significa que **cambiar de IP la VM rompe a todos los clientes**, aunque el
servicio sea idéntico. Y si el equipo mueve el despliegue del laboratorio al CCA,
la IP cambia.

Los `soapAction` heredan el problema (`users.wsdl:230`, `246`, `262`, `276`,
`289`).

**Debería decir** — un URN estable e independiente de dónde esté desplegado:

```xml
targetNamespace="urn:upbcientifica:auth:v1"
```

El namespace identifica el contrato; la ubicación va en `soap:address`, que es
donde corresponde y lo único que debería cambiar entre entornos.

### 4.2 El WSDL no está versionado, y `Contrato_Auth` lo exige

`TRASPASO.md §2.2` cita literalmente del contrato: *«Protocolo: SOAP
exclusivamente, vía WSDL versionado»*. No hay número de versión en ninguna parte:
ni en el namespace, ni en el nombre del servicio, ni en la ruta.

Importa más aquí que en el resto del sistema, porque el Bloque 2 va a añadir
operaciones a un contrato del que ya cuelgan cinco clientes. Sin versión no hay
forma de que convivan el contrato viejo y el nuevo durante la migración.

**Debería decir:** el `:v1` de 4.1, y que los cambios que rompan compatibilidad
publiquen `:v2` en una ruta propia en vez de modificar `v1` en el sitio.

### 4.3 Los dos WSDL comparten `targetNamespace`

`users.wsdl:6` y `mfa.wsdl:4` declaran el mismo `http://192.168.1.195/soap` pero
definen servicios distintos (`UsersService` y `MFAService`) con tipos distintos.
Que dos documentos declaren el mismo namespace es válido en XML, pero un cliente
que importe los dos ve un namespace con definiciones que no están en un solo
documento, y algunas herramientas de generación de stubs se quejan o resuelven
mal.

**Debería decir:** namespaces distintos —
`urn:upbcientifica:auth:v1` y `urn:upbcientifica:mfa:v1` — o, mejor, un único
WSDL si MFA va a formar parte del flujo de `iniciarSesion` como propone 1.7.

### 4.4 Faltan los artefactos de despliegue y de LDAP

La carpeta `node-soap/` contiene **solo** los cuatro archivos de código. Falta
todo lo demás que el diagrama de despliegue le atribuye a esa VM
(`TRASPASO.md §3.2`):

| Artefacto | Estado | Para qué hace falta |
|---|---|---|
| `slapd.conf` | ❌ no está en el repo | Es lo que decide si 1.3 es explotable. Sin versionarlo nadie puede auditar el directorio |
| `upb-cientifica.ldif` | ❌ no está en el repo | Sin él no se puede recrear el directorio: nadie más del equipo puede levantar un entorno de pruebas |
| `soap-config.php` | ❌ no está (correcto: lleva secretos) | Falta un `soap-config.php.example` que documente qué constantes hay que definir (`LDAP_SERVICE_BIND_DN`, y `LDAP_SERVICE_BIND_PW` tras 1.4) |
| Script de instalación | ❌ no existe | `node-web` tiene `despliegue/instalar.sh` y `node-web.service`; aquí no hay nada que explique cómo `back/` acaba en `/var/www/html/soap/` |
| Configuración de Apache | ❌ no está | `users.wsdl:312` declara `https` en el 8081; no hay nada en el repo que configure ese *virtual host* ni su TLS |

Las rutas absolutas de `user.php:6` (`/var/www/html/soap/users.wsdl`) y
`mfa.php:4` dan por hecho ese destino sin documentarlo en ningún sitio.

**Debería decir:** una carpeta `node-soap/despliegue/` con el `.ldif`, el
`slapd.conf`, el `soap-config.php.example`, el *virtual host* de Apache y un
`instalar.sh`, siguiendo el patrón que ya usa `node-web/despliegue/`.

### 4.5 El archivo se llama `user.php`; el diagrama dice `users.php`

`TRASPASO.md §3.2` lista los artefactos de la VM `node-soap` como
`mfa.php`, `users.php`, `users.wsdl`. El archivo real es **`user.php`**
(singular), y así lo referencia `users.wsdl:312`. El WSDL sí está en plural.

Es cosmético, pero es el tipo de detalle que hace perder media hora a quien
despliegue siguiendo el diagrama. **Debería decir:** renombrar a `users.php`
para que concuerde con el diagrama y con el WSDL, y actualizar `soap:address`; o
corregir el diagrama. Cualquiera de las dos, pero que coincidan.

### 4.6 Confirmar que el 8081 sirve TLS de verdad

`users.wsdl:312` y `mfa.wsdl:98` declaran `location="https://192.168.1.195:8081/..."`.
Pero los clientes están configurados con `http`:
`node-web/rutas-servicio.json:5` y `node-repository/.env:9` usan
`http://node-soap:8081`.

`TRASPASO.md §3.1` dice que ese enlace es «SOAP / HTTPS 8081», así que el WSDL es
el que tiene razón y los clientes están mal. Pero no hay en el repositorio
ninguna configuración de Apache que confirme que el 8081 termina TLS (ver 4.4).

> **Sin verificar:** no tengo acceso a la VM. Si el 8081 solo habla HTTP, el
> `soap:address` está mintiendo y **las contraseñas de `autenticarUsuario` viajan
> en claro** por la red interna. Hay que comprobarlo antes que nada.

---

## Checklist

Orden sugerido. El Bloque 0 primero porque sin él no se puede probar nada; 2.1
antes de 1.1 porque no se puede exigir un token que todavía no se emite.

**Ahora (el servicio no arranca)**

- [ ] 0.1 — Mover el comentario dentro de `<?php` en `user.php:1` y `mfa.php:1`
- [ ] 0.2 — Poner la declaración XML primero en `users.wsdl:1` y `mfa.wsdl:1`
- [ ] 4.6 — Comprobar si el 8081 sirve TLS; si no, no pasar de aquí

**Seguridad que no depende del Bloque 2**

- [ ] 1.2 — `ldap_escape()` en las 6 interpolaciones (`user.php:59, 137, 225, 299, 356, 371`)
- [ ] 1.3 — Rechazar usuario o contraseña vacíos antes del `ldap_bind` (`user.php:72`)
- [ ] 1.4 — Sacar la contraseña `"soap"` a configuración (4 sitios) **y rotarla en el directorio**
- [ ] 1.5 — `random_int()` en vez de `rand()` (`mfa.php:16`)
- [ ] 1.6 — Guardar hash del OTP, fuera de `/tmp`, con limpieza
- [ ] 1.8 — Límite de intentos y `error_log()` en las ramas de fallo

**El contrato (desbloquea a los otros cuatro servicios)**

- [ ] 2.1 — Añadir `iniciarSesion`, `validarToken` y `cerrarSesion`, con `uid`, `roles[]` y `grupos[]` en una sola respuesta
- [ ] 2.2 — Separar roles de grupos; dejar de derivar `perfil` de la posición 0
- [ ] 1.7 — Encadenar MFA al intento de sesión
- [ ] 1.1 — Exigir sesión válida en las cuatro operaciones de consulta
- [ ] 2.3 — Acordar el contrato con quien mantiene `node-web`

**Robustez**

- [ ] 3.1 — `?? null` en los accesos a atributos LDAP (`user.php:181-184, 266, 324, 368`)
- [ ] 3.2 — Comprobar `ldap_search` en `validarAccesoServicio` (`user.php:357, 372`)
- [ ] 3.3 — Corregir el mensaje de «No se encontraron grupos» (`user.php:235-241`)
- [ ] 3.4 — `?? ""` en las propiedades de entrada de las 7 funciones
- [ ] 3.5 — Extraer `conectarLDAPAdmin()`
- [ ] 3.6 — `LDAP_OPT_REFERRALS = 0` (`user.php:38`)

**Contrato y despliegue**

- [ ] 4.1 — `targetNamespace` a `urn:upbcientifica:auth:v1`
- [ ] 4.2 — Versionar el WSDL como exige `Contrato_Auth`
- [ ] 4.3 — Namespace propio para MFA, o unificar los dos WSDL
- [ ] 4.4 — Crear `node-soap/despliegue/` con `.ldif`, `slapd.conf`, `soap-config.php.example`, *vhost* e `instalar.sh`
- [x] 4.5 — Se mantiene `user.php`; el diagrama de despliegue v2 ya lo nombra así (con `sesion.php` y `mfa.php`)

---

## Decisiones que no puedo tomar por el equipo

1. **Formato del token: opaco o autocontenido.** Determina casi todo el Bloque 2.
   - *Opaco* (un identificador aleatorio, el estado en el servidor): permite
     revocar sesiones de verdad, que es lo que `node-web/src/identidad.js:6-9`
     dice que se buscaba. Pero exige un almacén de sesiones que `node-soap` no
     tiene — LDAP no es el sitio adecuado, así que haría falta PostgreSQL en esa
     VM — y obliga a consultar a Auth en cada petición, que es el cuello de
     botella que advierten los comentarios de los validadores.
   - *Autocontenido* (JWT firmado): cada servicio valida sin preguntar, sin
     cuello de botella. Pero hay que distribuir la clave de firma a PHP, Node, Go
     y Java, y **no se puede revocar** antes de que caduque.
   - Si se elige opaco, la caché de unos segundos que sugieren los cuatro
     validadores es imprescindible, no opcional.

2. **Qué es un rol y qué es un grupo** en este sistema, y de qué atributo de LDAP
   sale cada uno (ver 2.2). Los permisos Unix de `node-repository` dependen de
   los grupos; nadie usa los roles todavía, pero los tres validadores los
   declaran.

3. **Si el MFA es obligatorio o opcional**, y para qué orígenes de cliente. El
   móvil y `fsagent` guardan credenciales en `credencial.local` según el diagrama
   de despliegue, lo que encaja mal con pedir un OTP en cada sincronización.
   `iniciarSesion` recibe `origenCliente` precisamente para poder distinguir.

4. **Si entran `registrarUsuario`, `obtenerRoles`, `obtenerPermisos` y
   `mapaServiciosAutorizados`** (ver 2.1), o si se recorta el contrato
   documentado en `TRASPASO.md §3.4`.

5. **Cómo entra la identidad en el contrato RMI.** `JobService` no tiene
   parámetro de usuario en ningún método, así que autenticar ahí obliga a cambiar
   la interfaz y recompilar `common`, `gestor-cluster` y `job-api`. Afecta al
   diseño de `validarToken` si el gestor va a llamarlo desde Java.

---

## Lo que no pude verificar

- **Si el servicio corre hoy.** Los dos bugs del Bloque 0 lo impiden tal como
  está el código, pero no tengo acceso a `192.168.1.195`. Si allí responde, la
  copia desplegada difiere del repositorio.
- **La configuración de `slapd`.** Determina si 1.3 es explotable y qué permisos
  reales tiene la cuenta de servicio. No está versionada (4.4).
- **Qué define `soap-config.php`.** Vive en `/etc/apache2/`, fuera del repo. Del
  código se deduce que define `LDAP_SERVICE_BIND_DN`; no sé si define algo más.
- **Si el 8081 termina TLS** (4.6).
- **El texto de `Contrato Auth.pdf`.** Comparé contra lo que `TRASPASO.md` cita
  de él, no contra el original.
- **Qué contrato de Auth espera el cliente móvil.** No está en este repositorio;
  me basé en lo que documenta `TRASPASO.md §3.4`.
