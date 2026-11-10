import { spawnSync } from 'node:child_process';

const migration = spawnSync(process.execPath, ['src/migrate.js'], { stdio: 'inherit' });
if (migration.error) throw migration.error;
if (migration.status === 0) {
  await import('./server.js');
} else {
  process.exitCode = migration.status ?? 1;
}
