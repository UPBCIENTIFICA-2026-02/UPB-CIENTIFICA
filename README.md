# UPB-CIENTÍFICA

Sistema distribuido tipo "Google Drive" con servicios de cómputo de alto
rendimiento (HPC) para la microempresa UPB-CIENTÍFICA (UPB Bucaramanga).
Proyecto de la asignatura Sistemas Distribuidos.

**Arquitectura orientada a servicios (SOA):** servicios de grano grueso, cada uno
con su tecnología, comunicados por contratos estables (WSDL, `.proto`, RMI, REST).
Sin contenedores ni servicios cloud de terceros (lo prohíbe el enunciado).

## Servicios de este repositorio

| Carpeta | Servicio | Tecnología | Puerto |
|---|---|---|---|
| [`node-soap/`](node-soap/) | Authentication (directorio de usuarios) | PHP 8 + SOAP + OpenLDAP | 8081 |
| [`node-repository/`](node-repository/) | Distributed Storage (+ [respaldo GPG](node-repository/respaldo/README.md)) | Node.js + PostgreSQL | 8084 |
| [`node-shared-file/`](node-shared-file/README.md) | Shared File | Node.js + PostgreSQL | 8085 |
| [`node-media/`](node-media/) | Photo Album + Streaming | Node.js + FFmpeg + PostgreSQL | 8083 |
| [`node-sync/`](node-sync/README.md) | File Sync (`syncd`) | Go + gRPC | 9090 |
| [`node-web/`](node-web/README.md) | Portal web y pasarela | Node.js (+ Nginx) | 8080 / 443 |
| [`RMIUPBCientifica/`](RMIUPBCientifica/README.md) | Gestor del clúster HPC + job-api | Java 17 + RMI + Spring Boot | 8082 / 2099 |
| [`node-monitoreo/`](node-monitoreo/README.md) | Monitoreo | Prometheus + Grafana | 3000 |
| [`herramientas/auth-local.js`](herramientas/auth-local.js) | Auth de pruebas que imita node-soap | Node.js | 8081 |

Clientes (repositorios aparte): **FrontWebUPBCientifica** (SPA que entrega
node-web), **FrontUPBCientifica** (Android, Kotlin) y
**FrontDesktopUPBCientifica** (Python + CustomTkinter).

## Arrancar todo en un PC (Windows)

```powershell
cd despliegue\cluster-virtualbox
.\7-iniciar-servicios-windows.ps1 -HpcLocal -ModoAuth soap -Monitoreo
```

Portal en <http://localhost:8080> (`user1 / 1234`, `investigador / test`,
`estudiante / test`); monitoreo en <http://localhost:8080/monitoreo/>.
File Sync corre en una VM Ubuntu. Paso a paso, incluido el clúster MPI en
VirtualBox: [`docs/Guia_Cluster_VirtualBox_Local.md`](docs/Guia_Cluster_VirtualBox_Local.md).

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/TRASPASO.md`](docs/TRASPASO.md) | Decisiones, puertos, APIs, estado y pendientes. **Empieza aquí** |
| [`docs/contratos/`](docs/contratos/) | Contratos de servicio (PDF), [`Contrato PhotoAlbum.md`](docs/contratos/Contrato%20PhotoAlbum.md) y [`Adendas a los contratos.md`](docs/contratos/Adendas%20a%20los%20contratos.md) |
| [`docs/seguridad/analisis-vulnerabilidades.md`](docs/seguridad/analisis-vulnerabilidades.md) | Hallazgos, correcciones y riesgos asumidos |
| [`docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md`](docs/Guia_Cluster_HPC_UPB_CIENTIFICA.md) | Montaje del clúster MPI en el laboratorio (5 nodos) |
| [`docs/Guia_Cluster_VirtualBox_Local.md`](docs/Guia_Cluster_VirtualBox_Local.md) | Entorno completo en un PC |
| [`docs/CORRECCIONES-node-soap.md`](docs/CORRECCIONES-node-soap.md) | Cambios del Authentication Service y qué hacer en su VM |
| [`despliegue/`](despliegue/) | Scripts del clúster local y de la VM node-soap |
| [`docs/arquitectura/`](docs/arquitectura/) | Diagramas de componentes y despliegue |
