import { env } from './config/env.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { seedIbgeMunicipalitiesIfEmpty } from './db/ibgeSeed.js';
import { createApp } from './app.js';

async function bootstrap() {
  const db = getDb();
  console.log(`[FINANCER] Inicializando banco de dados (${db.driver})...`);

  const applied = await runMigrations(db);
  if (applied.length > 0) {
    console.log(`[FINANCER] Migrações aplicadas: ${applied.join(', ')}`);
  }

  const munCount = await seedIbgeMunicipalitiesIfEmpty(db);
  console.log(`[FINANCER] Base IBGE pronta: ${munCount} municípios brasileiros carregados.`);

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[FINANCER] Servidor online em http://localhost:${env.port}`);
  });

  const shutdown = async () => {
    console.log('[FINANCER] Encerrando servidor com segurança...');
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[FINANCER] Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
