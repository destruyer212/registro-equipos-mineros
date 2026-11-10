# Plan y demo del reto

## Alcance y criterios de aceptación

| Prioridad | Entregable | Criterio de aceptación |
| --- | --- | --- |
| P0 | Despliegue reproducible | Un comando construye web y API, aplica migraciones y confirma ambas URLs. Una falla devuelve un código distinto de cero. |
| P0 | Inventario | Se puede crear, consultar, editar y retirar cada tipo de equipo. Se detectan códigos duplicados. |
| P0 | Mantenimiento | El estado cambia al alcanzar el intervalo. El servicio queda en historial y reinicia el ciclo con el mismo horómetro. |
| P1 | Portal | Hay búsqueda por código o tipo, filtros e indicadores que llevan a los equipos correspondientes. |
| P0 | Evidencia | README, tres enlaces y video de hasta tres minutos con un cambio visible publicado. |

## Backlog y seguimiento con prácticas de Scrum

Plan de cuatro días con entregas cortas y revisión al final de cada día. Para un proyecto individual, el backlog ordena la ejecución y la revisión se hace con los criterios de aceptación.

| Día | Objetivo | Evidencia |
| --- | --- | --- |
| 1 | Conectar web, API y base. Preparar dominios y publicar una primera versión. | Página pública y `/health` responden. |
| 2 | Cerrar CRUD, ciclo e historial. | Alta de camión, alerta al alcanzar 500 h y servicio registrado. |
| 3 | Validar despliegue repetido, fallos y experiencia de uso. | Dos despliegues correctos, datos conservados y un fallo controlado. |
| 4 | Revisar desde una ventana privada, grabar y entregar. | Enlaces abiertos sin sesión y video dentro del límite. |

## Alcance y riesgos con enfoque PMBOK

La tabla de criterios de aceptación delimita el alcance. El siguiente registro asigna una respuesta concreta a los riesgos de la entrega.

| Riesgo | Respuesta |
| --- | --- |
| DNS o HTTPS demoran | Configurar ambos dominios desde el primer día y comprobarlos desde fuera de la red del servidor. |
| El cambio parece publicado pero el navegador conserva la versión anterior | Verificar el SHA de la web y la API, y recargar en una ventana privada. |
| Las migraciones fallan o se ejecutan dos veces | Usar transacciones, bloqueo e historial de migraciones. Verificar un segundo despliegue con datos existentes. |
| El alcance se extiende | Cerrar primero los criterios P0 y reservar el último día para grabar y entregar. |

## Guion de video (2 min 40 s)

| Tiempo | Qué mostrar | Qué decir |
| --- | --- | --- |
| 0:00–0:20 | Abrir la URL pública y mostrar el título actual. | «MinaControl registra equipos y calcula su siguiente servicio con el horómetro y el último mantenimiento». |
| 0:20–0:45 | Abrir un camión que requiere mantenimiento. Mostrar el historial y, si da tiempo, registrar un servicio. | «El servicio queda guardado. El total del horómetro se mantiene y el ciclo vuelve a cero». |
| 0:45–1:10 | Cambiar el titular de la portada en `frontend/src/main.jsx`, hacer commit y push. | «Voy a cambiar este texto y publicar el commit en GitHub». |
| 1:10–2:10 | Ejecutar `node deploy.mjs` desde el servidor. Mostrar las cuatro etapas y el resultado. | «El comando construye ambos servicios, aplica migraciones y verifica el mismo commit en las dos URLs». |
| 2:10–2:40 | Recargar la web, enseñar el título nuevo y abrir `/health`. | «La web ya tiene el cambio. La API confirma la versión y que PostgreSQL está disponible». |

Antes de grabar, ensaya con el servidor y mide el tiempo de construcción. Deja las dependencias en caché con un despliegue previo. Mantén visibles el comando, su resultado y la recarga final. Para la prueba de negocio puedes crear un camión a 499 h, editarlo a 500 h y registrar el servicio. Usa datos ficticios durante la grabación.
