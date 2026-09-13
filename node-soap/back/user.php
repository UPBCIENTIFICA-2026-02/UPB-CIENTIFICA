<!-- Servicio SOAP principal (Auth, Perfiles, Grupos, Servicios en LDAP). -->
<?php

require_once "/etc/apache2/soap-config.php";

$wsdl = "/var/www/html/soap/users.wsdl";

$server = new SoapServer($wsdl);


/*
 * Conexión segura con OpenLDAP mediante LDAPS.
 */
function conectarLDAP()
{
    $ldapHost = "ldaps://192.168.1.195";
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

    return $ldap;
}


/*
 * AUTENTICAR USUARIO
 */
function autenticarUsuario($datos)
{
    $usuario = $datos->usuario;
    $password = $datos->password;

    $baseDn = "dc=upb-cientifica,dc=local";

    $userDn =
        "uid=" . $usuario .
        ",ou=people," .
        $baseDn;

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

    ldap_unbind($ldap);

    return [
        "success" => false,
        "message" => "Usuario o contraseña incorrectos"
    ];
}


/*
 * OBTENER INFORMACIÓN DEL USUARIO
 */
function obtenerUsuario($datos)
{
    $usuario = $datos->usuario;

    $baseDn = "dc=upb-cientifica,dc=local";

    $ldap = conectarLDAP();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }


    /*
     * Para consultar información usamos
     * la cuenta administrativa de LDAP.
     */
    $bind = ldap_bind(
        $ldap,
        LDAP_SERVICE_BIND_DN,
        "soap"
    );

    if (!$bind) {

        ldap_unbind($ldap);

        return [
            "success" => false,
            "message" => "No se pudo autenticar el administrador LDAP"
        ];
    }


    $filtro = "(uid=" . $usuario . ")";

    $busqueda = ldap_search(
        $ldap,
        "ou=people," . $baseDn,
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


    if ($datosUsuario["count"] == 0) {

        return [
            "success" => false,
            "message" => "Usuario no encontrado"
        ];
    }


    $usuarioLDAP = $datosUsuario[0];


    return [
        "success" => true,
        "message" => "Usuario encontrado",
        "usuario" => $usuarioLDAP["uid"][0],
        "nombre" => $usuarioLDAP["cn"][0],
        "apellido" => $usuarioLDAP["sn"][0],
        "correo" => $usuarioLDAP["mail"][0]
    ];
}


/*
 * OBTENER GRUPOS DEL USUARIO
 */
function obtenerGruposUsuario($datos)
{
    $usuario = $datos->usuario;

    $baseDn = "dc=upb-cientifica,dc=local";

    $ldap = conectarLDAP();

    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }


    $bind = ldap_bind(
        $ldap,
        LDAP_SERVICE_BIND_DN,
        "soap"
    );

    if (!$bind) {

        ldap_unbind($ldap);

        return [
            "success" => false,
            "message" => "No se pudo autenticar el administrador LDAP"
        ];
    }


    $filtro = "(memberUid=" . $usuario . ")";


    $busqueda = ldap_search(
        $ldap,
        "ou=groups," . $baseDn,
        $filtro
    );


    if (!$busqueda) {

        ldap_unbind($ldap);

        return [
            "success" => false,
            "message" => "No se encontraron grupos"
        ];
    }


    $gruposLDAP =
        ldap_get_entries(
            $ldap,
            $busqueda
        );


    ldap_unbind($ldap);


    $grupos = [];


    for (
        $i = 0;
        $i < $gruposLDAP["count"];
        $i++
    ) {

        $grupos[] =
            $gruposLDAP[$i]["cn"][0];
    }


    return [
        "success" => true,
        "message" => "Grupos encontrados",
        "grupos" => $grupos
    ];
}

function obtenerPerfilUsuario($datos)
{
    $usuario = $datos->usuario;
    $baseDn = "dc=upb-cientifica,dc=local";

    $ldap = conectarLDAP();
    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    $bind = ldap_bind($ldap, LDAP_SERVICE_BIND_DN, "soap");
    if (!$bind) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "No se pudo consultar LDAP"
        ];
    }

    $filtro = "(memberUid=" . $usuario . ")";
    $busqueda = ldap_search($ldap, "ou=groups," . $baseDn, $filtro);

    if (!$busqueda) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "No fue posible consultar los grupos"
        ];
    }

    $resultado = ldap_get_entries($ldap, $busqueda);
    ldap_unbind($ldap);

    if ($resultado["count"] == 0) {
        return [
            "success" => false,
            "message" => "El usuario no tiene un perfil asignado"
        ];
    }

    return [
        "success" => true,
        "message" => "Perfil encontrado",
        "usuario" => $usuario,
        "perfil" => $resultado[0]["cn"][0]
    ];
}

/*
 * VALIDAR ACCESO A UN SERVICIO (MAPA DE SERVICIOS)
 */
function validarAccesoServicio($datos)
{
    $usuario = $datos->usuario;
    $servicio = $datos->servicio;

    $baseDn = "dc=upb-cientifica,dc=local";

    $ldap = conectarLDAP();
    if (!$ldap) {
        return [
            "success" => false,
            "message" => "No fue posible conectar con LDAP"
        ];
    }

    // 1. Obtener el grupo/perfil del usuario
    $bind = ldap_bind($ldap, LDAP_SERVICE_BIND_DN, "soap");
    if (!$bind) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "No se pudo consultar LDAP"
        ];
    }

    $filtroPerfil = "(memberUid=" . $usuario . ")";
    $busquedaPerfil = ldap_search($ldap, "ou=groups," . $baseDn, $filtroPerfil);
    $resPerfil = ldap_get_entries($ldap, $busquedaPerfil);

    if ($resPerfil["count"] == 0) {
        ldap_unbind($ldap);
        return [
            "success" => false,
            "message" => "El usuario no tiene un perfil asignado"
        ];
    }

    $perfilUsuario = $resPerfil[0]["cn"][0];

    // 2. Consultar si el perfil del usuario tiene acceso al servicio solicitado
    $filtroServicio = "(&(cn=" . $servicio . ")(memberUid=" . $perfilUsuario . "))";
    $busquedaServicio = ldap_search($ldap, "ou=services," . $baseDn, $filtroServicio);
    $resServicio = ldap_get_entries($ldap, $busquedaServicio);

    ldap_unbind($ldap);

    if ($resServicio["count"] > 0) {
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

/*
 * Registrar operaciones disponibles
 */
$server->addFunction([
    "autenticarUsuario",
    "obtenerUsuario",
    "obtenerGruposUsuario",
    "obtenerPerfilUsuario",
    "validarAccesoServicio"
]);


/*
 * Esperar peticiones SOAP
 */
$server->handle();