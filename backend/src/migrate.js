import { readdir, readFile } from 'node:fs/promises';
import { pool, transaction } from './db.js';

try {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();

  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(482713)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(({ name }) => name));

    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`Migración aplicada: ${file}`);
    }

    if (process.env.DEMO_DATA === 'true') {
      for (const [name, file] of [['demo-v1', './demo.sql'], ['demo-v2', './demo-maintenance.sql']]) {
        if (applied.has(name)) continue;
        await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        console.log(`Datos de demostración cargados: ${name}.`);
      }
    }
  });
  console.log('Esquema de PostgreSQL al día.');
} catch (error) {
  console.error('Falló la migración:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
