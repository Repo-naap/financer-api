import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || 'pglite://./pglite-data',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret:
    process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update('financer-dev-session-key').digest('hex'),
  sessionTtlHours: Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  backupDir: path.resolve(process.cwd(), process.env.BACKUP_DIR || './backups'),
  serveFrontend: process.env.SERVE_FRONTEND !== 'false',
};
