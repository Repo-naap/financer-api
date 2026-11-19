import crypto from 'node:crypto';
import { DbClient, getDb } from '../db/index.js';

export type AuditOperation =
  | 'INCLUSAO'
  | 'EDICAO'
  | 'EXCLUSAO'
  | 'CANCELAMENTO'
  | 'REABERTURA'
  | 'ALTERACAO_PERMISSOES'
  | 'ALTERACAO_USUARIOS'
  | 'FECHAMENTO_MENSAL'
  | 'BACKUP'
  | 'RESTAURACAO'
  | 'CONFIGURACAO';

export interface AuditEntryInput {
  companyCode?: string;
  userId?: string | null;
  userName: string;
  operation: AuditOperation;
  module: string;
  recordId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  description: string;
  ipAddress?: string | null;
}

function sanitizeForAudit(val: unknown): unknown {
  if (!val || typeof val !== 'object') return val ?? null;
  if (Array.isArray(val)) return val.map(sanitizeForAudit);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (k.toLowerCase().includes('password') || k.toLowerCase().includes('token')) {
      out[k] = '[PROTEGIDO]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function recordAudit(
  entry: AuditEntryInput,
  db: DbClient = getDb()
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO audit_logs (
       id, company_code, user_id, user_name, operation, module, record_id,
       previous_value, new_value, description, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
    [
      id,
      entry.companyCode || 'NAAP',
      entry.userId ?? null,
      entry.userName,
      entry.operation,
      entry.module,
      entry.recordId ?? null,
      entry.previousValue !== undefined ? JSON.stringify(sanitizeForAudit(entry.previousValue)) : null,
      entry.newValue !== undefined ? JSON.stringify(sanitizeForAudit(entry.newValue)) : null,
      entry.description,
      entry.ipAddress ?? null,
    ]
  );
  return id;
}
