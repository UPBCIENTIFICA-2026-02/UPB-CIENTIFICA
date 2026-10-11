/*
 * Authentication Service (equivalente a data/auth/AuthRepository.kt).
 *
 * El navegador no habla SOAP: node-web recibe este JSON y llama a la
 * operación `login` del WSDL de node-soap (users.wsdl), la misma que usan el
 * móvil y el escritorio. Ver docs/PASARELA.md.
 */

import { pedir } from "../red/clienteApi.js";
import { iniciarSesion, cerrarSesion, esDemo } from "../sesion/sesion.js";

export async function ingresar(usuario, contrasena) {
  const respuesta = await pedir("/sesion", {
    metodo: "POST",
    cuerpo: { usuario, contrasena, origenCliente: "web" },
  });
  if (!respuesta?.token) throw new Error("El servicio de autenticación no devolvió token.");
  iniciarSesion({ usuario, token: respuesta.token, roles: respuesta.roles ?? [] });
}

export function ingresarDemo(usuario) {
  iniciarSesion({ usuario: usuario || "user1", token: "mock-token-demo", roles: ["investigador"], demo: true });
}

/**
 * La sesión local se cierra pase lo que pase: si el servidor no responde, no
 * se puede dejar la app "dentro" con una credencial que la persona ya quiso
 * abandonar (misma regla que AuthRepository.logout del móvil).
 */
export async function salir() {
  try {
    if (!esDemo()) await pedir("/sesion", { metodo: "DELETE", como: "nada", tiempo: 4000 });
  } catch {
    /* se cierra igual */
  } finally {
    cerrarSesion();
  }
}
