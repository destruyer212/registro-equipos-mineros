import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr, stdout: result.stdout.trim() };
}

async function availablePort() {
  const listener = createServer();
  await new Promise((ready, reject) => listener.once('error', reject).listen(0, '127.0.0.1', ready));
  const { port } = listener.address();
  await new Promise((done, reject) => listener.close((error) => error ? reject(error) : done()));
  return port;
}

test('Compose publica, conserva PostgreSQL y restaura la versión previa ante un fallo', { timeout: 540_000 }, async (t) => {
  const tempRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(tempRoot, 'minacontrol-ci-'));
  const project = `minacontrol-local-${randomBytes(5).toString('hex')}`;
  const docker = (...args) => run('docker', args, directory);
  const label = `label=com.docker.compose.project=${project}`;

  t.after(() => {
    const containers = docker('ps', '-aq', '--filter', label).stdout;
    if (containers) docker('rm', '-f', ...containers.split(/\s+/));
    const networks = docker('network', 'ls', '-q', '--filter', label).stdout;
    if (networks) docker('network', 'rm', ...networks.split(/\s+/));
    const volumes = docker('volume', 'ls', '-q', '--filter', label).stdout;
    if (volumes) docker('volume', 'rm', ...volumes.split(/\s+/));
    const images = docker('image', 'ls', '--filter', `reference=${project}-*`, '--format', '{{.Repository}}:{{.Tag}}').stdout;
    if (images) docker('image', 'rm', ...images.split(/\s+/));
    assert.equal(dirname(resolve(directory)), tempRoot);
    assert.match(basename(directory), /^minacontrol-ci-/);
    rmSync(directory, { recursive: true, force: true });
  });

  const files = ['backend', 'frontend', 'compose.yaml', 'compose.local.yaml', 'deploy.mjs'];
  for (const file of files) {
    cpSync(join(root, file), join(directory, file), {
      recursive: true,
      filter: (source) => !['node_modules', 'dist', '.env'].includes(basename(source)),
    });
  }
  const webPort = await availablePort();
  let apiPort = await availablePort();
  while (apiPort === webPort) apiPort = await availablePort();
  const web = `http://localhost:${webPort}`;
  const api = `http://localhost:${apiPort}`;
  const envFile = `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nLOCAL_PROJECT_NAME=${project}\n`;
  writeFileSync(join(directory, '.env'), `${envFile}LOCAL_WEB_PORT=${webPort}\nLOCAL_API_PORT=${apiPort}\nDEMO_DATA=true\n`);

  const deploy = () => run(process.execPath, ['deploy.mjs', '--local'], directory);
  const json = async (url, options) => {
    // A deployment replaces the container behind the same port. Use a fresh socket per probe.
    const response = await fetch(url, {
      ...options,
      headers: { ...options?.headers, Connection: 'close' },
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(response.ok, `${url} respondió HTTP ${response.status}`);
    return response.json();
  };
  const releases = async () => {
    const [frontend, backend] = await Promise.all([json(`${web}/release.json`), json(`${api}/health`)]);
    assert.equal(frontend.release, backend.release);
    return backend.release;
  };
  const stateFile = join(directory, '.deploy-state', `${project}.json`);
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));

  let result = deploy();
  assert.equal(result.status, 0, result.output);
  const first = await releases();
  t.diagnostic('Primera versión verificada con la web, la API y PostgreSQL.');
  const testEnv = { ...process.env, TEST_API_URL: api };
  delete testEnv.NODE_TEST_CONTEXT;
  result = run(process.execPath, ['--test', 'backend/test/inventory.integration.test.js'], root, testEnv);
  assert.equal(result.status, 0, result.output);
  const swagger = await json(`${api}/openapi.json`);
  assert.equal(swagger.openapi, '3.1.0');
  assert.deepEqual(swagger.servers, [{ url: api, description: 'Local · Docker Compose' }]);
  assert.equal(swagger['x-minacontrol'].webUrl, web);
  assert.ok(swagger.paths['/api/v1/equipment/{id}/maintenance'].post);
  const docs = await fetch(`${api}/docs/`);
  assert.match(await docs.text(), /Portal de desarrolladores/);
  const bundle = await fetch(`${api}/docs/swagger-ui-bundle.js`);
  assert.equal(bundle.status, 200);
  await bundle.body.cancel();

  const manifest = await json(`${web}/manifest.webmanifest`);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.deepEqual(manifest.shortcuts.map(({ url }) => url), ['/?vista=flota', '/?vista=mantenimiento']);
  for (const icon of manifest.icons) {
    const response = await fetch(`${web}${icon.src}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    await response.body.cancel();
  }
  const worker = await fetch(`${web}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('cache-control'), /no-cache/);
  assert.match(await worker.text(), /\/assets\/.+\.js/);
  if (process.env.TEST_PWA_BROWSER === 'true') {
    result = run(process.execPath, ['--test', 'frontend/test/pwa.browser.test.mjs'], root, { ...testEnv, TEST_WEB_URL: web });
    assert.equal(result.status, 0, result.output);
    t.diagnostic(result.stdout);
  }

  const { data: equipment } = await json(`${api}/api/v1/equipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'QA-ROLLBACK', type: 'truck', hours: 500 }),
  });

  result = deploy();
  assert.equal(result.status, 0, result.output);
  const previous = await releases();
  assert.notEqual(previous, first);
  const goodTag = state().imageTag;

  const migrations = join(directory, 'backend', 'migrations');
  const migration = join(migrations, '002_rollback_probe.sql');
  const psql = (sql) => docker('exec', `${project}-db-1`, 'psql', '-U', 'minacontrol', '-d', 'minacontrol', '-Atc', sql);
  const probeExists = () => psql("SELECT to_regclass('public.rollback_probe') IS NOT NULL");
  writeFileSync(migration, 'CREATE TABLE rollback_probe (id integer); SELECT 1 / 0;');
  result = deploy();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Falló la migración/);
  assert.equal(await releases(), previous);
  assert.deepEqual(probeExists().stdout, 'f');
  t.diagnostic('Migración defectuosa revertida sin reemplazar los servicios.');

  writeFileSync(migration, 'CREATE TABLE rollback_probe (id integer);');
  const backend = join(directory, 'backend', 'src', 'server.js');
  const healthySource = readFileSync(backend, 'utf8');
  assert.ok(healthySource.includes('SELECT 1 FROM equipment_types LIMIT 1'));
  writeFileSync(backend, healthySource.replace('SELECT 1 FROM equipment_types LIMIT 1', 'SELECT 1 FROM missing_health_table'));
  const composeFile = join(directory, 'compose.yaml');
  const compose = readFileSync(composeFile, 'utf8');
  writeFileSync(composeFile, compose.replace('retries: 12', 'retries: 2'));

  result = deploy();
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`Rollback verificado (${previous})`), result.output);
  assert.equal(await releases(), previous);
  assert.equal(state().imageTag, goodTag);
  assert.equal(docker('inspect', '--format', '{{.Config.Image}}', `${project}-api-1`).stdout, `${project}-api:${goodTag}`);
  assert.equal(docker('inspect', '--format', '{{.Config.Image}}', `${project}-web-1`).stdout, `${project}-web:${goodTag}`);
  assert.equal((await json(`${api}/api/v1/equipment/${equipment.id}`)).data.code, 'QA-ROLLBACK');
  assert.deepEqual(probeExists().stdout, 't');
  t.diagnostic('Rollback verificado con las imágenes previas y el inventario intacto.');

  writeFileSync(backend, healthySource);
  writeFileSync(composeFile, compose);
  result = deploy();
  assert.equal(result.status, 0, result.output);
  assert.notEqual(await releases(), previous);
  assert.equal((await json(`${api}/api/v1/equipment/${equipment.id}`)).data.hours, 500);
  t.diagnostic('La corrección se publicó con la misma base de datos.');
});
