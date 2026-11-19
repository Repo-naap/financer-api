import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getDefaultPermissionsForRole } from '../domain/permissions.js';
import { roundMoney } from '../domain/calculations.js';
import { HttpError } from '../domain/periodLock.js';
import {
  ALL_COMPANY_CODES,
  CompanyCode,
  createUserSession,
  getAllCompanies,
  getCompanyByCode,
  hashPassword,
  recordLoginAttempt,
} from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { extractClientIp } from '../middleware/auth.js';

export const setupRouter = Router();

const initSchema = z.object({
  companyCode: z.enum(['NAAP', 'INFOR_MANAGER', 'CONTABILITA']).optional().default('NAAP'),
  officeName: z.string().trim().min(2, 'Informe o nome do escritório ou grupo.').optional().default('Grupo NAAP / Infor Manager / Contabilitá'),
  officeDocument: z.string().trim().max(40).optional().default(''),
  officeEmail: z.string().trim().max(200).optional().default(''),
  officePhone: z.string().trim().max(40).optional().default(''),
  initialCashBalance: z.coerce.number().finite().optional().default(0),
  dueAlertDays: z.coerce.number().int().min(0).max(60).optional().default(5),
  adminName: z.string().trim().min(2, 'Informe o nome do administrador.'),
  adminLogin: z
    .string()
    .trim()
    .min(3, 'Login deve ter pelo menos 3 caracteres.')
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Login deve conter apenas letras, números, ponto, traço ou sublinhado.'),
  adminPassword: z.string().min(8, 'A senha inicial deve possuir no mínimo 8 caracteres.'),
});

setupRouter.get('/status', async (_req, res, next) => {
  try {
    const db = getDb();
    const cfg = await db.query<{
      setup_completed: boolean;
      office_name: string;
    }>('SELECT setup_completed, office_name FROM system_config WHERE id = 1');
    const userCount = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM users');
    const hasUsers = Number(userCount.rows[0]?.cnt || 0) > 0;
    const companies = await getAllCompanies(db);

    res.json({
      setupCompleted: Boolean(cfg.rows[0]?.setup_completed) && hasUsers,
      officeName: cfg.rows[0]?.office_name || 'FINANCER – Gestão Financeira',
      companies,
    });
  } catch (err) {
    next(err);
  }
});

setupRouter.post('/initialize', async (req, res, next) => {
  try {
    const body = initSchema.parse(req.body);
    const db = getDb();

    const userCount = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM users');
    if (Number(userCount.rows[0]?.cnt || 0) > 0) {
      throw new HttpError(409, 'A configuração inicial do FINANCER já foi concluída.');
    }

    const adminId = crypto.randomUUID();
    const passwordHash = await hashPassword(body.adminPassword);
    const permissions = getDefaultPermissionsForRole('ADMINISTRADOR');
    const ipAddress = extractClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '');
    const companyCode = body.companyCode as CompanyCode;

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE system_config SET
           office_name = $1,
           office_document = $2,
           office_email = $3,
           office_phone = $4,
           initial_cash_balance = $5,
           due_alert_days = $6,
           setup_completed = TRUE,
           updated_at = NOW()
         WHERE id = 1`,
        [
          body.officeName,
          body.officeDocument,
          body.officeEmail,
          body.officePhone,
          roundMoney(body.initialCashBalance),
          body.dueAlertDays,
        ]
      );

      await tx.query(
        `UPDATE companies SET
           office_document = $1,
           office_email = $2,
           office_phone = $3,
           initial_cash_balance = $4,
           due_alert_days = $5,
           updated_at = NOW()
         WHERE code = $6`,
        [
          body.officeDocument,
          body.officeEmail,
          body.officePhone,
          roundMoney(body.initialCashBalance),
          body.dueAlertDays,
          companyCode,
        ]
      );

      await tx.query(
        `INSERT INTO users (id, name, login, password_hash, role, active, permissions, allowed_companies)
         VALUES ($1, $2, $3, $4, 'ADMINISTRADOR', TRUE, $5::jsonb, $6::jsonb)`,
        [
          adminId,
          body.adminName,
          body.adminLogin.toLowerCase(),
          passwordHash,
          JSON.stringify(permissions),
          JSON.stringify(ALL_COMPANY_CODES),
        ]
      );

      await recordAudit(
        {
          companyCode,
          userId: adminId,
          userName: body.adminName,
          operation: 'CONFIGURACAO',
          module: 'Configurações',
          recordId: adminId,
          newValue: {
            officeName: body.officeName,
            companyCode,
            initialCashBalance: roundMoney(body.initialCashBalance),
            adminLogin: body.adminLogin.toLowerCase(),
          },
          description: `Configuração inicial do FINANCER concluída pelo administrador ${body.adminName}.`,
          ipAddress,
        },
        tx
      );
    });

    const session = await createUserSession(adminId, companyCode, ipAddress, userAgent, db);
    await recordLoginAttempt(
      {
        userId: adminId,
        companyCode,
        loginAttempted: body.adminLogin.toLowerCase(),
        success: true,
        reason: 'Primeiro acesso (Configuração Inicial)',
        ipAddress,
        userAgent,
      },
      db
    );

    const company = await getCompanyByCode(companyCode, db);
    const companies = await getAllCompanies(db);

    res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      company,
      companies,
      user: {
        id: adminId,
        name: body.adminName,
        login: body.adminLogin.toLowerCase(),
        role: 'ADMINISTRADOR',
        active: true,
        permissions,
        allowedCompanies: ALL_COMPANY_CODES,
        companyCode: company!.code,
        companyName: company!.name,
        companyTheme: company!.theme,
      },
    });
  } catch (err) {
    next(err);
  }
});
