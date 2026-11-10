import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('.', import.meta.url));
const frontend = fileURLToPath(new URL('./frontend/', import.meta.url));
const lock = new URL('./.deploy-hosted.lock/', import.meta.url);
const configPath = new URL('./.env.hosted', import.meta.url);
const statePath = new URL('./.deploy-state/hosted.json', import.meta.url);
const pendingPath = new URL('./.deploy-state/hosted.pending.json', import.meta.url);
const commitPattern = /^[a-f0-9]{40}$/;
let stage = 'configuración';
let locked = false;

function run(command, args, cwd) {
  // The Windows Vercel shim needs a shell. Its arguments are fixed or validated below.
  const windowsShim = command === 'vercel' && process.platform === 'win32';
  const result = spawnSync(windowsShim ? [command, ...args].join(' ') : command, windowsShim ? [] : args, {
    cwd,
    shell: windowsShim,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 360_000,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}.`);
  return args[0] === 'deploy' ? result.stdout + result.stderr : result.stdout.trim();
}

function providerOrigin(value, domain, name) {
  const pattern = new RegExp(`^https://[a-z0-9][a-z0-9-]*\\.${domain.replace('.', '\\.')}\\/?$`);
  if (!pattern.test(value ?? '')) throw new Error(`${name} debe ser un origen HTTPS de ${domain}.`);
  return new URL(value).origin;
}

function renderHook(value) {
  let hook;
  try {
    hook = new URL(value);
  } catch {
    throw new Error('Configura RENDER_DEPLOY_HOOK con el enlace de Settings en Render.');
  }
  if (hook.origin !== 'https://api.render.com' || hook.username || hook.password ||
      hook.hash || !/^\/deploy\/srv-[a-z0-9]+$/.test(hook.pathname) || !hook.searchParams.get('key')) {
    throw new Error('RENDER_DEPLOY_HOOK debe ser el Deploy Hook oficial de este servicio.');
  }
  return hook;
}

async function triggerRender(hook, release) {
  const url = new URL(hook);
  url.searchParams.set('ref', release);
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20_000), redirect: 'error' })
    .catch(() => { throw new Error('Falló la conexión con el Deploy Hook de Render.'); });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Render rechazó el despliegue con HTTP ${response.status}.`);
}

async function get(url, origin) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
    headers: origin ? { Origin: origin } : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${new URL(url).pathname}.`);
  if (origin && response.headers.get('access-control-allow-origin') !== origin) {
    throw new Error('WEB_ORIGIN en Render debe coincidir con el origen de Vercel.');
  }
  return response;
}

async function waitFor(message, verify, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      await verify();
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() < deadline) await delay(5000);
    }
  } while (Date.now() < deadline);
  throw new Error(`${message} ${lastError?.message || ''}`);
}

async function verifyRender(api, web, release) {
  const health = await (await get(`${api}/health`)).json();
  if (health.release !== release || health.status !== 'ok' || health.database !== 'ok') {
    throw new Error('La API aún no sirve el commit solicitado con PostgreSQL operativo.');
  }
  const inventory = await (await get(`${api}/api/v1/equipment`, web)).json();
  if (!Array.isArray(inventory.data)) throw new Error('La API no devolvió el inventario.');
}

async function verifyWeb(web, release) {
  const result = await get(web);
  await result.body?.cancel();
  const metadata = await (await get(`${web}/release.json`)).json();
  if (metadata.release !== release) throw new Error('La web aún no sirve el commit solicitado.');
}

async function deploy() {
  if (!existsSync(configPath)) throw new Error('Copia .env.hosted.example a .env.hosted y configura los tres valores.');
  const env = parseEnv(readFileSync(configPath, 'utf8'));
  const web = providerOrigin(env.VERCEL_URL, 'vercel.app', 'VERCEL_URL');
  const api = providerOrigin(env.RENDER_URL, 'onrender.com', 'RENDER_URL');
  const hook = renderHook(env.RENDER_DEPLOY_HOOK);
  const vercel = (...args) => run('vercel', [...args, '--non-interactive'], frontend);
  const git = (...args) => run('git', args, root);
  if (!existsSync(new URL('./frontend/.vercel/project.json', import.meta.url))) {
    throw new Error('Vincula frontend con tu proyecto de Vercel usando vercel link.');
  }
  vercel('whoami');
  const release = git('rev-parse', 'HEAD');
  if (!commitPattern.test(release) || git('status', '--porcelain') ||
      git('rev-parse', 'refs/remotes/origin/main') !== release) {
    throw new Error('El checkout debe estar limpio y coincidir con main publicado en GitHub.');
  }

  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const canRestore = previous?.web === web && previous.api === api && commitPattern.test(previous.release);
  const lastDeployment = canRestore ? providerOrigin(previous.deployment, 'vercel.app', 'Despliegue anterior') : null;
  let renderTriggered = false;
  let promotionStarted = false;

  try {
    stage = 'construcción del frontend en Vercel';
    console.log(`[1/4] Construyendo frontend en Vercel (${release.slice(0, 12)})`);
    const candidate = vercel('deploy', '--prod', '--skip-domain', '--yes',
      '--build-env', `VITE_API_URL=${api}`, '--build-env', `MINACONTROL_RELEASE=${release}`);
    const deploymentUrls = new Set(candidate.match(/https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app\b/g));
    if (deploymentUrls.size !== 1) throw new Error('Vercel no devolvió una URL de despliegue inequívoca.');
    const deployment = providerOrigin([...deploymentUrls][0], 'vercel.app', 'URL de despliegue');

    stage = 'despliegue y migración del backend en Render';
    console.log('[2/4] Publicando la API en Render y esperando la migración');
    renderTriggered = true;
    await triggerRender(hook, release);
    await waitFor('Render no confirmó el despliegue.', () => verifyRender(api, web, release), 360_000);

    stage = 'publicación del frontend en Vercel';
    console.log('[3/4] Activando el frontend en su URL pública');
    promotionStarted = true;
    vercel('promote', deployment, '--yes');

    stage = 'verificación del despliegue';
    console.log('[4/4] Verificando ambas URLs y su versión');
    await waitFor('Vercel no confirmó el despliegue.', () => verifyWeb(web, release), 90_000);
    await verifyRender(api, web, release);
    mkdirSync(new URL('./.deploy-state/', import.meta.url), { recursive: true });
    writeFileSync(pendingPath, JSON.stringify({ web, api, release, deployment }), { mode: 0o600 });
    renameSync(pendingPath, statePath);
    console.log(`Despliegue verificado (${release}).\nWeb: ${web}\nAPI: ${api}\nSwagger: ${api}/docs/`);
  } catch (error) {
    if (renderTriggered && lastDeployment) {
      console.error(`Falló ${stage}. Restaurando ${previous.release.slice(0, 12)}.`);
      try {
        if (promotionStarted) vercel('rollback', lastDeployment, '--yes');
        await triggerRender(hook, previous.release);
        await waitFor('Render no confirmó la restauración.', () => verifyRender(api, web, previous.release), 360_000);
        await verifyWeb(web, previous.release);
        console.log('Rollback verificado en ambas URLs.');
      } catch (rollbackError) {
        console.error(`No se pudo verificar el rollback: ${rollbackError.message}`);
      }
    }
    throw error;
  }
}

try {
  mkdirSync(lock);
  locked = true;
  await deploy();
} catch (error) {
  console.error(error.code === 'EEXIST' && !locked
    ? 'Ya hay un despliegue alojado en curso. Si se interrumpió, revisa .deploy-hosted.lock.'
    : `Despliegue fallido en ${stage}. ${error.message}`);
  process.exitCode = 1;
} finally {
  if (locked) rmdirSync(lock);
}
