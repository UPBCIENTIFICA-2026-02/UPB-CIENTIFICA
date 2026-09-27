<?php
/*
 * sesion.php — Emisión y verificación de tokens de sesión de UPB-CIENTÍFICA.
 *
 * ============================================================================
 *  >>> AFECTA A LA CONFIGURACIÓN DE LA VM node-soap <<<
 * ============================================================================
 *
 *  ANTES: este archivo no existía. `autenticarUsuario` devolvía solo
 *         { success, message } y el sistema no tenía tokens de sesión: los
 *         demás servicios (Storage, media, sync, web) funcionaban con tokens
 *         simulados `mock-token-<uid>-...`.
 *
 *  AHORA: hace falta desplegar este archivo junto a `user.php` y `mfa.php`
 *         (es decir, copiarlo a /var/www/html/soap/sesion.php). `user.php` lo
 *         carga con `require_once __DIR__ . "/sesion.php"`, así que basta que
 *         esté en la misma carpeta; no hay que tocar Apache.
 *
 *  QUÉ NO CAMBIA: no se toca OpenLDAP (ni esquema, ni datos, ni slapd.conf),
 *         ni el VirtualHost de Apache, ni el nombre de user.php, ni el
 *         targetNamespace del WSDL. Las cinco operaciones que ya existían
 *         siguen recibiendo y devolviendo exactamente lo mismo.
 *
 *  CONFIGURACIÓN OPCIONAL (recomendada, ver upbcSecretoToken abajo):
 *         definir AUTH_TOKEN_SECRET en /etc/apache2/soap-config.php.
 *         Si no se define, el servicio SIGUE FUNCIONANDO con un secreto de
 *         desarrollo y deja un aviso en el log de Apache.
 * ============================================================================
 *
 * Diseño: el token es AUTOCONTENIDO y va firmado con HMAC-SHA256. Se eligió así
 * porque no obliga a montar nada nuevo en esta VM (ni PostgreSQL, ni tablas de
 * sesión en LDAP): el servidor no guarda estado para validar.
 *
 * Formato:  upbc1.<payload-base64url>.<firma-base64url>
 *   payload = JSON con { uid, roles, grupos, iat, exp, origen }
 *
 * La contrapartida de un token autocontenido es que no se puede revocar antes
 * de que caduque. Para que `cerrarSesion` signifique algo se mantiene una lista
 * de revocados en disco (ver upbcRevocarToken). Es una lista pequeña porque
 * solo guarda tokens que aún no han caducado.
 */

/** Vigencia por defecto de una sesión, en segundos (8 horas). */
const UPBC_VIGENCIA_TOKEN = 28800;

/*
 * Secreto de firma.
 *
 * Debería venir de /etc/apache2/soap-config.php (fuera del árbol web y fuera
 * de Git), igual que LDAP_SERVICE_BIND_DN:
 *
 *     define("AUTH_TOKEN_SECRET", "<cadena-larga-aleatoria>");
 *
 * Mientras no se defina se usa un secreto de desarrollo para no dejar el
 * servicio caído, pero se registra el aviso: con ese secreto los tokens son
 * falsificables por cualquiera que lea este archivo.
 */
function upbcSecretoToken()
{
    if (defined("AUTH_TOKEN_SECRET") && AUTH_TOKEN_SECRET !== "") {
        return AUTH_TOKEN_SECRET;
    }

    error_log(
        "[upbc-auth] AVISO: AUTH_TOKEN_SECRET no está definido en " .
        "soap-config.php; se usa el secreto de desarrollo. Los tokens " .
        "emitidos NO son seguros."
    );

    return "upbc-cientifica-secreto-de-desarrollo-cambiar-en-produccion";
}

/** Codificación base64 apta para URL y sin relleno. */
function upbcB64UrlCodificar($datos)
{
    return rtrim(strtr(base64_encode($datos), "+/", "-_"), "=");
}

function upbcB64UrlDecodificar($texto)
{
    $relleno = strlen($texto) % 4;
    if ($relleno !== 0) {
        $texto .= str_repeat("=", 4 - $relleno);
    }
    return base64_decode(strtr($texto, "-_", "+/"), true);
}

function upbcFirmar($payloadCodificado)
{
    return upbcB64UrlCodificar(
        hash_hmac("sha256", $payloadCodificado, upbcSecretoToken(), true)
    );
}

/**
 * Emite un token de sesión.
 *
 * @param string   $uid    identificador del usuario en LDAP (cadena, p. ej. "jperez")
 * @param string[] $roles  perfiles del usuario (lo que autoriza servicios)
 * @param string[] $grupos grupos del usuario (lo que evalúan los permisos Unix)
 * @param string   $origen origen del cliente ("web", "movil", "escritorio"...)
 *
 * @return array{token: string, expiraEn: int}
 */
function upbcEmitirToken($uid, array $roles, array $grupos, $origen = "")
{
    $ahora = time();
    $expira = $ahora + UPBC_VIGENCIA_TOKEN;

    $payload = json_encode([
        "uid"    => $uid,
        "roles"  => array_values($roles),
        "grupos" => array_values($grupos),
        "iat"    => $ahora,
        "exp"    => $expira,
        "origen" => $origen
    ], JSON_UNESCAPED_UNICODE);

    $payloadCodificado = upbcB64UrlCodificar($payload);

    return [
        "token"    => "upbc1." . $payloadCodificado . "." . upbcFirmar($payloadCodificado),
        "expiraEn" => UPBC_VIGENCIA_TOKEN
    ];
}

/**
 * Verifica firma, vigencia y revocación.
 *
 * @return array|false el payload si el token es válido; false en cualquier otro caso
 */
function upbcVerificarToken($token)
{
    if (!is_string($token) || $token === "") {
        return false;
    }

    $partes = explode(".", $token);
    if (count($partes) !== 3 || $partes[0] !== "upbc1") {
        return false;
    }

    $payloadCodificado = $partes[1];
    $firmaRecibida = $partes[2];

    /*
     * hash_equals compara en tiempo constante: con == se podría deducir la
     * firma correcta byte a byte midiendo cuánto tarda la comparación.
     */
    if (!hash_equals(upbcFirmar($payloadCodificado), $firmaRecibida)) {
        return false;
    }

    $json = upbcB64UrlDecodificar($payloadCodificado);
    if ($json === false) {
        return false;
    }

    $payload = json_decode($json, true);
    if (!is_array($payload) || !isset($payload["uid"], $payload["exp"])) {
        return false;
    }

    if (time() >= (int) $payload["exp"]) {
        return false;
    }

    if (upbcTokenRevocado($token)) {
        return false;
    }

    return $payload;
}

/*
 * Lista de revocados.
 *
 * >>> AFECTA A LA VM: se crea el directorio <temporal>/upbc-revocados/ la
 * primera vez que alguien cierra sesión. No hace falta crearlo a mano ni dar
 * permisos: lo crea el propio usuario de Apache.
 *
 * Igual que los OTP de mfa.php, esto debería vivir en un directorio propio
 * (p. ej. /var/lib/upbc-auth/) y no bajo el temporal del sistema. Se deja así
 * para no exigir cambios de infraestructura en esta VM.
 */
function upbcDirectorioRevocados()
{
    $dir = sys_get_temp_dir() . "/upbc-revocados";
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

/** Nombre de archivo de un token revocado: hash del token, nunca el token. */
function upbcRutaRevocado($token)
{
    return upbcDirectorioRevocados() . "/" . hash("sha256", $token) . ".rev";
}

function upbcRevocarToken($token)
{
    $payload = upbcVerificarToken($token);
    if ($payload === false) {
        // Un token inválido o ya caducado no necesita revocarse.
        return false;
    }

    /*
     * Se guarda la fecha de caducidad para poder limpiar después: un token
     * revocado deja de ser peligroso en cuanto caduca por su cuenta.
     */
    @file_put_contents(upbcRutaRevocado($token), (string) $payload["exp"]);
    upbcLimpiarRevocados();
    return true;
}

function upbcTokenRevocado($token)
{
    return file_exists(upbcRutaRevocado($token));
}

/** Borra los revocados que ya caducaron, para que la carpeta no crezca sin fin. */
function upbcLimpiarRevocados()
{
    $ahora = time();
    foreach (glob(upbcDirectorioRevocados() . "/*.rev") ?: [] as $archivo) {
        $exp = (int) @file_get_contents($archivo);
        if ($exp !== 0 && $exp < $ahora) {
            @unlink($archivo);
        }
    }
}
