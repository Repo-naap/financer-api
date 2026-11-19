import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { env } from '../config/env.js';
import { roundMoney } from '../domain/calculations.js';
import { normalizePermissions, UserRole } from '../domain/permissions.js';
import { HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  ALL_COMPANY_CODES,
  CompanyCode,
  createPasswordResetToken,
  getAllCompanies,
  getCompanyByCode,
  hashPassword,
  normalizeAllowedCompanies,
  revokeAllUserSessions,
} from '../services/authService.js';
import {
  BackupPayload,
  createFullBackup,
  listDiskBackups,
  restoreFullBackup,
} from '../services/backupService.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const configSchema = z.object({
  office_name: z.string().trim().min(2).max(200).optional(),
  office_document: z.string().trim().max(40).optional().default(''),
  office_email: z.string().trim().max(200).optional().default(''),
  office_phone: z.string().trim().max(40).optional().default(''),
  initial_cash_balance: z.coerce.number().finite().default(0),
  due_alert_days: z.coerce.number().int().min(0).max(60).default(5),
});

const companyCodesEnum = z.enum(['NAAP', 'INFOR_MANAGER', 'CONTABILITA']);

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do usuário.').max(160),
  login: z
    .string()
    .trim()
    .min(3, 'Login deve possuir no mínimo 3 caracteres.')
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Login inválido (use letras, números, ponto, traço ou _).'),
  password: z.string().min(8, 'Senha deve possuir no mínimo 8 caracteres.'),
  role: z.enum(['ADMINISTRADOR', 'FINANCEIRO', 'CONSULTA', 'PERSONALIZADO']),
  active: z.boolean().optional().default(true),
  permissions: z.record(z.record(z.boolean())).optional(),
  allowed_companies: z.array(companyCodesEnum).min(1, 'Selecione ao menos uma empresa.').optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  login: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  password: z.string().min(8).optional().or(z.literal('')),
  role: z.enum(['ADMINISTRADOR', 'FINANCEIRO', 'CONSULTA', 'PERSONALIZADO']).optional(),
  active: z.boolean().optional(),
  permissions: z.record(z.record(z.boolean())).optional(),
  allowed_companies: z.array(companyCodesEnum).min(1, 'Selecione ao menos uma empresa.').optional(),
  version: z.coerce.number().int().optional(),
});

settingsRouter.get('/companies', async (_req, res, next) => {
  try {
    const companies = await getAllCompanies();
    res.json({ companies });
  } catch (err) {
    next(err);
  }
});

settingsRouter.get('/config', async (req, res, next) => {
  try {
    const db = getDb();
    const company = await getCompanyByCode(req.user!.companyCode, db);
    res.json({
      company_code: company?.code,
      office_name: company?.name || req.user!.companyName,
      office_document: company?.office_document || '',
      office_email: company?.office_email || '',
      office_phone: company?.office_phone || '',
      initial_cash_balance: company?.initial_cash_balance ?? 0,
      due_alert_days: company?.due_alert_days ?? 5,
      theme: company?.theme || req.user!.companyTheme,
      setup_completed: true,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/config', requireAdmin, async (req, res, next) => {
  try {
    const body = configSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const prev = await getCompanyByCode(companyCode, db);

    const upd = await db.query<Record<string, unknown>>(
      `UPDATE companies SET
         office_document = $1,
         office_email = $2,
         office_phone = $3,
         initial_cash_balance = $4,
         due_alert_days = $5,
         updated_at = NOW()
       WHERE code = $6
       RETURNING *`,
      [
        body.office_document,
        body.office_email,
        body.office_phone,
        roundMoney(body.initial_cash_balance),
        body.due_alert_days,
        companyCode,
      ]
    );

    await recordAudit({
      companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'CONFIGURACAO',
      module: 'Configurações',
      recordId: companyCode,
      previousValue: prev,
      newValue: upd.rows[0],
      description: `Parâmetros financeiros da empresa ${req.user!.companyName} atualizados.`,
      ipAddress: req.clientIp,
    });

    const row = upd.rows[0];
    res.json({
      company_code: row.code,
      office_name: row.name,
      office_document: row.office_document,
      office_email: row.office_email,
      office_phone: row.office_phone,
      initial_cash_balance: Number(row.initial_cash_balance),
      due_alert_days: Number(row.due_alert_days),
      theme: row.theme,
      setup_completed: true,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.get('/users', requireAdmin, async (_req, res, next) => {
  try {
    const db = getDb();
    const resUsers = await db.query<Record<string, unknown>>(
      `SELECT id, name, login, role, active, permissions, allowed_companies, last_login_at, created_at, updated_at, version
       FROM users
       ORDER BY name ASC`
    );
    res.json({
      items: resUsers.rows.map((u) => ({
        ...u,
        permissions: normalizePermissions(u.role as UserRole, u.permissions as never),
        allowed_companies: normalizeAllowedCompanies(u.role as UserRole, u.allowed_companies),
      })),
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const body = createUserSchema.parse(req.body);
    const db = getDb();

    const dup = await db.query('SELECT id FROM users WHERE LOWER(login) = LOWER($1)', [body.login]);
    if (dup.rows[0]) {
      throw new HttpError(409, 'Já existe um usuário cadastrado com este login.');
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    const perms = normalizePermissions(body.role, body.permissions as never);
    const allowedCompanies: CompanyCode[] =
      body.role === 'ADMINISTRADOR'
        ? [...ALL_COMPANY_CODES]
        : normalizeAllowedCompanies(body.role, body.allowed_companies || [req.user!.companyCode]);

    const created = await db.transaction(async (tx) => {
      const ins = await tx.query<Record<string, unknown>>(
        `INSERT INTO users (id, name, login, password_hash, role, active, permissions, allowed_companies, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
         RETURNING id, name, login, role, active, permissions, allowed_companies, created_at, updated_at, version`,
        [
          id,
          body.name,
          body.login.toLowerCase(),
          passwordHash,
          body.role,
          body.active,
          JSON.stringify(perms),
          JSON.stringify(allowedCompanies),
          req.user!.id,
        ]
      );

      await recordAudit(
        {
          companyCode: req.user!.companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'ALTERACAO_USUARIOS',
          module: 'Configurações',
          recordId: id,
          newValue: {
            name: body.name,
            login: body.login.toLowerCase(),
            role: body.role,
            active: body.active,
            allowed_companies: allowedCompanies,
          },
          description: `Novo usuário "${body.name}" (${body.login.toLowerCase()}) cadastrado com perfil ${body.role} e acesso a: ${allowedCompanies.join(', ')}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return ins.rows[0];
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const body = updateUserSchema.parse(req.body);
    const db = getDb();

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Usuário não encontrado.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(409, 'Usuário alterado por outro administrador.', 'CONCURRENCY_CONFLICT');
    }

    const newRole = (body.role ?? existing.role) as UserRole;
    const newActive = body.active !== undefined ? body.active : Boolean(existing.active);

    if (existing.role === 'ADMINISTRADOR' && (newRole !== 'ADMINISTRADOR' || !newActive)) {
      const adminsRes = await db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM users WHERE role = 'ADMINISTRADOR' AND active = TRUE AND id <> $1`,
        [req.params.id]
      );
      if (Number(adminsRes.rows[0]?.cnt || 0) === 0) {
        throw new HttpError(
          400,
          'Não é possível desativar ou alterar o perfil do único administrador ativo do sistema.'
        );
      }
    }

    const newName = body.name ?? String(existing.name);
    const newLogin = (body.login ?? String(existing.login)).toLowerCase();
    const newPerms = normalizePermissions(
      newRole,
      (body.permissions ?? existing.permissions) as never
    );
    const newAllowedCompanies = normalizeAllowedCompanies(
      newRole,
      body.allowed_companies ?? existing.allowed_companies
    );

    const passwordHash =
      body.password && body.password.length >= 8
        ? await hashPassword(body.password)
        : String(existing.password_hash);

    const permissionsChanged =
      newRole !== existing.role ||
      JSON.stringify(newPerms) !== JSON.stringify(existing.permissions) ||
      JSON.stringify(newAllowedCompanies) !== JSON.stringify(existing.allowed_companies);

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE users SET
           name = $1,
           login = $2,
           password_hash = $3,
           role = $4,
           active = $5,
           permissions = $6::jsonb,
           allowed_companies = $7::jsonb,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $8
         RETURNING id, name, login, role, active, permissions, allowed_companies, last_login_at, created_at, updated_at, version`,
        [
          newName,
          newLogin,
          passwordHash,
          newRole,
          newActive,
          JSON.stringify(newPerms),
          JSON.stringify(newAllowedCompanies),
          req.params.id,
        ]
      );

      if (!newActive) {
        await revokeAllUserSessions(String(req.params.id), tx);
      }

      await recordAudit(
        {
          companyCode: req.user!.companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: permissionsChanged ? 'ALTERACAO_PERMISSOES' : 'ALTERACAO_USUARIOS',
          module: 'Configurações',
          recordId: String(req.params.id),
          previousValue: {
            name: existing.name,
            login: existing.login,
            role: existing.role,
            active: existing.active,
            allowed_companies: existing.allowed_companies,
            permissions: existing.permissions,
          },
          newValue: {
            name: newName,
            login: newLogin,
            role: newRole,
            active: newActive,
            allowed_companies: newAllowedCompanies,
            permissions: newPerms,
          },
          description: `Usuário "${newName}" atualizado (Perfil: ${newRole}, Empresas: ${newAllowedCompanies.join(', ')}, Situação: ${newActive ? 'Ativo' : 'Inativo'}).`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return upd.rows[0];
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/users/:id/reset-code', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const userRes = await db.query<{ id: string; name: string; login: string }>(
      'SELECT id, name, login FROM users WHERE id = $1',
      [req.params.id]
    );
    const target = userRes.rows[0];
    if (!target) throw new HttpError(404, 'Usuário não encontrado.');

    const token = await createPasswordResetToken(target.id, req.user!.id, db);
    await recordAudit({
      companyCode: req.user!.companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'ALTERACAO_USUARIOS',
      module: 'Configurações',
      recordId: target.id,
      description: `Código de recuperação de senha gerado pelo administrador para o usuário "${target.name}" (${target.login}).`,
      ipAddress: req.clientIp,
    });

    res.json({
      login: target.login,
      resetCode: token.resetCode,
      expiresAt: token.expiresAt,
      message: 'Código de recuperação gerado com validade de 2 horas.',
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    if (req.params.id === req.user!.id) {
      throw new HttpError(400, 'Você não pode excluir seu próprio usuário enquanto estiver conectado.');
    }

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT id, name, login, role, active FROM users WHERE id = $1',
      [req.params.id]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Usuário não encontrado.');

    if (existing.role === 'ADMINISTRADOR') {
      const adminsRes = await db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM users WHERE role = 'ADMINISTRADOR' AND active = TRUE AND id <> $1`,
        [req.params.id]
      );
      if (Number(adminsRes.rows[0]?.cnt || 0) === 0) {
        throw new HttpError(400, 'Não é possível excluir o único administrador ativo.');
      }
    }

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM users WHERE id = $1', [req.params.id]);
      await recordAudit(
        {
          companyCode: req.user!.companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EXCLUSAO',
          module: 'Configurações',
          recordId: String(req.params.id),
          previousValue: existing,
          description: `Usuário "${existing.name}" (${existing.login}) excluído.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Usuário excluído com sucesso.' });
  } catch (err) {
    next(err);
  }
});

// Backup e Restauração
settingsRouter.get('/backups', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ backups: listDiskBackups() });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/backups', requireAdmin, async (req, res, next) => {
  try {
    const download = req.query.download === 'true';
    const result = await createFullBackup({
      userId: req.user!.id,
      userName: req.user!.name,
      ipAddress: req.clientIp,
      saveToDisk: true,
    });

    if (download) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(JSON.stringify(result.payload, null, 2));
      return;
    }

    res.status(201).json({
      filename: result.filename,
      createdAt: result.payload.createdAt,
      checksum: result.payload.checksum,
      payload: result.payload,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.get('/backups/:filename', requireAdmin, async (req, res, next) => {
  try {
    const safeName = path.basename(String(req.params.filename));
    const fullPath = path.join(env.backupDir, safeName);
    if (!fs.existsSync(fullPath)) {
      throw new HttpError(404, 'Arquivo de backup não encontrado.');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/backups/restore', requireAdmin, async (req, res, next) => {
  try {
    let payload: BackupPayload;
    if (typeof req.body?.filename === 'string' && req.body.filename) {
      const safeName = path.basename(req.body.filename);
      const fullPath = path.join(env.backupDir, safeName);
      if (!fs.existsSync(fullPath)) {
        throw new HttpError(404, 'Arquivo de backup não encontrado no servidor.');
      }
      payload = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as BackupPayload;
    } else if (req.body?.payload) {
      payload = req.body.payload as BackupPayload;
    } else {
      payload = req.body as BackupPayload;
    }

    const result = await restoreFullBackup({
      payload,
      userId: req.user!.id,
      userName: req.user!.name,
      ipAddress: req.clientIp,
    });

    res.json({
      message: 'Backup restaurado com sucesso. Todas as sessões anteriores foram encerradas por segurança.',
      ...result,
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('backup') || err.message.includes('checksum'))) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  }
});

settingsRouter.get('/health', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const ping = await db.query<{ now: string }>('SELECT NOW()::text AS now');
    const counts = await db.query<{
      users: string;
      expenses: string;
      trips: string;
      reminders: string;
      cash_entries: string;
      municipalities: string;
      audit_logs: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users)::text AS users,
         (SELECT COUNT(*) FROM expenses WHERE company_code = $1)::text AS expenses,
         (SELECT COUNT(*) FROM trips WHERE company_code = $1)::text AS trips,
         (SELECT COUNT(*) FROM reminders WHERE company_code = $1)::text AS reminders,
         (SELECT COUNT(*) FROM cash_entries WHERE company_code = $1)::text AS cash_entries,
         (SELECT COUNT(*) FROM ibge_municipalities)::text AS municipalities,
         (SELECT COUNT(*) FROM audit_logs WHERE company_code = $1)::text AS audit_logs`,
      [companyCode]
    );

    res.json({
      status: 'ONLINE',
      companyCode,
      companyName: req.user!.companyName,
      databaseDriver: db.driver,
      serverTime: ping.rows[0]?.now,
      uptimeSeconds: Math.floor(process.uptime()),
      counts: counts.rows[0],
    });
  } catch (err) {
    next(err);
  }
});
