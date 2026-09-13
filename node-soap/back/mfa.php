<!-- Servicio SOAP para generación y validación de tokens OTP temporales. -->
<?php

$wsdl = "/var/www/html/soap/mfa.wsdl";
$server = new SoapServer($wsdl);

/*
 * Genera un código OTP / Token temporal válido por 5 minutos
 */
function generarTokenMFA($datos)
{
    $usuario = $datos->usuario;
    $archivoToken = "/tmp/mfa_" . md5($usuario) . ".json";

    // Generar un código numérico de 6 dígitos
    $codigo = str_pad(rand(0, 999999), 6, "0", STR_PAD_LEFT);
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
    $usuario = $datos->usuario;
    $tokenIngresado = $datos->token;
    $archivoToken = "/tmp/mfa_" . md5($usuario) . ".json";

    if (!file_exists($archivoToken)) {
        return [
            "success" => false,
            "message" => "No existe un token activo para este usuario"
        ];
    }

    $datosToken = json_decode(file_get_contents($archivoToken), true);

    if (time() > $datosToken["expires_at"]) {
        unlink($archivoToken); // Eliminar token expirado
        return [
            "success" => false,
            "message" => "El token MFA ha expirado"
        ];
    }

    if ($datosToken["token"] === $tokenIngresado) {
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