import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('./', import.meta.url));
const configPath = fileURLToPath(new URL('./.env', import.meta.url));
const lockPath = fileURLToPath(new URL('./.deploy.lock', import.meta.url));
const stateDirectory = fileURLToPath(new URL('./.deploy-state', import.meta.url));
const args = process.argv.slice(2);
const local = args.includes('--local');
let stage = 'validación inicial';
let locked = false;
let rollback;

function run(command, arguments_, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error?.code === 'ENOENT') throw new Error(`No se encontró ${command} en PATH.`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con ${result.status ?? result.signal}.`);
  return result.stdout?.trim();
}

function readConfig() {
  if (local && !existsSync(configPath)) {
    writeFileSync(configPath, `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nDEMO_DATA=true\n`, { flag: 'wx', mode: 0o600 });
    console.log('Se creó .env local con credenciales aleatorias y datos de demostración.');
  }
  if (!existsSync(configPath)) throw new Error('Crea .env a partir de .env.example.');
  const config = parseEnv(readFileSync(configPath, 'utf8'));
  if (!/^[a-zA-Z0-9]{20,128}$/.test(config.POSTGRES_PASSWORD ?? '')) {
    throw new Error('POSTGRES_PASSWORD debe tener entre 20 y 128 caracteres alfanuméricos.');
  }
  config.DEMO_DATA ||= 'false';
  if (!['true', 'false'].includes(config.DEMO_DATA)) throw new Error('DEMO_DATA debe ser true o false.');
  return config;
}

function localPort(value, fallback) {
  const port = value || fallback;
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error('Los puertos locales deben estar entre 1024 y 65535.');
  }
  return String(Number(port));
}

function publicHost(value, key) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(value ?? '') ||
      /\.(local|localhost|test|invalid|example)$/i.test(value)) {
    throw new Error(`${key} debe ser un dominio público completo, sin protocolo ni puerto.`);
  }
  return value.toLowerCase();
}

async function verifyRelease(web, api, release) {
  let reason;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const get = (url) => fetch(url, { signal: AbortSignal.timeout(4_000), cache: 'no-store' });
      const [page, metadata, health, inventory] = await Promise.all([
        get(web),
        get(`${web}/release.json`),
        get(`${api}/health`),
        get(`${api}/api/v1/equipment`),
      ]);
      if (!page.ok) throw new Error(`La página devolvió HTTP ${page.status}.`);
      if (!metadata.ok || (await metadata.json()).release !== release) {
        throw new Error('La web todavía no sirve la versión esperada.');
      }
      if (!health.ok) throw new Error(`/health devolvió HTTP ${health.status}.`);
      const data = await health.json();
      if (data.status !== 'ok' || data.database !== 'ok' || data.release !== release) {
        throw new Error('La API no confirma la versión esperada con PostgreSQL disponible.');
      }
      if (!inventory.ok || !Array.isArray((await inventory.json()).data)) {
        throw new Error('La API no pudo consultar el inventario.');
      }
      await page.body?.cancel();
      return;
    } catch (error) {
      reason = error.cause?.code || error.message;
      if (attempt < 29) await delay(3_000);
    }
  }
  throw new Error(`La verificación externa falló: ${reason}`);
}

function activate(compose, services) {
  compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '100', ...services);
}

try {
  if (args.length > 1 || (args.length === 1 && !local)) throw new Error('Uso: node deploy.mjs [--local]');
  try {
    mkdirSync(lockPath);
    locked = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Ya existe .deploy.lock. Si quedó de una interrupción, confirma que no haya otro despliegue antes de quitarlo.');
  }
  run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true });
  run('docker', ['compose', 'version'], { capture: true });
  const config = readConfig();
  const project = local ? (config.LOCAL_PROJECT_NAME || 'minacontrol-local') : 'minacontrol';
  if (local && !/^minacontrol-local(?:-[a-z0-9]{1,12})?$/.test(project)) {
    throw new Error('LOCAL_PROJECT_NAME debe ser minacontrol-local o minacontrol-local seguido de un sufijo alfanumérico.');
  }
  const services = local ? ['api', 'web'] : ['api', 'web', 'gateway'];
  const statePath = join(stateDirectory, `${project}.json`);
  const currentFiles = ['compose.yaml', local ? 'compose.local.yaml' : 'compose.prod.yaml'];
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const runtime = {};
  let release;

  if (local) {
    runtime.LOCAL_WEB_PORT = localPort(config.LOCAL_WEB_PORT, '4173');
    runtime.LOCAL_API_PORT = localPort(config.LOCAL_API_PORT, '4180');
    if (runtime.LOCAL_WEB_PORT === runtime.LOCAL_API_PORT) throw new Error('La web y la API necesitan puertos distintos.');
    runtime.WEB_URL = `http://localhost:${runtime.LOCAL_WEB_PORT}`;
    runtime.API_URL = `http://localhost:${runtime.LOCAL_API_PORT}`;
    release = `local-${randomBytes(5).toString('hex')}`;
  } else {
    runtime.WEB_HOST = publicHost(config.WEB_HOST, 'WEB_HOST');
    runtime.API_HOST = publicHost(config.API_HOST, 'API_HOST');
    if (runtime.WEB_HOST === runtime.API_HOST) throw new Error('La web y la API necesitan dominios distintos.');
    for (const host of [runtime.WEB_HOST, runtime.API_HOST]) {
      await lookup(host).catch(() => { throw new Error(`El DNS de ${host} aún no responde.`); });
    }
    runtime.WEB_URL = `https://${runtime.WEB_HOST}`;
    runtime.API_URL = `https://${runtime.API_HOST}`;
    stage = 'sincronizar código desde GitHub';
    if (run('git', ['status', '--porcelain'], { capture: true })) {
      throw new Error('Usa un checkout limpio y con su rama vinculada a GitHub.');
    }
    run('git', ['pull', '--ff-only']);
    release = run('git', ['rev-parse', 'HEAD'], { capture: true });
    if (release !== run('git', ['rev-parse', '@{upstream}'], { capture: true })) {
      throw new Error('El checkout del servidor debe coincidir con la rama publicada en GitHub.');
    }
  }

  const candidate = {
    release,
    imageTag: `${release.slice(0, 16)}-${randomBytes(6).toString('hex')}`,
    runtime,
    manifests: currentFiles.map((file) => readFileSync(join(root, file), 'utf8')),
  };
  const composeFor = (snapshot, files) => (...command) => run('docker', [
    'compose', '--project-name', project, '--project-directory', root, '--env-file', configPath,
    ...files.flatMap((file) => ['-f', file]), ...command,
  ], {
    env: {
      ...process.env, ...config, ...snapshot.runtime,
      COMPOSE_PROJECT_NAME: project, RELEASE_ID: snapshot.release, IMAGE_TAG: snapshot.imageTag,
    },
  });
  const compose = composeFor(candidate, currentFiles);

  if (previous) {
    stage = 'comprobar las imágenes de respaldo';
    run('docker', ['image', 'inspect', '--format', '{{.Id}}',
      ...services.map((service) => `${project}-${service}:${previous.imageTag}`)], { capture: true });
  }
  const existing = run('docker', ['ps', '-aq',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=api',
  ], { capture: true });

  stage = 'validar la configuración de Docker Compose';
  compose('config', '--quiet');
  stage = 'construir las imágenes del frontend y del backend';
  console.log(`\n[1/4] Construyendo MinaControl ${release}`);
  compose('build', ...services);
  stage = 'aplicar las migraciones de PostgreSQL';
  console.log('\n[2/4] Preparando PostgreSQL y aplicando migraciones');
  compose('up', '-d', '--no-recreate', '--wait', '--wait-timeout', '90', 'db');
  compose('run', '--rm', '--no-deps', 'api', 'node', 'src/migrate.js');

  rollback = async () => {
    if (!previous) {
      if (!existing) compose('rm', '--stop', '--force', ...services);
      console.error('Todavía no hay una versión verificada guardada para restaurar.');
      return;
    }
    console.log(`Restaurando la última versión verificada (${previous.release}).`);
    const files = previous.manifests.map((contents, index) => {
      const path = join(lockPath, `restore-${index}.yaml`);
      writeFileSync(path, contents);
      return path;
    });
    activate(composeFor(previous, files), services);
    await verifyRelease(previous.runtime.WEB_URL, previous.runtime.API_URL, previous.release);
    console.log(`Rollback verificado (${previous.release}).`);
  };
  stage = 'publicar el frontend y el backend';
  console.log('\n[3/4] Publicando frontend y backend');
  activate(compose, services);
  stage = 'verificar las dos URLs';
  console.log('\n[4/4] Verificando las URLs y la versión publicada');
  await verifyRelease(runtime.WEB_URL, runtime.API_URL, release);
  stage = 'registrar la versión verificada';
  mkdirSync(stateDirectory, { recursive: true });
  const pendingPath = join(stateDirectory, `${project}.pending.json`);
  writeFileSync(pendingPath, JSON.stringify(candidate), { mode: 0o600 });
  renameSync(pendingPath, statePath);
  rollback = undefined;
  console.log(`\nDespliegue correcto (${release}).\nWeb: ${runtime.WEB_URL}\nAPI: ${runtime.API_URL}\nSalud: ${runtime.API_URL}/health`);
} catch (error) {
  console.error(`\nDespliegue fallido al ${stage}. ${error.message}`);
  process.exitCode = 1;
  try {
    await rollback?.();
  } catch (restoreError) {
    console.error(`No se pudo verificar el rollback. ${restoreError.message}`);
  }
} finally {
  if (locked) {
    for (const index of [0, 1]) {
      const path = join(lockPath, `restore-${index}.yaml`);
      if (existsSync(path)) unlinkSync(path);
    }
    rmdirSync(lockPath);
  }
}
