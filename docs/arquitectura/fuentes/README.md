# Fuentes de los diagramas

Los diagramas de `docs/arquitectura/` se generan desde estos archivos PlantUML.
Están organizados como la Figura 1 del enunciado (consumidores → bus de
servicios → servidores de aplicación → implementación de servicios → clúster
HPC) y marcan en naranja lo que está «pendiente».

| Fuente | Imagen generada | Copia publicada |
|---|---|---|
| `componentes.puml` | `componentes.png` | `../ComponentDiagram1.jpg.jpeg` |
| `despliegue.puml` | `despliegue.png` | `../DeploymentDiagram1.jpg.jpeg` |

## Regenerar

Requiere Java 17+. No hace falta Graphviz (`!pragma layout smetana`).

```powershell
mvn -q dependency:get -Dartifact=net.sourceforge.plantuml:plantuml:1.2024.7
$jar = "$env:USERPROFILE\.m2\repository\net\sourceforge\plantuml\plantuml\1.2024.7\plantuml-1.2024.7.jar"
java -jar $jar -tpng -charset UTF-8 componentes.puml despliegue.puml
```

Después, copiar las imágenes sobre las publicadas (formato JPEG) y regenerar
el documento de arquitectura si cambió algo de las secciones 3, 4 o 10.
