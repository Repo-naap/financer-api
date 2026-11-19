import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { setupRouter } from './routes/setup.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { expensesRouter } from './routes/expenses.js';
import { tripsRouter } from './routes/trips.js';
import { remindersRouter } from './routes/reminders.js';
import { cashRouter } from './routes/cash.js';
import { invoicesRouter } from './routes/invoices.js';
import { importsRouter } from './routes/imports.js';
import { reconciliationRouter } from './routes/reconciliation.js';
import { closingRouter } from './routes/closing.js';
import { auditRouter } from './routes/audit.js';
import { settingsRouter } from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  const allowedOrigins = env.corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(null, true);
        }
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (env.nodeEnv === 'production') {
    app.use(
      '/api/auth/login',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
      })
    );
  }

  // Healthcheck público para monitoramento de servidor/nuvem
  app.get('/api/health', async (_req, res) => {
    try {
      const db = getDb();
      await db.query('SELECT 1');
      res.json({ status: 'ok', service: 'FINANCER', driver: db.driver });
    } catch {
      res.status(503).json({ status: 'error', service: 'FINANCER' });
    }
  });

  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/reconciliation', reconciliationRouter);
  app.use('/api/closing', closingRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/settings', settingsRouter);

  // Servir frontend compilado em produção (quando disponível)
  if (env.serveFrontend) {
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    if (fs.existsSync(frontendDist)) {
      app.use(express.static(frontendDist));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
          next();
          return;
        }
        res.sendFile(path.join(frontendDist, 'index.html'));
      });
    }
  }

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Rota da API não encontrada.' });
  });

  app.use(errorHandler);

  return app;
}
