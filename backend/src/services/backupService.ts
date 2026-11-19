import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DbClient, getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { recordAudit } from './auditService.js';

const BACKUP_TABLES = [
  'system_config',
  'companies',
  'users',
  'expenses',
  'trips',
  'reminder_series',
  'reminders',
  'cash_entries',
  'invoice_cities',
  'invoice_funds',
  'service_invoices',
  'reconciliations',
  'monthly_closings',
  'audit_logs',
  'login_history',
] as const;

export interface BackupPayload {
  system: 'FINANCER';
  formatVersion: 1;
  createdAt: string;
  createdBy: string;
  checksum: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

function computeChecksum(tables: Record<string, Array<Record<string, unknown>>>): string {
  return crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

export async function createFullBackup(params: {
  userId: string;
  userName: string;
  ipAddress?: string;
  saveToDisk?: boolean;
  db?: DbClient;
}): Promise<{ filename: string; payload: BackupPayload; savedPath?: string }> {
  const db = params.db || getDb();
  const tables: Record<string, Array<Record<string, unknown>>> = {};

  for (const table of BACKUP_TABLES) {
    const res = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    tables[table] = res.rows;
  }

  const createdAt = new Date().toISOString();
  const payload: BackupPayload = {
    system: 'FINANCER',
    formatVersion: 1,
    createdAt,
    createdBy: params.userName,
    checksum: computeChecksum(tables),
    tables,
  };

  const stamp = createdAt.replace(/[:.]/g, '-');
  const filename = `financer-backup-${stamp}.json`;
  let savedPath: string | undefined;

  if (params.saveToDisk !== false) {
    fs.mkdirSync(env.backupDir, { recursive: true });
    savedPath = path.join(env.backupDir, filename);
    fs.writeFileSync(savedPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  await recordAudit(
    {
      userId: params.userId,
      userName: params.userName,
      operation: 'BACKUP',
      module: 'Configurações',
      recordId: filename,
      newValue: {
        filename,
        counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      },
      description: `Backup completo do banco de dados gerado (${filename}).`,
      ipAddress: params.ipAddress,
    },
    db
  );

  return { filename, payload, savedPath };
}

export function listDiskBackups(): Array<{
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
}> {
  if (!fs.existsSync(env.backupDir)) return [];
  return fs
    .readdirSync(env.backupDir)
    .filter((f) => f.endsWith('.json'))
    .map((filename) => {
      const stat = fs.statSync(path.join(env.backupDir, filename));
      return {
        filename,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function restoreFullBackup(params: {
  payload: BackupPayload;
  userId: string;
  userName: string;
  ipAddress?: string;
  db?: DbClient;
}): Promise<{ restoredCounts: Record<string, number> }> {
  const db = params.db || getDb();
  const { payload } = params;

  if (!payload || payload.system !== 'FINANCER' || payload.formatVersion !== 1 || !payload.tables) {
    throw new Error('Arquivo de backup inválido ou incompatível com o FINANCER.');
  }

  const expectedChecksum = computeChecksum(payload.tables);
  if (payload.checksum !== expectedChecksum) {
    throw new Error('Integridade do backup comprometida (checksum divergente). Restauração abortada.');
  }

  const restoredCounts: Record<string, number> = {};

  await db.transaction(async (tx) => {
    // Limpa na ordem inversa das chaves estrangeiras
    const deleteOrder = [
      'login_history',
      'audit_logs',
      'monthly_closings',
      'reconciliations',
      'service_invoices',
      'invoice_funds',
      'invoice_cities',
      'cash_entries',
      'reminders',
      'reminder_series',
      'trips',
      'expenses',
      'password_reset_tokens',
      'user_sessions',
      'users',
      'companies',
      'system_config',
    ];

    for (const table of deleteOrder) {
      await tx.query(`DELETE FROM ${table}`);
    }

    // Reinsere na ordem correta das chaves estrangeiras
    for (const table of BACKUP_TABLES) {
      const rows = payload.tables[table] || [];
      restoredCounts[table] = rows.length;

      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const colList = cols.map((c) => `"${c}"`).join(', ');
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
        const vals = cols.map((c) => {
          const v = row[c];
          if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
            return JSON.stringify(v);
          }
          return v;
        });
        await tx.query(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, vals);
      }
    }

    await recordAudit(
      {
        userId: null,
        userName: params.userName,
        operation: 'RESTAURACAO',
        module: 'Configurações',
        recordId: payload.createdAt,
        newValue: { backupCreatedAt: payload.createdAt, restoredCounts },
        description: `Restauração completa do backup de ${payload.createdAt} concluída com sucesso.`,
        ipAddress: params.ipAddress,
      },
      tx
    );
  });

  return { restoredCounts };
}
