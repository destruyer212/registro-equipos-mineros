const field = (id) => document.getElementById(id);
const health = field('health');
const healthText = health.querySelector('span');
const command = field('curl-command');
const copy = field('copy-command');

function showHealth(state, text, detail) {
  health.dataset.state = state;
  healthText.textContent = text;
  field('health-detail').textContent = detail;
}

function showRelease(release) {
  const display = field('release');
  display.textContent = /^[a-f0-9]{40}$/i.test(release) ? release.slice(0, 12) : release || '—';
  display.title = release || '';
}

async function checkHealth() {
  try {
    const response = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    showRelease(result.release);
    if (response.ok && result.status === 'ok' && result.database === 'ok') {
      showHealth('ok', 'Operativo', 'API y PostgreSQL responden');
    } else {
      showHealth('degraded', 'Servicio degradado', `/health devolvió HTTP ${response.status}`);
    }
  } catch {
    showRelease('');
    showHealth('offline', 'Sin respuesta', 'La consulta a /health falló');
  }
}

async function loadReference() {
  try {
    const response = await fetch('/openapi.json', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const spec = await response.json();
    const server = spec.servers[0];
    const url = new URL(server.url, window.location.origin).origin;
    field('environment').textContent = server.description;
    field('base-url').textContent = url;
    field('spec-version').textContent = `OPENAPI ${spec.openapi}`;
    command.textContent = `curl ${url}/health`;
    copy.disabled = !navigator.clipboard;
    const webUrl = spec['x-minacontrol']?.webUrl;
    if (webUrl && /^https?:\/\//i.test(webUrl)) {
      const link = field('web-link');
      link.href = webUrl;
      link.hidden = false;
    }
    const methods = ['get', 'post', 'patch', 'delete', 'put', 'head', 'options', 'trace'];
    const count = Object.values(spec.paths).reduce((total, path) =>
      total + Object.keys(path).filter((method) => methods.includes(method)).length, 0);
    field('operation-count').textContent = `${count} operaciones · v${spec.info.version}`;
    field('operation-count').hidden = false;

    SwaggerUIBundle({
      spec,
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
      displayRequestDuration: true,
      validatorUrl: null,
      presets: [SwaggerUIBundle.presets.apis],
    });
    field('spec-status').hidden = true;
  } catch {
    field('environment').textContent = 'Configuración no disponible';
    field('spec-status').textContent = 'No se pudo cargar el contrato. Recarga la página para reintentar.';
  }
}

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(command.textContent);
    copy.textContent = 'Copiado';
  } catch {
    copy.textContent = 'Intenta de nuevo';
  }
  setTimeout(() => { copy.textContent = 'Copiar'; }, 1800);
});

loadReference();
checkHealth();
setInterval(() => { if (!document.hidden) checkHealth(); }, 30_000);
