<?php
/*
 * Servicio SOAP principal (Auth, Perfiles, Grupos, Servicios en LDAP).
 *
 * ============================================================================
 *  >>> CAMBIOS QUE AFECTAN A LA CONFIGURACIÓN DE LA VM node-soap <<<
 * ============================================================================
 *
 *  Son tres, y los tres tienen respaldo (fallback) para que el servicio siga
 *  funcionando EXACTAMENTE como hoy si no se configura nada en la VM.
 *
 *  1) ARCHIVO NUEVO QUE HAY QUE DESPLEGAR
 *     ANTES: solo user.php, users.wsdl, mfa.php y mfa.wsdl en
 *            /var/www/html/soap/.
 *     AHORA: hace falta copiar también `sesion.php` a esa misma carpeta.
 *            Sin él, `require_once` falla y el servicio no arranca.
 *            No hay que tocar Apache: la ruta es relativa a este archivo.
 *
 *  2) CONTRASEÑA DEL BIND ADMINISTRATIVO
 *     ANTES: escrita en el código, repetida 4 veces:
 *              ldap_bind($ldap, LDAP_SERVICE_BIND_DN, "soap");
 *     AHORA: sale de la constante LDAP_SERVICE_BIND_PW, que hay que añadir a
 *            /etc/apache2/soap-config.php (junto a LDAP_SERVICE_BIND_DN):
 *              define("LDAP_SERVICE_BIND_PW", "<clave>");
 *            Si NO se define, se sigue usando "soap" y se registra un aviso en
 *            el log de Apache. Es decir: funciona sin tocar nada, pero conviene
 *            definirla y rotar la clave (la vieja ya está en el historial Git).
 *
 *  3) DIRECCIÓN DEL SERVIDOR LDAP
 *     ANTES: "ldaps://192.168.1.195" escrita en el código.
 *     AHORA: sale de la constante LDAP_HOST si está definida en
 *            soap-config.php; si no, se usa la misma IP de antes.
 *            Se añade también LDAP_OPT_REFERRALS = 0, que no cambia el
 *            comportamiento normal pero evita fallos intermitentes de búsqueda.
 *
 *  LO QUE NO SE TOCA: el esquema ni los datos de OpenLDAP, slapd.conf, el
 *  VirtualHost de Apache, el nombre de este archivo (sigue siendo user.php,
 *  en singular, como lo referencia el WSDL) y el targetNamespace del WSDL
 *  (sigue siendo http://192.168.1.195/soap, para no invalidar ningún cliente
 *  de prueba que ya exista).
 *
 *  Las cinco operaciones que ya existían —autenticarUsuario, obtenerUsuario,
 *  obtenerGruposUsuario, obtenerPerfilUsuario y validarAccesoServicio— reciben
 *  y devuelven lo mismo que antes. Se añaden tres nuevas: iniciarSesion,
 *  validarToken y cerrarSesion.
 * ============================================================================
 */

require_once "/etc/apache2/soap-config.php";
require_once __DIR__ . "/sesion.php";

$wsdl = __DIR__ . "/users.wsdl";

$server = new SoapServer($wsdl);

/** Base del directorio. Un solo sitio donde cambiarla. */
const BASE_DN = "dc=upb-cientifica,dc=local";


/*
 * Conexión segura con OpenLDAP mediante LDAPS.
 */
function conectarLDAP()
{
    // Ver nota (3) de la cabecera: constante con respaldo a la IP de siempre.
    $ldapHost = defined("LDAP_HOST") && LDAP_HOST !== ""
        ? LDAP_HOST
        : "ldaps://192.168.1.195";

    $ldapPort = 636;

    /*
     * La CA debe configurarse antes de ldap_connect()
     * para la conexión LDAPS.
     */
    ldap_set_option(
        NULL,
        LDAP_OPT_X_TLS_CACERTFILE,
        "/etc/ldap/certs/ca.crt"
    );

    $ldap = ldap_connect(
        $ldapHost,
        $ldapPort
    );

    if (!$ldap) {
        return false;
    }

    ldap_set_option(
        $ldap,
        LDAP_OPT_PROTOCOL_VERSION,
        3
    );

    /*
     * Sin esto, ciertas respuestas del directorio hacen que la búsqueda intente
     * seguir una referencia a otro servidor y falle de forma difícil de
     * diagnosticar. No altera el caso normal.
     */
    ldap_set_option(
        $ldap,
        LDAP_OPT_REFERRALS,
        0
    );

    return $ldap;
}


/*
 * Clave del bind administrativo. Ver nota (2) de la cabecera.
 */
function claveServicioLDAP()
{
    if (defined("LDAP_SERVICE_BIND_PW") && LDAP_SERVICE_BIND_PW !== "") {
        return LDAP_SERVICE_BIND_PW;
    }

    error_log(
        "[upbc-auth] AVISO: LDAP_SERVICE_BIND_PW no está definido en " .
        "soap-config.php; se usa la clave heredada del código. Defínela y " .
        "rota la clave en el directorio."
    );

    return "soap";
}


/*
 * Conecta y autentica con la cuenta de servicio.
 *
 * Antes este bloque estaba repetido en las cuatro operaciones de consulta, y
 * era la razón por la que la credencial aparecía cuatro veces y por la que a
 * validarAccesoServicio se le olvidó comprobar el resultado de ldap_search.
 *
 * @return resource|false la conexión ya autenticada, o false
 */
function conectarLDAPAdmin()
{
    $ldap = conectarLDAP();
    if (!$ldap) {
        return false;
    }

    $bind = @ldap_bind($ldap, LDAP_SERVICE_BIND_DN, claveServicioLDAP());
    if (!$bind) {
        error_log("[upbc-auth] no se pudo autenticar la cuenta de servicio en LDAP");
        @ldap_unbind($ldap);
        return false;
    }

    return $ldap;
}


/*
 * Escapado de valores que van dentro de un filtro LDAP.
 *
 * Sin esto, un `usuario` con valor "*" convierte (uid=*) en "cualquier
 * usuario", y un valor como "x)(cn=*" reescribe el filtro completo.
 */
function filtroSeguro($valor)
{
    return ldap_escape((string) $valor, "", LDAP_ESCAPE_FILTER);
}

/** Escapado de valores que van dentro de un DN (reglas distintas al filtro). */
function dnSeguro($valor)
{
    return ldap_escape((string) $valor, "", LDAP_ESCAPE_DN);
}

/** Acepta solo identificadores con forma de uid de LDAP. */
function uidValido($valor)
{
    return is_string($valor) && preg_match('/^[A-Za-z0-9._-]{1,64}$/', $valor) === 1;
}


/*
 * Grupos de un usuario, ORDENADOS.
 *
 * El orden importa: el "perfil" se deriva del primer grupo, y ldap_search no
 * garantiza ningún orden. Ordenar aquí hace que el perfil sea estable entre
 * llamadas en lugar de depender de cómo responda el directorio esa vez.
 *
 * NOTA PARA EL EQUIPO: lo correcto sería que el perfil saliera de un atributo
 * propio del usuario (gidNumber, employeeType o uno específico), no de la
 * posición 0 de una lista. Mientras eso no exista, al menos es determinista.
 *
 * @return string[]|null null si la consulta falla
 */
function gruposDe($ldap, $usuario)
{
    $filtro = "(memberUid=" . filtroSeguro($usuario) . ")";

    $busqueda = ldap_search($ldap, "ou=groups," . BASE_DN, $filtro);
    if (!$busqueda) {
        return null;
    }

    $resultado = ldap_get_entries($ldap, $busqueda);
    if (!is_array($resultado)) {
        return null;
    }

    $grupos = [];
    for ($i = 0; $i < $resultado["count"]; $i++) {
        if (isset($resultado[$i]["cn"][0])) {
            $grupos[] = $resultado[$i]["cn"][0];
        }
    }

    sort($grupos, SORT_STRING);
    return $grupos;
}


/*
 * AUTENTICAR USUARIO
 *
 * Contrato sin cambios: recibe { usuario, password } y devuelve
 * { success, message }. Lo único que cambia por dentro es que ahora rechaza
 * las credenciales vacías antes de llegar a LDAP (ver abajo) y que escapa el
 * uid al construir el DN.
 */
function autenticarUsuario($datos)
{
    $usuario = $datos->usuario ?? "";
    $password = $datos->password ?? "";

    /*
     * Un bind con DN presente y contraseña vacía es, según RFC 4513, un "bind
     * no autenticado", no un intento fallido. Que se acepte o no depende de la
     * opción `allow bind_anon_dn` de slapd; este código no debe delegar en esa
     * configuración. Se rechaza aquí, con el mismo mensaje que una contraseña
     * incorrecta para no revelar qué falló.
     */
    if ($usuario === "" || $password === "" || !uidValido($usuario)) {
        return [
            "success" => false,
            "message" => "Usuario o contraseña incorrectos"
        ];
    }

    $userDn =
        "uid=" . dnSeguro($usuario) .
        ",ou=people," .
        BASE_DN;

    $ldap = conectarLDAP();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $autenticado = @ldap_bind(
        $ldap,
        $userDn,
        $password
    );

    if ($autenticado) {

        ldap_unbind($ldap);

        return [
            "success" => true,
            "message" => "Autenticación exitosa"
        ];
    }

    @ldap_unbind($ldap);

    error_log("[upbc-auth] autenticación fallida para uid=" . $usuario);

    return [
        "success" => false,
        "message" => "Usuario o contraseña incorrectos"
    ];
}


/*
 * OBTENER INFORMACIÓN DEL USUARIO
 *
 * Contrato sin cambios.
 */
function obtenerUsuario($datos)
{
    $usuario = $datos->usuario ?? "";

    if (!uidValido($usuario)) {
        return [
            "success" => false,
            "message" => "Identificador de usuario inválido"
        ];
    }

    $ldap = conectarLDAPAdmin();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $filtro = "(uid=" . filtroSeguro($usuario) . ")";

    $busqueda = ldap_search(
        $ldap,
        "ou=people," . BASE_DN,
        $filtro
    );

    if (!$busqueda) {

        ldap_unbind($ldap);

        return [
            "success" => false,
            "message" => "No fue posible realizar la búsqueda"
        ];
    }


    $datosUsuario =
        ldap_get_entries(
            $ldap,
            $busqueda
        );


    ldap_unbind($ldap);


    if (!is_array($datosUsuario) || $datosUsuario["count"] == 0) {

        return [
            "success" => false,
            "message" => "Usuario no encontrado"
        ];
    }


    $usuarioLDAP = $datosUsuario[0];


    /*
     * En LDAP ningún atributo está garantizado salvo los que exija el
     * objectClass: `mail` es opcional en inetOrgPerson. Sin los ?? null, una
     * entrada sin correo provocaba un warning de PHP y un fault genérico.
     */
    return [
        "success" => true,
        "message" => "Usuario encontrado",
        "usuario" => $usuarioLDAP["uid"][0] ?? $usuario,
        "nombre" => $usuarioLDAP["cn"][0] ?? null,
        "apellido" => $usuarioLDAP["sn"][0] ?? null,
        "correo" => $usuarioLDAP["mail"][0] ?? null
    ];
}


/*
 * OBTENER GRUPOS DEL USUARIO
 *
 * Contrato sin cambios. La lista ahora viene ordenada (ver gruposDe) y el
 * mensaje de error distingue "falló la consulta" de "no tiene grupos", que
 * antes se confundían: ldap_search devuelve un recurso válido cuando la
 * búsqueda va bien y no casa nada, así que el mensaje "No se encontraron
 * grupos" nunca se disparaba por esa razón.
 */
function obtenerGruposUsuario($datos)
{
    $usuario = $datos->usuario ?? "";

    if (!uidValido($usuario)) {
        return [
            "success" => false,
            "message" => "Identificador de usuario inválido"
        ];
    }

    $ldap = conectarLDAPAdmin();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $grupos = gruposDe($ldap, $usuario);

    ldap_unbind($ldap);

    if ($grupos === null) {
        return [
            "success" => false,
            "message" => "No fue posible consultar los grupos"
        ];
    }

    return [
        "success" => true,
        "message" => count($grupos) > 0
            ? "Grupos encontrados"
            : "El usuario no pertenece a ningún grupo",
        "grupos" => $grupos
    ];
}


/*
 * OBTENER PERFIL DEL USUARIO
 *
 * Contrato sin cambios. El perfil sigue siendo el primer grupo, pero ahora de
 * la lista ordenada, así que no cambia entre llamadas.
 */
function obtenerPerfilUsuario($datos)
{
    $usuario = $datos->usuario ?? "";

    if (!uidValido($usuario)) {
        return [
            "success" => false,
            "message" => "Identificador de usuario inválido"
        ];
    }

    $ldap = conectarLDAPAdmin();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $grupos = gruposDe($ldap, $usuario);

    ldap_unbind($ldap);

    if ($grupos === null) {
        return [
            "success" => false,
            "message" => "No fue posible consultar los grupos"
        ];
    }

    if (count($grupos) === 0) {
        return [
            "success" => false,
            "message" => "El usuario no tiene un perfil asignado"
        ];
    }

    return [
        "success" => true,
        "message" => "Perfil encontrado",
        "usuario" => $usuario,
        "perfil" => $grupos[0]
    ];
}

/*
 * VALIDAR ACCESO A UN SERVICIO (MAPA DE SERVICIOS)
 *
 * Contrato sin cambios. Se corrigen dos cosas por dentro:
 *   - se escapa `servicio`: antes, pedir el servicio "*" generaba el filtro
 *     (&(cn=*)(memberUid=<perfil>)) y respondía "Acceso PERMITIDO al servicio
 *     *" si el perfil tenía acceso a cualquier servicio;
 *   - se comprueba el resultado de ldap_search antes de pasarlo a
 *     ldap_get_entries, que en PHP 8 lanza TypeError si recibe false.
 */
function validarAccesoServicio($datos)
{
    $usuario = $datos->usuario ?? "";
    $servicio = $datos->servicio ?? "";

    if (!uidValido($usuario) || $servicio === "") {
        return [
            "success" => false,
            "message" => "Usuario o servicio inválido"
        ];
    }

    $ldap = conectarLDAPAdmin();
    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    // 1. Obtener el grupo/perfil del usuario
    $grupos = gruposDe($ldap, $usuario);

    if ($grupos === null) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "No fue posible consultar los grupos"
        ];
    }

    if (count($grupos) === 0) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "El usuario no tiene un perfil asignado"
        ];
    }

    $perfilUsuario = $grupos[0];

    // 2. Consultar si el perfil del usuario tiene acceso al servicio solicitado
    $filtroServicio =
        "(&(cn=" . filtroSeguro($servicio) . ")" .
        "(memberUid=" . filtroSeguro($perfilUsuario) . "))";

    $busquedaServicio = ldap_search($ldap, "ou=services," . BASE_DN, $filtroServicio);

    if (!$busquedaServicio) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "No fue posible consultar los servicios"
        ];
    }

    $resServicio = ldap_get_entries($ldap, $busquedaServicio);

    ldap_unbind($ldap);

    if (is_array($resServicio) && $resServicio["count"] > 0) {
        return [
            "success" => true,
            "message" => "Acceso PERMITIDO al servicio " . $servicio,
            "perfil" => $perfilUsuario,
            "servicio" => $servicio
        ];
    }

    return [
        "success" => false,
        "message" => "Acceso DENEGADO al servicio " . $servicio . " para el perfil " . $perfilUsuario,
        "perfil" => $perfilUsuario,
        "servicio" => $servicio
    ];
}


/* ========================================================================
 *  OPERACIONES NUEVAS: sesión
 * ========================================================================
 *
 * Son las que el resto del sistema estaba esperando. Storage, node-media y
 * node-sync llaman a validarToken en cada petición; node-web llama a
 * iniciarSesion y a validarToken.
 *
 * Distinción entre roles y grupos, que en este directorio no era explícita:
 *   - grupos = los cn de ou=groups. Es lo que evalúa el segmento "grupo" del
 *              modelo de permisos Unix de node-repository.
 *   - roles  = el perfil del usuario, que es lo que ou=services usa para
 *              autorizar el acceso a cada servicio.
 * Se devuelven por separado porque significan cosas distintas.
 */

/*
 * INICIAR SESIÓN
 *
 * Verifica la contraseña contra LDAP y, si hay MFA activo para ese usuario,
 * exige también el código. Devuelve un token firmado con uid, roles y grupos.
 */
function iniciarSesion($datos)
{
    $usuario = $datos->usuario ?? "";
    $password = $datos->password ?? "";
    $origenCliente = $datos->origenCliente ?? "";
    $codigoMfa = $datos->codigoMfa ?? "";

    $credencialesInvalidas = [
        "success" => false,
        "message" => "Usuario o contraseña incorrectos"
    ];

    if ($usuario === "" || $password === "" || !uidValido($usuario)) {
        return $credencialesInvalidas;
    }

    // --- primer factor: contraseña contra LDAP ---
    $resultado = autenticarUsuario((object) [
        "usuario" => $usuario,
        "password" => $password
    ]);

    if (!$resultado["success"]) {
        return $credencialesInvalidas;
    }

    /*
     * --- segundo factor, si hay un OTP pendiente para este usuario ---
     *
     * Solo se exige cuando generarTokenMFA creó un código y todavía no se ha
     * consumido. Así el MFA queda encadenado a la sesión sin volverse
     * obligatorio para los clientes que guardan credencial (el agente de
     * escritorio y el móvil, según el diagrama de despliegue).
     */
    if (mfaPendiente($usuario)) {
        if ($codigoMfa === "") {
            return [
                "success" => false,
                "message" => "Se requiere el código de verificación"
            ];
        }

        $mfa = validarTokenMFA((object) [
            "usuario" => $usuario,
            "token" => $codigoMfa
        ]);

        if (!$mfa["success"]) {
            return [
                "success" => false,
                "message" => $mfa["message"]
            ];
        }
    }

    // --- datos de autorización ---
    $ldap = conectarLDAPAdmin();
    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $grupos = gruposDe($ldap, $usuario);
    ldap_unbind($ldap);

    if ($grupos === null) {
        return [
            "success" => false,
            "message" => "No fue posible consultar los grupos del usuario"
        ];
    }

    $roles = count($grupos) > 0 ? [$grupos[0]] : [];

    $emitido = upbcEmitirToken($usuario, $roles, $grupos, $origenCliente);

    return [
        "success"  => true,
        "message"  => "Sesión iniciada",
        "token"    => $emitido["token"],
        "expiraEn" => $emitido["expiraEn"],
        "uid"      => $usuario,
        "roles"    => $roles,
        "grupos"   => $grupos
    ];
}

/*
 * ¿Hay un OTP de MFA generado y sin consumir para este usuario?
 *
 * Mira el mismo archivo que usa mfa.php, para no duplicar el formato. Se hace
 * por archivo y no llamando a mfa.php porque son dos endpoints SOAP distintos
 * y este proceso no debería hacerse una petición a sí mismo.
 */
function mfaPendiente($usuario)
{
    $archivo = "/tmp/mfa_" . md5($usuario) . ".json";
    if (!file_exists($archivo)) {
        return false;
    }

    $datos = json_decode((string) @file_get_contents($archivo), true);
    if (!is_array($datos) || !isset($datos["expires_at"])) {
        return false;
    }

    // Un OTP caducado no obliga a nada.
    return time() <= (int) $datos["expires_at"];
}

/*
 * Copia local de la validación de OTP.
 *
 * mfa.php define validarTokenMFA, pero los dos archivos son endpoints SOAP
 * independientes y no se incluyen entre sí. Esta función replica la misma
 * lógica y el mismo formato de archivo para poder encadenar el MFA dentro de
 * iniciarSesion. Si algún día MFA y Auth se unifican en un solo WSDL, esto
 * desaparece.
 */
if (!function_exists("validarTokenMFA")) {
    function validarTokenMFA($datos)
    {
        $usuario = $datos->usuario ?? "";
        $tokenIngresado = $datos->token ?? "";
        $archivoToken = "/tmp/mfa_" . md5($usuario) . ".json";

        if (!file_exists($archivoToken)) {
            return [
                "success" => false,
                "message" => "No existe un token activo para este usuario"
            ];
        }

        $datosToken = json_decode((string) file_get_contents($archivoToken), true);

        if (!is_array($datosToken) || !isset($datosToken["token"], $datosToken["expires_at"])) {
            return [
                "success" => false,
                "message" => "Token MFA inválido"
            ];
        }

        if (time() > (int) $datosToken["expires_at"]) {
            @unlink($archivoToken);
            return [
                "success" => false,
                "message" => "El token MFA ha expirado"
            ];
        }

        if (hash_equals((string) $datosToken["token"], (string) $tokenIngresado)) {
            @unlink($archivoToken);
            return [
                "success" => true,
                "message" => "Autenticación de doble factor EXITOSA"
            ];
        }

        return [
            "success" => false,
            "message" => "Token MFA inválido"
        ];
    }
}

/*
 * Servicios a los que tiene acceso un perfil.
 *
 * Recorre ou=services buscando las entradas que tengan al perfil como miembro.
 * Es la consulta que ya hacía validarAccesoServicio, pero devolviendo la lista
 * completa en vez de responder sí/no sobre un servicio concreto.
 *
 * @return string[]|null null si la consulta falla
 */
function serviciosDePerfil($ldap, $perfil)
{
    $filtro = "(memberUid=" . filtroSeguro($perfil) . ")";

    $busqueda = ldap_search($ldap, "ou=services," . BASE_DN, $filtro);
    if (!$busqueda) {
        return null;
    }

    $resultado = ldap_get_entries($ldap, $busqueda);
    if (!is_array($resultado)) {
        return null;
    }

    $servicios = [];
    for ($i = 0; $i < $resultado["count"]; $i++) {
        if (isset($resultado[$i]["cn"][0])) {
            $servicios[] = $resultado[$i]["cn"][0];
        }
    }

    sort($servicios, SORT_STRING);
    return $servicios;
}

/*
 * LOGIN — alias de iniciarSesion para el cliente móvil Android.
 *
 * ¿Por qué existe? La app Android se escribió contra el contrato que documenta
 * TRASPASO §3.4, que no coincide con el de iniciarSesion:
 *
 *   la app llama    login(usuario, contrasena, origenCliente)
 *                   y espera <token>, <roles>, <mapaServiciosAutorizados>
 *   aquí se expone  iniciarSesion(usuario, password, origenCliente, codigoMfa)
 *                   y devuelve <token>, <expiraEn>, <uid>, <roles>*, <grupos>*
 *
 * Dos diferencias de forma que importan, y por eso esto no es un simple renombre:
 *   - el parámetro se llama `contrasena`, no `password`;
 *   - `roles` aquí es UNA cadena separada por comas, porque la app hace
 *     .split(",") sobre el primer elemento <roles> que encuentra. Si se
 *     devolvieran elementos repetidos como en iniciarSesion, la app solo vería
 *     el primero.
 *
 * Se añadió como operación aparte en vez de cambiar iniciarSesion para no
 * romper a node-web, node-repository, node-media ni node-sync, que ya usan la
 * forma con elementos repetidos. Las dos comparten toda la lógica.
 */
function login($datos)
{
    $usuario = $datos->usuario ?? "";

    $sesion = iniciarSesion((object) [
        "usuario"       => $usuario,
        "password"      => $datos->contrasena ?? "",
        "origenCliente" => $datos->origenCliente ?? "movil",
        "codigoMfa"     => $datos->codigoMfa ?? ""
    ]);

    if (!$sesion["success"]) {
        return [
            "success" => false,
            "message" => $sesion["message"]
        ];
    }

    // Mapa de servicios autorizados: lo que la app usa para decidir qué
    // opciones habilita en su pantalla principal.
    $servicios = [];
    $ldap = conectarLDAPAdmin();
    if ($ldap) {
        $perfil = $sesion["roles"][0] ?? null;
        if ($perfil !== null) {
            $servicios = serviciosDePerfil($ldap, $perfil) ?? [];
        }
        ldap_unbind($ldap);
    }

    return [
        "success"  => true,
        "message"  => $sesion["message"],
        "token"    => $sesion["token"],
        "expiraEn" => $sesion["expiraEn"],
        "uid"      => $sesion["uid"],
        "roles"    => implode(",", $sesion["roles"]),
        "grupos"   => implode(",", $sesion["grupos"]),
        "mapaServiciosAutorizados" => implode(",", $servicios)
    ];
}

/* LOGOUT — alias de cerrarSesion, por el mismo motivo que login. */
function logout($datos)
{
    return cerrarSesion($datos);
}

/*
 * VALIDAR TOKEN
 *
 * La operación más llamada del sistema: Storage, node-media y node-sync la
 * invocan en cada petición. Devuelve uid, roles y grupos en una sola llamada
 * a propósito: si obligara a encadenar obtenerGruposUsuario después, cada
 * descarga de archivo costaría dos viajes SOAP.
 *
 * No consulta LDAP: el token va firmado y lleva los datos dentro. Eso la hace
 * barata, que es lo que pedía la propuesta de arquitectura para no convertir a
 * este servicio en cuello de botella.
 */
function validarToken($datos)
{
    $token = $datos->token ?? "";

    $payload = upbcVerificarToken($token);

    if ($payload === false) {
        return [
            "valido" => false
        ];
    }

    return [
        "valido"   => true,
        "uid"      => $payload["uid"],
        "roles"    => $payload["roles"] ?? [],
        "grupos"   => $payload["grupos"] ?? [],
        "expiraEn" => max(0, (int) $payload["exp"] - time())
    ];
}

/*
 * CERRAR SESIÓN
 *
 * Añade el token a la lista de revocados. Un token autocontenido no se puede
 * invalidar de otra forma antes de que caduque.
 */
function cerrarSesion($datos)
{
    $token = $datos->token ?? "";

    $revocado = upbcRevocarToken($token);

    return [
        "success" => $revocado,
        "message" => $revocado
            ? "Sesión cerrada"
            : "El token no era válido o ya había caducado"
    ];
}


/*
 * Registrar operaciones disponibles
 */
$server->addFunction([
    "autenticarUsuario",
    "obtenerUsuario",
    "obtenerGruposUsuario",
    "obtenerPerfilUsuario",
    "validarAccesoServicio",
    "iniciarSesion",
    "validarToken",
    "cerrarSesion",
    // Alias con los nombres que usa el cliente móvil (ver login()).
    "login",
    "logout"
]);


/*
 * Esperar peticiones SOAP
 */
$server->handle();
