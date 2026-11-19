import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { normalizePermissions, PermissionsMatrix, UserRole } from '../domain/permissions.js';
import { HttpError } from '../domain/periodLock.js';
import {
  CompanyCode,
  consumePasswordResetToken,
  createUserSession,
  getAllCompanies,
  getCompanyByCode,
  hashPassword,
  normalizeAllowedCompanies,
  recordLoginAttempt,
  revokeSession,
  switchSessionCompany,
  verifyPassword,
} from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { extractClientIp, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Informe o login.'),
  password: z.string().min(1, 'Informe a senha.'),
  companyCode: z.enum(['NAAP', 'INFOR_MANAGER', 'CONTABILITA']).optional(),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const db = getDb();
    const ipAddress = extractClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '');

    const userRes = await db.query<{
      id: string;
      name: string;
      login: string;
      password_hash: string;
      role: UserRole;
      active: boolean;
      permissions: PermissionsMatrix;
      allowed_companies: CompanyCode[];
    }>('SELECT * FROM users WHERE LOWER(login) = LOWER($1)', [body.login]);

    const user = userRes.rows[0];
    const requestedCompany = (body.companyCode || 'NAAP') as CompanyCode;

    if (!user) {
      await recordLoginAttempt(
        {
          userId: null,
          companyCode: requestedCompany,
          loginAttempted: body.login,
          success: false,
          reason: 'Usuário não encontrado',
          ipAddress,
          userAgent,
        },
        db
      );
      throw new HttpError(401, 'Login ou senha inválidos.');
    }

    if (!user.active) {
      await recordLoginAttempt(
        {
          userId: user.id,
          companyCode: requestedCompany,
          loginAttempted: body.login,
          success: false,
          reason: 'Usuário inativo bloqueado',
          ipAddress,
          userAgent,
        },
        db
      );
      throw new HttpError(403, 'Usuário inativo. Contate o administrador do escritório.');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await recordLoginAttempt(
        {
          userId: user.id,
          companyCode: requestedCompany,
          loginAttempted: body.login,
          success: false,
          reason: 'Senha incorreta',
          ipAddress,
          userAgent,
        },
        db
      );
      throw new HttpError(401, 'Login ou senha inválidos.');
    }

    const allowedCompanies = normalizeAllowedCompanies(user.role, user.allowed_companies);
    const targetCompanyCode: CompanyCode = body.companyCode
      ? (body.companyCode as CompanyCode)
      : allowedCompanies[0];

    if (!allowedCompanies.includes(targetCompanyCode)) {
      const targetInfo = await getCompanyByCode(targetCompanyCode, db);
      await recordLoginAttempt(
        {
          userId: user.id,
          companyCode: targetCompanyCode,
          loginAttempted: user.login,
          success: false,
          reason: `Sem permissão para a empresa ${targetInfo?.name || targetCompanyCode}`,
          ipAddress,
          userAgent,
        },
        db
      );
      throw new HttpError(
        403,
        `Seu usuário não possui autorização para acessar a empresa ${targetInfo?.name || targetCompanyCode}. Selecione uma empresa permitida ou contate o administrador.`
      );
    }

    const company = await getCompanyByCode(targetCompanyCode, db);
    if (!company) {
      throw new HttpError(404, 'Empresa selecionada não encontrada.');
    }

    const session = await createUserSession(user.id, company.code, ipAddress, userAgent, db);
    await recordLoginAttempt(
      {
        userId: user.id,
        companyCode: company.code,
        loginAttempted: user.login,
        success: true,
        reason: `Login realizado na empresa ${company.name}`,
        ipAddress,
        userAgent,
      },
      db
    );

    const permissions = normalizePermissions(user.role, user.permissions);
    const allCompanies = await getAllCompanies(db);
    const userCompanies = allCompanies.filter((c) => allowedCompanies.includes(c.code));

    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      company,
      companies: userCompanies,
      config: {
        office_name: company.name,
        office_document: company.office_document,
        office_email: company.office_email,
        office_phone: company.office_phone,
        initial_cash_balance: company.initial_cash_balance,
        due_alert_days: company.due_alert_days,
        setup_completed: true,
      },
      user: {
        id: user.id,
        name: user.name,
        login: user.login,
        role: user.role,
        active: user.active,
        permissions,
        allowedCompanies,
        companyCode: company.code,
        companyName: company.name,
        companyTheme: company.theme,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/switch-company', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      companyCode: z.enum(['NAAP', 'INFOR_MANAGER', 'CONTABILITA']),
    });
    const { companyCode } = schema.parse(req.body);
    const db = getDb();

    if (!req.user!.allowedCompanies.includes(companyCode)) {
      throw new HttpError(403, 'Você não tem permissão para acessar esta empresa.');
    }

    const company = await getCompanyByCode(companyCode, db);
    if (!company) throw new HttpError(404, 'Empresa não encontrada.');

    await switchSessionCompany(req.user!.sessionId, company.code, db);

    const allCompanies = await getAllCompanies(db);
    const userCompanies = allCompanies.filter((c) => req.user!.allowedCompanies.includes(c.code));

    res.json({
      company,
      companies: userCompanies,
      config: {
        office_name: company.name,
        office_document: company.office_document,
        office_email: company.office_email,
        office_phone: company.office_phone,
        initial_cash_balance: company.initial_cash_balance,
        due_alert_days: company.due_alert_days,
        setup_completed: true,
      },
      user: {
        ...req.user!,
        companyCode: company.code,
        companyName: company.name,
        companyTheme: company.theme,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeSession(req.user!.sessionId);
    res.json({ message: 'Sessão encerrada com sucesso.' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const company = await getCompanyByCode(req.user!.companyCode, db);
    const allCompanies = await getAllCompanies(db);
    const userCompanies = allCompanies.filter((c) => req.user!.allowedCompanies.includes(c.code));

    res.json({
      user: req.user,
      company,
      companies: userCompanies,
      config: company
        ? {
            office_name: company.name,
            office_document: company.office_document,
            office_email: company.office_email,
            office_phone: company.office_phone,
            initial_cash_balance: company.initial_cash_balance,
            due_alert_days: company.due_alert_days,
            setup_completed: true,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres.'),
});

authRouter.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    const db = getDb();

    const userRes = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );
    const valid = await verifyPassword(body.currentPassword, userRes.rows[0].password_hash);
    if (!valid) {
      throw new HttpError(400, 'A senha atual informada está incorreta.');
    }

    const newHash = await hashPassword(body.newPassword);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW(), version = version + 1 WHERE id = $2',
      [newHash, req.user!.id]
    );

    await recordAudit({
      companyCode: req.user!.companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'ALTERACAO_USUARIOS',
      module: 'Configurações',
      recordId: req.user!.id,
      description: `Usuário ${req.user!.name} alterou sua própria senha.`,
      ipAddress: req.clientIp,
    });

    res.json({ message: 'Senha alterada com sucesso.' });
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  login: z.string().trim().min(1, 'Informe o login.'),
  resetCode: z.string().trim().min(4, 'Informe o código de recuperação.'),
  newPassword: z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres.'),
});

authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const body = resetPasswordSchema.parse(req.body);
    const result = await consumePasswordResetToken(body.login, body.resetCode, body.newPassword);

    await recordAudit({
      companyCode: 'NAAP',
      userId: result.userId,
      userName: result.userName,
      operation: 'ALTERACAO_USUARIOS',
      module: 'Configurações',
      recordId: result.userId,
      description: `Senha redefinida por meio de código de recuperação para o usuário ${result.userName}.`,
      ipAddress: extractClientIp(req),
    });

    res.json({ message: 'Senha redefinida com sucesso. Faça login com a nova senha.' });
  } catch (err) {
    if (err instanceof Error && err.message.includes('recuperação')) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  }
});

authRouter.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const isAdmin = req.user!.role === 'ADMINISTRADOR';
    const sql = isAdmin
      ? `SELECT s.id, s.user_id, s.company_code, c.name AS company_name, u.name AS user_name, u.login,
                s.ip_address, s.user_agent, s.created_at, s.last_activity_at, s.expires_at, s.revoked_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN companies c ON c.code = s.company_code
         ORDER BY s.created_at DESC
         LIMIT 100`
      : `SELECT s.id, s.user_id, s.company_code, c.name AS company_name, u.name AS user_name, u.login,
                s.ip_address, s.user_agent, s.created_at, s.last_activity_at, s.expires_at, s.revoked_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN companies c ON c.code = s.company_code
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC
         LIMIT 50`;

    const result = isAdmin ? await db.query(sql) : await db.query(sql, [req.user!.id]);
    res.json({
      currentSessionId: req.user!.sessionId,
      sessions: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const targetId = String(req.params.id);
    const found = await db.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM user_sessions WHERE id = $1',
      [targetId]
    );
    if (!found.rows[0]) {
      throw new HttpError(404, 'Sessão não encontrada.');
    }
    if (req.user!.role !== 'ADMINISTRADOR' && found.rows[0].user_id !== req.user!.id) {
      throw new HttpError(403, 'Você não tem permissão para encerrar a sessão de outro usuário.');
    }
    await revokeSession(targetId, db);
    res.json({ message: 'Sessão encerrada com sucesso.' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/login-history', requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const isAdmin = req.user!.role === 'ADMINISTRADOR';
    const sql = isAdmin
      ? `SELECT l.*, u.name AS user_name, c.name AS company_name
         FROM login_history l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN companies c ON c.code = l.company_code
         ORDER BY l.created_at DESC
         LIMIT 200`
      : `SELECT l.*, u.name AS user_name, c.name AS company_name
         FROM login_history l
         LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN companies c ON c.code = l.company_code
         WHERE l.user_id = $1
         ORDER BY l.created_at DESC
         LIMIT 100`;
    const result = isAdmin ? await db.query(sql) : await db.query(sql, [req.user!.id]);
    res.json({ items: result.rows });
  } catch (err) {
    next(err);
  }
});
