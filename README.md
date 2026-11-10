# MinaControl

[![Pruebas de MinaControl](https://github.com/destruyer212/registro-equipos-mineros/actions/workflows/ci.yml/badge.svg)](https://github.com/destruyer212/registro-equipos-mineros/actions/workflows/ci.yml)

Portal de inventario y mantenimiento preventivo de equipos mineros. La web y la API son servicios independientes y PostgreSQL conserva las lecturas y los servicios registrados.

## Inicio rápido

Requiere Node.js 24, Docker en ejecución y Docker Compose v2 o posterior. Desde esta carpeta, también funciona en PowerShell.

```text
node deploy.mjs --local
```

En la primera ejecución crea un `.env` local con una contraseña aleatoria y activa seis equipos de demostración. Abre [el portal](http://localhost:4173) y verifica [el estado de la API](http://localhost:4180/health). Si necesitas otros puertos, configúralos en `.env` antes de ejecutar el comando.

### Aplicación instalable

El portal de flota se puede instalar desde **Instalar app** en navegadores compatibles. En iPhone, usa **Compartir → Añadir a pantalla de inicio**. La instalación y el modo sin conexión funcionan en HTTPS y se pueden ensayar en `localhost`.

Tras abrir la aplicación y cargar el inventario con conexión, puedes consultar la última copia guardada en ese dispositivo. El modo sin conexión es de lectura y muestra cuándo se guardó la copia. Registrar, editar y consultar el historial requiere una API disponible. El service worker guarda la interfaz y deja que el navegador solicite las versiones nuevas de la web.

```text
npm ci --prefix backend
npm --prefix backend test
docker stop minacontrol-local-web-1 minacontrol-local-api-1 minacontrol-local-db-1
```

Ejecuta las pruebas contra la API local activa. La prueba de integración crea un equipo temporal, comprueba el ciclo y lo retira del inventario. El comando de parada conserva el volumen de PostgreSQL.

## Cómo funciona

| Tipo | Intervalo de ejemplo |
| --- | ---: |
| Camión | 500 h |
| Excavadora | 250 h |
| Perforadora | 300 h |

Son intervalos de demostración. La API calcula el ciclo restando las horas del último servicio al horómetro. Si todavía no hay un servicio, parte de cero. El aviso de proximidad aparece al 80 % y la alerta de mantenimiento aparece al alcanzar o superar el intervalo.

El horómetro es acumulativo, entero y no decreciente. Registrar un servicio usa la lectura vigente, añade una entrada al historial y reinicia el ciclo. PostgreSQL bloquea el equipo mientras se registra el servicio para evitar duplicados a la misma lectura. Eliminar un equipo lo retira del inventario y conserva sus eventos en la base.

## Arquitectura

Abre el [portal de desarrolladores](http://localhost:4180/docs/) para consultar y probar las rutas con **Try it out**. La [especificación OpenAPI](http://localhost:4180/openapi.json) se sirve como JSON. **Servers** muestra el origen de API del entorno activo. Docker Compose lo configura desde el puerto local o el dominio público del despliegue. El estado y la versión mostrados se consultan en `/health`. Las operaciones de escritura modifican la base del entorno seleccionado.

```text
Navegador ──HTTPS──► Web React (Caddy)
    └───────HTTPS──► API REST Express ──► PostgreSQL
```

- `frontend/` contiene la interfaz React y un cliente HTTP que centraliza las llamadas.
- `backend/` contiene las rutas REST, la validación, las reglas del ciclo y las migraciones SQL. La API concentra las reglas de negocio.
- `compose.*.yaml` define los servicios. En producción, Caddy termina HTTPS y enruta dos dominios. PostgreSQL queda en la red interna.
- `deploy.mjs` construye, migra, publica y comprueba las versiones por HTTP.

| Método | Ruta | Operación |
| --- | --- | --- |
| GET | `/health` | Salud de la API y PostgreSQL, con identificador de versión |
| GET | `/api/v1/equipment-types` | Tipos e intervalos |
| GET, POST | `/api/v1/equipment` | Listar y crear |
| GET, PATCH, DELETE | `/api/v1/equipment/:id` | Consultar, actualizar campos y eliminar |
| GET, POST | `/api/v1/equipment/:id/maintenance` | Consultar historial y registrar servicio |

Para crear un equipo se envían `code`, `type` y `hours`. Los tipos son `truck`, `excavator` y `drill`. El servicio acepta `notes` opcional. Los errores de API tienen el formato `{ "error": { "code": "...", "message": "..." } }`.

## Despliegue público

1. Publica este código en GitHub y clona el repositorio en un servidor Linux con Node.js 24, Git y Docker Compose. La rama de trabajo del servidor debe seguir su rama remota.
2. Apunta dos nombres DNS al servidor, uno para la web y otro para la API. Abre TCP 80 y 443 para que Caddy pueda emitir los certificados HTTPS.
3. En esta carpeta, copia `.env.example` como `.env`. Rellena `WEB_HOST`, `API_HOST` y una contraseña alfanumérica aleatoria para PostgreSQL. Puedes generarla con `node -p "require('node:crypto').randomBytes(24).toString('hex')"`. Activa `DEMO_DATA=true` si quieres precargar datos ficticios.
4. Ejecuta desde el servidor:

```text
node deploy.mjs
```

El comando valida la configuración y el DNS, sincroniza el código publicado con Git, construye imágenes con etiquetas únicas, aplica las migraciones pendientes y publica los servicios. Comprueba la página principal, `/release.json` en la web, `/health` y la consulta del inventario en la API. La web y la API deben devolver el SHA del commit desplegado. Puedes repetirlo con la misma base. El historial de migraciones evita reejecutar SQL ya aplicado.

El portal es una demostración pública con operaciones de escritura abiertas. Usa una base aislada y datos ficticios. La emisión de certificados depende del DNS y de la accesibilidad del servidor.

### Rollback automático

Después del primer despliegue verificado, el servidor guarda en `.deploy-state/` las etiquetas y los manifiestos de la versión activa. Si una versión nueva falla después de que empieza a publicar servicios, el comando restaura la web, la API y, en producción, el proxy. Después vuelve a comprobar las URLs de esa versión. El intento fallido devuelve código `1` incluso cuando la restauración es correcta.

Si falla una migración, PostgreSQL revierte esa transacción antes de que se sustituyan los servicios. Si la migración ya terminó y el fallo ocurre después, el rollback restaura los servicios y conserva el esquema y los datos. Las migraciones futuras deben ser compatibles con la versión que sigue sirviendo tráfico. Mantén el directorio de estado y las imágenes de la última versión verificada en el servidor.

## Pruebas automatizadas

GitHub Actions ejecuta las pruebas en cada push a `main` y en los pull requests. El entorno de prueba tiene su propio proyecto Compose, puertos y volumen de PostgreSQL.

```text
npm ci --prefix backend
node --test backend/test/equipment.unit.test.js
node --test tests/deploy.integration.test.mjs
```

La prueba de despliegue verifica Swagger, el flujo REST, la persistencia entre versiones, una migración que falla dentro de una transacción, la restauración de las imágenes previas ante una API defectuosa y un despliegue posterior con la corrección.

## Entrega

Incluye el enlace al repositorio público, las URLs HTTPS de la web y de la API, y el video de hasta tres minutos. El [plan y guion](docs/entrega.md) recoge los criterios de aceptación y la secuencia para grabarlo.

**Uso de IA.** Se usó OpenAI Codex para apoyar la implementación, diseño visual, pruebas y documentación. La marca y los SVG de MinaControl son originales para la demostración.
