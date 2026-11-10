import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('./', import.meta.url));
const configPath = fileURLToPath(new URL('./.env', import.meta.url));
const lockPath = fileURLToPath(new URL('./.deploy.lock', import.meta.url));
const args = process.argv.slice(2);
const local = args.includes('--local');
let stage = 'validación inicial';
let locked = false;

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
      const [page, metadata, health] = await Promise.all([
        get(web),
        get(`${web}/release.json`),
        get(`${api}/health`),
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
      await page.body?.cancel();
      return;
    } catch (error) {
      reason = error.cause?.code || error.message;
      if (attempt < 29) await delay(3_000);
    }
  }
  throw new Error(`La verificación externa falló: ${reason}`);
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
  let release;

  if (local) {
    config.LOCAL_WEB_PORT = localPort(config.LOCAL_WEB_PORT, '4173');
    config.LOCAL_API_PORT = localPort(config.LOCAL_API_PORT, '4180');
    if (config.LOCAL_WEB_PORT === config.LOCAL_API_PORT) throw new Error('La web y la API necesitan puertos distintos.');
    config.WEB_URL = `http://localhost:${config.LOCAL_WEB_PORT}`;
    config.API_URL = `http://localhost:${config.LOCAL_API_PORT}`;
    release = `local-${randomBytes(5).toString('hex')}`;
  } else {
    config.WEB_HOST = publicHost(config.WEB_HOST, 'WEB_HOST');
    config.API_HOST = publicHost(config.API_HOST, 'API_HOST');
    if (config.WEB_HOST === config.API_HOST) throw new Error('La web y la API necesitan dominios distintos.');
    for (const host of [config.WEB_HOST, config.API_HOST]) {
      await lookup(host).catch(() => { throw new Error(`El DNS de ${host} aún no responde.`); });
    }
    config.WEB_URL = `https://${config.WEB_HOST}`;
    config.API_URL = `https://${config.API_HOST}`;
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

  const env = { ...process.env, ...config, RELEASE_ID: release };
  const project = local ? 'minacontrol-local' : 'minacontrol';
  const compose = (...command) => run('docker', [
    'compose', '--project-name', project, '--env-file', '.env', '-f', 'compose.yaml',
    '-f', local ? 'compose.local.yaml' : 'compose.prod.yaml', ...command,
  ], { env });

  stage = 'validar la configuración de Docker Compose';
  compose('config', '--quiet');
  stage = 'construir las imágenes del frontend y del backend';
  console.log(`\n[1/4] Construyendo MinaControl ${release}`);
  const images = local ? ['api', 'web'] : ['api', 'web', 'gateway'];
  compose('build', ...images);
  stage = 'aplicar las migraciones de PostgreSQL';
  console.log('\n[2/4] Preparando PostgreSQL y aplicando migraciones');
  compose('up', '-d', '--wait', '--wait-timeout', '90', 'db');
  compose('run', '--rm', '--no-deps', 'api', 'node', 'src/migrate.js');
  stage = 'publicar el frontend y el backend';
  console.log('\n[3/4] Publicando frontend y backend');
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '100', 'api', 'web');
  if (!local) compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60', 'gateway');
  stage = 'verificar las dos URLs';
  console.log('\n[4/4] Verificando las URLs y la versión publicada');
  await verifyRelease(config.WEB_URL, config.API_URL, release);
  console.log(`\nDespliegue correcto (${release}).\nWeb: ${config.WEB_URL}\nAPI: ${config.API_URL}\nSalud: ${config.API_URL}/health`);
} catch (error) {
  console.error(`\nDespliegue fallido al ${stage}. ${error.message}`);
  process.exitCode = 1;
} finally {
  if (locked) rmdirSync(lockPath);
}
