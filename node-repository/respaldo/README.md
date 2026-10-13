# Respaldo cifrado con GPG (RF-11)

> **RF-11.** El sistema debe cifrar con GPG, usando un esquema de llave pública y
> privada, las copias de seguridad de los archivos almacenados en el repositorio
> central. *Criterio:* una copia generada por el sistema no puede leerse sin la
> llave privada, la cual se custodia fuera del servidor de datos.

## Cómo se cumple

| Pieza | Dónde corre | Qué hace |
|---|---|---|
| `generar-llaves-respaldo.sh` | Máquina del **custodio** | Crea el par RSA-4096 (frase de paso, caduca a 2 años) y el certificado de revocación |
| `respaldo-gpg.sh` | VM **node-repository** (cron diario) | Cifra con la llave **pública** los archivos de Storage y los volcados de PostgreSQL |
| `restaurar-respaldo.sh` | Donde esté la llave **privada** | Comprueba el manifiesto, descifra y deja todo listo para `rsync` + `pg_restore` |

- El servidor solo tiene `upbc-respaldo.pub`. `respaldo-gpg.sh` usa un anillo de
  llaves temporal y vacío y cifra con `--recipient-file`: en node-repository no
  existe ninguna llave privada.
- Se respaldan las dos partes que hacen falta para restaurar: el árbol físico
  (`/srv/home/<uid>/<id>.v<N>`) y las bases `metadatos_storage` (qué archivo es
  cada id, versiones, carpetas, accesos) y `comparticiones` (Shared File). Un
  respaldo solo de archivos no serviría: sin la base no se sabe qué es cada uno.
- Nada se escribe sin cifrar: `tar` y `pg_dump` van por tubería directo a `gpg`.
- `MANIFIESTO.sha256` detecta un respaldo dañado o alterado antes de descifrarlo.
- Retención: se borran los respaldos de más de 14 días (`RETENCION_DIAS`).

## Instalación en la VM node-repository

En la máquina del custodio (**no** en el servidor):

```bash
./generar-llaves-respaldo.sh            # pide una frase de paso
scp llaves-respaldo/upbc-respaldo.pub <admin>@node-repository:/tmp/
# Guardar llaves-respaldo/upbc-respaldo.privada.asc y revocacion.asc FUERA DE LÍNEA
```

En node-repository:

```bash
sudo apt install -y gnupg postgresql-client
sudo install -d -m 755 /etc/upbc /opt/upbc/respaldo
sudo install -m 644 /tmp/upbc-respaldo.pub /etc/upbc/upbc-respaldo.pub
sudo install -m 755 respaldo-gpg.sh /opt/upbc/respaldo/
sudo install -m 600 respaldo.conf.example /etc/upbc/respaldo.conf   # y ajustar rutas
sudo install -m 644 upbc-respaldo.cron /etc/cron.d/upbc-respaldo
sudo /opt/upbc/respaldo/respaldo-gpg.sh --verificar     # comprueba llave, rutas y bases
sudo /opt/upbc/respaldo/respaldo-gpg.sh                 # primer respaldo
```

Rotación del log (`/etc/logrotate.d/upbc-respaldo`):

```
/var/log/upbc-respaldo.log { weekly rotate 8 compress missingok notifempty }
```

## Comprobar el criterio de RF-11

```bash
# En el servidor (sin llave privada): debe fallar con "No secret key"
gpg --decrypt /var/backups/upbc/<fecha>/metadatos_storage.dump.gpg
# Con la llave del custodio:
./restaurar-respaldo.sh /ruta/<fecha> upbc-respaldo.privada.asc ./restaurado
```

Probado en desarrollo (GnuPG 2.4.8, PostgreSQL 18) con los datos reales de
Storage: sin la privada no se descifra, el respaldo no contiene ni tar ni SQL
legibles, la restauración devuelve los archivos idénticos (mismo SHA-256) y
volcados válidos para `pg_restore`, y un respaldo alterado se rechaza.

## Pendiente de decidir con el equipo

- Copiar los respaldos **fuera** de la VM (otro disco o equipo): si se pierde la
  VM, se pierden con ella. Están cifrados, así que pueden ir a cualquier sitio.
- Quién es el custodio de la llave privada y dónde se guarda.
