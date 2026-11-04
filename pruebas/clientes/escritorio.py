# -*- coding: utf-8 -*-
"""Integración del CLIENTE DE ESCRITORIO con los servicios reales.

No reimplementa nada: importa el código de la aplicación
(FrontDesktopUPBCientifica/app) y usa sus mismas clases, como lo haría la
interfaz al pulsar cada botón:

  ApiClient (composición de dependencias)  → configuración LABORATORIO (VPS)
  AuthRepository     SOAP/HTTPS con la CA interna → node-soap
  StorageRepository  REST → node-repository (subir, listar, descargar, borrar)
  StreamingRepository REST → node-media (fotos y catálogo)
  SharedFileRepository REST → shared-file-svc
  HpcRepository      REST → job-api (estado del clúster y trabajos)
  MotorSincronizacion gRPC/TLS → node-sync (sincroniza una carpeta temporal)

Escribe una línea JSON por prueba en la salida estándar; la suite
e2e/12-clientes.js las lee y las muestra. No toca la configuración del usuario
(~/.upbcientifica): usa una copia en memoria y una carpeta temporal.

  python clientes/escritorio.py --app <ruta>/FrontDesktopUPBCientifica --usuario user1 --prefijo e2e-xxx
  (la clave se lee de UPBC_CLAVE_<usuario>)
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

p = argparse.ArgumentParser()
p.add_argument("--app", required=True)
p.add_argument("--usuario", required=True)
p.add_argument("--prefijo", required=True)
args = p.parse_args()

sys.path.insert(0, args.app)
from app.config import DEFAULT_CONFIG              # noqa: E402
from app.api_client import ApiClient               # noqa: E402
from app.data.filesync import (AlmacenSync, ConfigSync, MotorSincronizacion, MANUAL)  # noqa: E402


def informar(seccion, nombre, resultado, inicio, motivo=None):
    print(json.dumps({"seccion": seccion, "nombre": nombre, "resultado": resultado,
                      "ms": int((time.time() - inicio) * 1000), "motivo": motivo}, ensure_ascii=False), flush=True)


estado = {}


def prueba(seccion, nombre, requiere=None):
    def deco(fn):
        inicio = time.time()
        if requiere and not estado.get(requiere):
            informar(seccion, nombre, "OMITIDA", inicio, f"falta: {requiere}")
            return fn
        try:
            fn()
            informar(seccion, nombre, "OK", inicio)
        except AssertionError as e:
            informar(seccion, nombre, "FALLA", inicio, str(e))
        except Exception as e:  # noqa: BLE001
            informar(seccion, nombre, "FALLA", inicio, f"{type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
        return fn
    return deco


clave = os.environ.get(f"UPBC_CLAVE_{args.usuario}")
cfg = dict(DEFAULT_CONFIG, entorno="LABORATORIO")
api = ApiClient(cfg)
tmp = Path(tempfile.mkdtemp(prefix="upbc-escritorio-"))
api.filesync.almacen = AlmacenSync(tmp / "estado")   # no toca ~/.upbcientifica

S1 = "Escritorio · configuración y sesión"


@prueba(S1, "la app apunta a las VPS (entorno LABORATORIO) con TLS en Auth y File Sync")
def _():
    c = api.conf
    # Las direcciones esperadas salen de pruebas/.env (fuera de Git).
    n1, n2, n3 = (os.environ.get(f"UPBC_VPS_NODO{i}") for i in (1, 2, 3))
    assert n1 and n2 and n3, "faltan UPBC_VPS_NODO1..3 en pruebas/.env"
    assert c.url_auth.startswith(f"https://{n1}:8081"), c.url_auth
    assert f"{n2}:8084" in c.url_storage, c.url_storage
    assert f"{n3}:8083" in c.url_media, c.url_media
    assert f"{n3}:8082" in c.url_trabajos, c.url_trabajos
    assert c.direccion_sync == f"{n2}:9090", c.direccion_sync
    assert c.ca_sync and Path(c.ca_sync).exists(), "falta la CA interna en app/assets"


@prueba(S1, "iniciar sesión con la pantalla de login (SOAP/HTTPS → OpenLDAP)")
def _():
    assert clave, f"define UPBC_CLAVE_{args.usuario}"
    s = api.login(args.usuario, clave)
    assert s.token and s.usuario == args.usuario
    assert api.auth.validar_token(), "node-soap no reconoce el token recién emitido"
    estado["sesion"] = True


@prueba(S1, "una clave incorrecta se rechaza sin dar token", requiere="sesion")
def _():
    otra = ApiClient(dict(cfg))
    try:
        otra.auth.login(args.usuario, "clave-incorrecta-e2e")
        raise AssertionError("aceptó una clave incorrecta")
    except AssertionError:
        raise
    except Exception:
        pass
    assert otra.tokens.current_token() is None


S2 = "Escritorio · Mis archivos (Storage)"
local = tmp / f"{args.prefijo}-escritorio.txt"
contenido = f"subido desde la app de escritorio {time.ctime()}\n".encode() * 50
local.write_bytes(contenido)


@prueba(S2, "subir un archivo desde el PC", requiere="sesion")
def _():
    a = api.storage.subir(str(local))
    assert a.id, "Storage no devolvió id"
    estado["archivo"] = a


@prueba(S2, "aparece en el listado del Home con su tamaño", requiere="archivo")
def _():
    a = estado["archivo"]
    fila = next((x for x in api.storage.listar() if x.id == a.id), None)
    assert fila, "no aparece en el Home"
    assert fila.tamano_bytes == len(contenido), f"tamaño {fila.tamano_bytes} ≠ {len(contenido)}"


@prueba(S2, "descargarlo devuelve exactamente los mismos bytes", requiere="archivo")
def _():
    destino = tmp / "descargado.txt"
    api.storage.descargar(estado["archivo"].id, str(destino))
    assert hashlib.sha256(destino.read_bytes()).hexdigest() == hashlib.sha256(contenido).hexdigest()


@prueba(S2, "la cuota refleja el espacio usado", requiere="sesion")
def _():
    usados, cuota = api.storage.cuota()
    assert cuota > 0 and 0 < usados <= cuota, f"usados={usados} cuota={cuota}"


S3 = "Escritorio · Fotos, Streaming, Compartidos y HPC"


@prueba(S3, "galería de fotos (Photo Album)", requiere="sesion")
def _():
    fotos = api.streaming.fotos()
    assert isinstance(fotos, list)
    if fotos and fotos[0].tiene_miniatura:
        assert len(api.streaming.miniatura(fotos[0].id)) > 100, "miniatura vacía"


@prueba(S3, "catálogo de videos (Streaming)", requiere="sesion")
def _():
    assert isinstance(api.streaming.catalogo(), list)


@prueba(S3, "compartidos conmigo y que yo comparto (Shared File)", requiere="sesion")
def _():
    assert isinstance(api.shared.compartidos_conmigo(), list)
    assert isinstance(api.shared.que_yo_comparto(), list)


@prueba(S3, "estado del clúster y mis trabajos (HPC)", requiere="sesion")
def _():
    cluster, trabajos = api.hpc.consultar_todo()
    assert cluster.nodos_totales > 0 if hasattr(cluster, "nodos_totales") else True
    assert isinstance(trabajos, list)


S4 = "Escritorio · File Sync (gRPC/TLS)"
carpeta = tmp / "carpeta-sincronizada"
carpeta.mkdir()
(carpeta / "notas.txt").write_text("versión 1\n", encoding="utf-8")
(carpeta / "sub").mkdir()
(carpeta / "sub" / "datos.csv").write_text("a,b\n1,2\n", encoding="utf-8")
cs = ConfigSync(carpeta=str(carpeta), carpeta_remota=f"{args.prefijo}-sync-escritorio")
motor = None


@prueba(S4, "el servidor syncd responde por TLS con la CA interna", requiere="sesion")
def _():
    global motor
    motor = MotorSincronizacion(api.conf.direccion_sync, api.tokens.current_token(), ca=api.conf.ca_sync)
    assert motor.alcanzable(), "node-sync no responde"
    estado["motor"] = True


@prueba(S4, "primera sincronización: sube los 2 archivos de la carpeta", requiere="motor")
def _():
    r = motor.sincronizar(cs, MANUAL, lambda e: None)
    assert r["errores"] == 0, r["eventos"]
    assert r["subidos"] == 2, f"subidos={r['subidos']}"
    estado["sync1"] = True


@prueba(S4, "los archivos sincronizados están en Storage (Mis archivos)", requiere="sync1")
def _():
    raiz = next((d for d in api.storage.listar() if d.es_directorio and d.nombre == cs.carpeta_remota), None)
    assert raiz, "no apareció la carpeta en el Home"
    nombres = {x.nombre for x in api.storage.listar(raiz.id)}
    assert "notas.txt" in nombres and "sub" in nombres, nombres
    estado["raiz_sync"] = raiz.id


@prueba(S4, "segunda sincronización sin cambios: nada que hacer", requiere="sync1")
def _():
    r = motor.sincronizar(cs, MANUAL, lambda e: None)
    assert r["subidos"] == r["bajados"] == r["borrados"] == r["conflictos"] == 0, r


@prueba(S4, "un cambio local se sube como nueva versión", requiere="sync1")
def _():
    time.sleep(1.1)
    (carpeta / "notas.txt").write_text("versión 2\n", encoding="utf-8")
    r = motor.sincronizar(cs, MANUAL, lambda e: None)
    assert r["subidos"] == 1, r
    fila = next(x for x in api.storage.listar(estado["raiz_sync"]) if x.nombre == "notas.txt")
    assert fila.version >= 2, f"versión {fila.version}"


@prueba(S4, "borrar en el PC borra en el servidor", requiere="sync1")
def _():
    (carpeta / "sub" / "datos.csv").unlink()
    r = motor.sincronizar(cs, MANUAL, lambda e: None)
    assert r["borrados"] == 1, r


# ------------------------------------------------------------------ limpieza
try:
    if estado.get("archivo"):
        api.storage.eliminar(estado["archivo"].id)
    if estado.get("raiz_sync"):
        for x in api.storage.listar(estado["raiz_sync"]):
            if not x.es_directorio:
                api.storage.eliminar(x.id)
    if motor:
        motor.cerrar()
except Exception as e:  # noqa: BLE001
    print(f"aviso: limpieza incompleta: {e}", file=sys.stderr)

S5 = "Escritorio · cierre de sesión"


@prueba(S5, "cerrar sesión invalida el token en node-soap", requiere="sesion")
def _():
    token = api.tokens.current_token()
    api.logout()
    assert api.tokens.current_token() is None
    api.tokens.save_token(token)
    valido = api.auth.validar_token()
    api.tokens.clear()
    assert not valido, "el token sigue siendo válido tras cerrar sesión"
