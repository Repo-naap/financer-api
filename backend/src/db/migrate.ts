import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbClient, getDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../sql/migrations');

export async function runMigrations(db: DbClient = getDb()): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const existing = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const appliedSet = new Set(existing.rows.map((r) => r.version));
  const newlyApplied: string[] = [];

  for (const file of files) {
    const version = file.split('_')[0];
    if (appliedSet.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    await db.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
      [version, file]
    );
    newlyApplied.push(file);
  }

  return newlyApplied;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((applied) => {
      console.log('Migrações aplicadas:', applied.length ? applied.join(', ') : 'nenhuma pendente');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Erro ao aplicar migrações:', err);
      process.exit(1);
    });
}
