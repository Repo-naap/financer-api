import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { DbClient, getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { normalizePermissions, PermissionsMatrix, UserRole } from '../domain/permissions.js';

const scryptAsync = promisify(crypto.scrypt);

export type CompanyCode = 'NAAP' | 'INFOR_MANAGER' | 'CONTABILITA';
export type CompanyTheme = 'purple' | 'navy' | 'burgundy';

export const ALL_COMPANY_CODES: CompanyCode[] = ['NAAP', 'INFOR_MANAGER', 'CONTABILITA'];

export interface CompanyInfo {
  code: CompanyCode;
  name: string;
  theme: CompanyTheme;
  office_document?: string;
  office_email?: string;
  office_phone?: string;
  initial_cash_balance: number;
  due_alert_days: number;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  active: boolean;
  permissions: PermissionsMatrix;
  allowedCompanies: CompanyCode[];
  companyCode: CompanyCode;
  companyName: string;
  companyTheme: CompanyTheme;
  sessionId: string;
}

export function normalizeAllowedCompanies(
  role: UserRole,
  raw?: unknown
): CompanyCode[] {
  if (role === 'ADMINISTRADOR') return [...ALL_COMPANY_CODES];
  if (Array.isArray(raw)) {
    const valid = raw.filter((c): c is CompanyCode =>
      ALL_COMPANY_CODES.includes(c as CompanyCode)
    );
    if (valid.length > 0) return Array.from(new Set(valid));
  }
  return ['NAAP'];
}

export async function getAllCompanies(db: DbClient = getDb()): Promise<CompanyInfo[]> {
  const res = await db.query<Record<string, unknown>>(
    `SELECT code, name, theme, office_document, office_email, office_phone,
            initial_cash_balance, due_alert_days
     FROM companies
     WHERE active = TRUE
     ORDER BY CASE code WHEN 'NAAP' THEN 1 WHEN 'INFOR_MANAGER' THEN 2 WHEN 'CONTABILITA' THEN 3 ELSE 4 END`
  );
  return res.rows.map((r) => ({
    code: r.code as CompanyCode,
    name: String(r.name),
    theme: r.theme as CompanyTheme,
    office_document: String(r.office_document || ''),
    office_email: String(r.office_email || ''),
    office_phone: String(r.office_phone || ''),
    initial_cash_balance: Number(r.initial_cash_balance || 0),
    due_alert_days: Number(r.due_alert_days ?? 5),
  }));
}

export async function getCompanyByCode(
  code: string,
  db: DbClient = getDb()
): Promise<CompanyInfo | null> {
  const res = await db.query<Record<string, unknown>>(
    `SELECT code, name, theme, office_document, office_email, office_phone,
            initial_cash_balance, due_alert_days
     FROM companies
     WHERE code = $1 AND active = TRUE`,
    [code]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    code: r.code as CompanyCode,
    name: String(r.name),
    theme: r.theme as CompanyTheme,
    office_document: String(r.office_document || ''),
    office_email: String(r.office_email || ''),
    office_phone: String(r.office_phone || ''),
    initial_cash_balance: Number(r.initial_cash_balance || 0),
    due_alert_days: Number(r.due_alert_days ?? 5),
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexKey] = parts;
  const expected = Buffer.from(hexKey, 'hex');
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(rawToken).digest('hex');
}

export async function createUserSession(
  userId: string,
  companyCode: CompanyCode,
  ipAddress: string,
  userAgent: string,
  db: DbClient = getDb()
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAtDate = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO user_sessions (id, user_id, company_code, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sessionId, userId, companyCode, tokenHash, ipAddress, userAgent, expiresAtDate.toISOString()]
  );

  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);

  return { token: rawToken, sessionId, expiresAt: expiresAtDate.toISOString() };
}

export async function validateSessionToken(
  rawToken: string,
  db: DbClient = getDb()
): Promise<AuthenticatedUser | null> {
  const tokenHash = hashToken(rawToken);
  const res = await db.query<{
    session_id: string;
    expires_at: string;
    revoked_at: string | null;
    company_code: CompanyCode;
    company_name: string;
    company_theme: CompanyTheme;
    id: string;
    name: string;
    login: string;
    role: UserRole;
    active: boolean;
    permissions: PermissionsMatrix;
    allowed_companies: CompanyCode[];
  }>(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       s.revoked_at,
       s.company_code,
       c.name AS company_name,
       c.theme AS company_theme,
       u.id,
       u.name,
       u.login,
       u.role,
       u.active,
       u.permissions,
       u.allowed_companies
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.code = s.company_code
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  const row = res.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (!row.active) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const allowed = normalizeAllowedCompanies(row.role, row.allowed_companies);
  if (!allowed.includes(row.company_code)) {
    return null;
  }

  await db.query('UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1', [
    row.session_id,
  ]);

  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    active: row.active,
    permissions: normalizePermissions(row.role, row.permissions),
    allowedCompanies: allowed,
    companyCode: row.company_code,
    companyName: row.company_name,
    companyTheme: row.company_theme,
    sessionId: row.session_id,
  };
}

export async function switchSessionCompany(
  sessionId: string,
  companyCode: CompanyCode,
  db: DbClient = getDb()
): Promise<void> {
  await db.query('UPDATE user_sessions SET company_code = $1, last_activity_at = NOW() WHERE id = $2', [
    companyCode,
    sessionId,
  ]);
}

export async function revokeSession(sessionId: string, db: DbClient = getDb()): Promise<void> {
  await db.query('UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
  ]);
}

export async function revokeAllUserSessions(
  userId: string,
  db: DbClient = getDb()
): Promise<void> {
  await db.query(
    'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

export async function recordLoginAttempt(
  params: {
    userId?: string | null;
    companyCode?: string;
    loginAttempted: string;
    success: boolean;
    reason?: string;
    ipAddress: string;
    userAgent: string;
  },
  db: DbClient = getDb()
): Promise<void> {
  await db.query(
    `INSERT INTO login_history (id, user_id, company_code, login_attempted, success, reason, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      params.userId ?? null,
      params.companyCode ?? 'NAAP',
      params.loginAttempted,
      params.success,
      params.reason ?? null,
      params.ipAddress,
      params.userAgent,
    ]
  );
}

export async function createPasswordResetToken(
  userId: string,
  createdBy: string | null,
  db: DbClient = getDb()
): Promise<{ resetCode: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const resetCode = crypto.randomBytes(6).toString('hex').toUpperCase();
  const tokenHash = hashToken(resetCode);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await db.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, tokenHash, expiresAt, createdBy]
  );

  return { resetCode, expiresAt };
}

export async function consumePasswordResetToken(
  login: string,
  resetCode: string,
  newPassword: string,
  db: DbClient = getDb()
): Promise<{ userId: string; userName: string }> {
  const tokenHash = hashToken(resetCode.trim().toUpperCase());
  const res = await db.query<{
    token_id: string;
    user_id: string;
    user_name: string;
    expires_at: string;
    used_at: string | null;
    active: boolean;
  }>(
    `SELECT
       t.id AS token_id,
       t.user_id,
       u.name AS user_name,
       t.expires_at,
       t.used_at,
       u.active
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE LOWER(u.login) = LOWER($1) AND t.token_hash = $2`,
    [login.trim(), tokenHash]
  );

  const row = res.rows[0];
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('Código de recuperação inválido ou expirado.');
  }
  if (!row.active) {
    throw new Error('Usuário inativo não pode redefinir a senha.');
  }

  const newHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW(), version = version + 1 WHERE id = $2',
      [newHash, row.user_id]
    );
    await tx.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [
      row.token_id,
    ]);
    await tx.query(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [row.user_id]
    );
  });

  return { userId: row.user_id, userName: row.user_name };
}
