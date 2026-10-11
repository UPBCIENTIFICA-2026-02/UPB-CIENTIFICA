/*
 * spa-ui.js — artefacto «source» del diagrama de despliegue.
 *
 * Interfaz web de UPB-CIENTÍFICA. La entrega node-web y corre en el
 * navegador del Desktop PC (Web Browser). Equivale a MainActivity.kt del
 * móvil: decide si mostrar el inicio de sesión o la app, y arranca lo
 * compartido (tema, sondeo de conexión).
 */

import { sesionActual, alCambiarSesion } from "./src/sesion/sesion.js";
import { iniciarSondeo, detenerSondeo, alCambiarConexion } from "./src/datos/conexion.js";
import { refrescarIndicadores } from "./src/ui/componentes/cuenta.js";
import { cerrarMenu } from "./src/ui/componentes/superpuestos.js";
import { aplicarTema } from "./src/ui/tema.js";
import * as login from "./src/ui/pantallas/login.js";
import * as marco from "./src/ui/pantallas/marco.js";

const raiz = document.getElementById("app");
let desmontar = null;

function mostrar(aviso = null) {
  cerrarMenu();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  desmontar?.();
  raiz.innerHTML = "";

  if (sesionActual()) {
    iniciarSondeo();
    desmontar = marco.montar(raiz);
  } else {
    detenerSondeo();
    document.title = "Iniciar sesión · UPB-Científica";
    desmontar = login.montar(raiz, { aviso });
  }
}

aplicarTema();
alCambiarConexion(refrescarIndicadores);
alCambiarSesion((sesion, motivo) => mostrar(sesion ? null : motivo));
mostrar();
