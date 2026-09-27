<?php
/*
 * Servicio SOAP para generación y validación de tokens OTP temporales.
 *
 * ==========================================================================
 *  >>> CAMBIO QUE AFECTA A LA VM node-soap <<<
 *
 *  ANTES: la primera línea era un comentario HTML FUERA de <?php, así que PHP
 *         lo emitía tal cual antes del sobre SOAP: las cabeceras ya estaban
 *         enviadas y la respuesta dejaba de ser XML bien formado. Afectaba a
 *         todas las respuestas, incluidas las correctas.
 *  AHORA: el comentario va dentro del bloque PHP. Hay que volver a copiar este
 *         archivo a /var/www/html/soap/mfa.php.
 *
 *  La ruta del WSDL pasa de estar escrita a mano a resolverse con __DIR__. En
 *  la VM da exactamente la misma ruta (/var/www/html/soap/mfa.wsdl); el cambio
 *  solo permite probar el servicio fuera de esa carpeta.
 *
 *  El contrato NO cambia: generarTokenMFA y validarTokenMFA reciben y
 *  devuelven lo mismo que antes.
 * ==========================================================================
 *
 *  PENDIENTE (requiere decisión de infraestructura, no se toca aquí):
 *  los OTP se guardan en /tmp con nombre md5(usuario), legible por cualquier
 *  proceso del servidor y con el código en claro. Debería ser un hash del
 *  código, en un directorio propio con permisos 0700. Se deja como está para
 *  no exigir cambios en la VM; está documentado en
 *  docs/CORRECCIONES-node-soap.md (1.6).
 */

$wsdl = __DIR__ . "/mfa.wsdl";
$server = new SoapServer($wsdl);

/*
 * Genera un código OTP / Token temporal válido por 5 minutos
 */
function generarTokenMFA($datos)
{
    /*
     * SoapServer no valida la petición contra el esquema del WSDL: si el
     * cliente omite el elemento, la propiedad no existe y PHP 8 emite un
     * warning. El ?? lo cubre.
     */
    $usuario = $datos->usuario ?? "";

    if ($usuario === "") {
        return [
            "success" => false,
            "message" => "Falta el usuario"
        ];
    }

    $archivoToken = "/tmp/mfa_" . md5($usuario) . ".json";

    /*
     * Generar un código numérico de 6 dígitos.
     *
     * random_int() y no rand(): rand() no es criptográficamente seguro y su
     * estado interno se puede reconstruir observando algunas salidas, lo que
     * permitiría predecir los códigos siguientes y anularía el segundo factor.
     */
    $codigo = str_pad((string) random_int(0, 999999), 6, "0", STR_PAD_LEFT);
    $expiracion = time() + 300; // Válido por 5 minutos

    $payload = [
        "usuario" => $usuario,
        "token" => $codigo,
        "expires_at" => $expiracion
    ];

    file_put_contents($archivoToken, json_encode($payload));

    return [
        "success" => true,
        "message" => "Token MFA generado exitosamente",
        "usuario" => $usuario,
        "token" => $codigo
    ];
}

/*
 * Valida si el código token ingresado es correcto y no ha expirado
 */
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
        unlink($archivoToken); // Eliminar token expirado
        return [
            "success" => false,
            "message" => "El token MFA ha expirado"
        ];
    }

    /*
     * hash_equals compara en tiempo constante: con === se podría deducir el
     * código dígito a dígito midiendo cuánto tarda la comparación.
     */
    if (hash_equals((string) $datosToken["token"], (string) $tokenIngresado)) {
        unlink($archivoToken); // Consumir el token (un solo uso)
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

$server->addFunction([
    "generarTokenMFA",
    "validarTokenMFA"
]);

$server->handle();
