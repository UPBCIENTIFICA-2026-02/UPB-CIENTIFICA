/*
 * Inicio de sesión (LoginScreen.kt).
 *
 * Mismas reglas que el móvil:
 *  - El usuario se recorta (un espacio al final haría fallar el login sin que
 *    se vea por qué); la contraseña NO, un espacio puede ser parte de ella.
 *  - El botón queda deshabilitado con los campos vacíos: no se manda una
 *    petición que ya se sabe que va a fallar.
 *  - El error del servidor se muestra tal cual lo explica el servidor.
 */

import { icono } from "../iconos.js";
import { esc } from "../formato.js";
import { config } from "../../config.js";
import { ingresar, ingresarDemo } from "../../datos/auth.js";

export function montar(contenedor, { aviso = null } = {}) {
  contenedor.innerHTML = `
    <main class="login">
      <div class="login-columna">
        <span class="logo-circulo">${icono("nube")}</span>
        <h1 class="t-headline-m">UPB-CIENTÍFICA</h1>
        <p class="lema t-body-m">Tus archivos, datos y resultados de investigación en un solo lugar</p>

        <form class="tarjeta-login" novalidate>
          <h2 class="t-title-l">Iniciar sesión</h2>
          <p class="sub t-body-m">Usa tu cuenta institucional</p>

          <label class="campo">
            <span class="visualmente-oculto">Usuario</span>
            <span class="campo-caja">
              ${icono("persona")}
              <input name="usuario" placeholder="Usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
            </span>
          </label>

          <label class="campo">
            <span class="visualmente-oculto">Contraseña</span>
            <span class="campo-caja">
              ${icono("candado")}
              <input name="contrasena" type="password" placeholder="Contraseña" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
              <button type="button" class="boton-icono" data-ver aria-label="Mostrar contraseña">${icono("ver")}</button>
            </span>
          </label>

          <div class="aviso-error" data-error ${aviso ? "" : "hidden"} role="alert">
            ${icono("error")}<span class="t-body-m" data-error-texto>${esc(aviso ?? "")}</span>
          </div>

          <button type="submit" class="boton boton-relleno boton-grande" data-enviar disabled>Ingresar</button>
        </form>

        ${config.PERMITIR_DEMO ? `<button type="button" class="boton boton-texto login-demo" data-demo>Entrar en modo demostración</button>` : ""}
      </div>
    </main>`;

  const form = contenedor.querySelector("form");
  const usuario = form.elements.usuario;
  const contrasena = form.elements.contrasena;
  const enviar = form.querySelector("[data-enviar]");
  const cajaError = form.querySelector("[data-error]");
  const textoError = form.querySelector("[data-error-texto]");
  let cargando = false;

  const actualizar = () => {
    enviar.disabled = cargando || !usuario.value.trim() || !contrasena.value;
  };
  usuario.addEventListener("input", actualizar);
  contrasena.addEventListener("input", actualizar);
  usuario.focus();

  const ver = form.querySelector("[data-ver]");
  ver.addEventListener("click", () => {
    const mostrar = contrasena.type === "password";
    contrasena.type = mostrar ? "text" : "password";
    ver.innerHTML = icono(mostrar ? "ocultar" : "ver");
    ver.setAttribute("aria-label", mostrar ? "Ocultar contraseña" : "Mostrar contraseña");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (enviar.disabled) return;
    cargando = true;
    cajaError.hidden = true;
    usuario.disabled = contrasena.disabled = true;
    enviar.disabled = true;
    enviar.innerHTML = `<span class="rueda"></span>Ingresando…`;
    try {
      await ingresar(usuario.value.trim(), contrasena.value);
      // El cambio de sesión lleva a la app; esta pantalla se desmonta sola.
    } catch (error) {
      cargando = false;
      usuario.disabled = contrasena.disabled = false;
      enviar.textContent = "Ingresar";
      textoError.textContent = error.estado === 401 ? "Usuario o contraseña incorrectos" : error.message;
      cajaError.hidden = false;
      actualizar();
      contrasena.focus();
    }
  });

  contenedor.querySelector("[data-demo]")?.addEventListener("click", () => ingresarDemo(usuario.value.trim()));

  return () => {};
}
