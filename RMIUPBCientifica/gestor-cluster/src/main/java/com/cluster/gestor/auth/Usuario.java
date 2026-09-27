package com.cluster.gestor.auth;

import java.util.List;

/**
 * Usuario autenticado. Misma forma que devuelven los validadores de
 * node-repository, node-media y node-sync: uid, roles y grupos.
 *
 * Los grupos se incluyen aunque el gestor del clúster todavía no los use: la
 * respuesta de validarToken los trae y descartarlos aquí obligaría a cambiar la
 * firma otra vez el día que haya que decidir permisos por grupo.
 */
public record Usuario(String uid, List<String> roles, List<String> grupos) {

    public Usuario(String uid, List<String> roles, List<String> grupos) {
        this.uid = uid;
        this.roles = roles == null ? List.of() : List.copyOf(roles);
        this.grupos = grupos == null ? List.of() : List.copyOf(grupos);
    }
}
