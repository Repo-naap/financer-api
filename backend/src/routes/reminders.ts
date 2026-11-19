import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  computeReminderAlertSituation,
  generateMonthlyCompetences,
  REMINDER_ACCOUNTS,
  REMINDER_DIGITS,
  roundMoney,
} from '../domain/calculations.js';
import {
  formatBRL,
  formatCompetenceBR,
  formatDateBR,
  getTodayIsoBR,
  toIsoDate,
} from '../domain/formatters.js';
import { assertYearMonthOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  generateWordBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const remindersRouter = Router();

const createReminderSchema = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida.'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida.'),
    description: z.string().trim().min(2, 'Informe a descrição da obrigação.').max(255),
    amount: z.coerce.number().min(0.01, 'Valor deve ser maior que zero.'),
    account: z.enum(REMINDER_ACCOUNTS, {
      errorMap: () => ({ message: 'Conta inválida para esta empresa.' }),
    }),
    digit: z.enum(REMINDER_DIGITS, {
      errorMap: () => ({ message: 'Dígito deve ser 09, 10 ou PF.' }),
    }),
    notes: z.string().trim().max(1000).optional().default(''),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: 'Data final deve ser igual ou posterior à data inicial.',
    path: ['end_date'],
  });

const updateReminderSchema = z.object({
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida.').optional(),
  description: z.string().trim().min(2).max(255).optional(),
  amount: z.coerce.number().min(0.01).optional(),
  account: z.enum(REMINDER_ACCOUNTS).optional(),
  digit: z.enum(REMINDER_DIGITS).optional(),
  notes: z.string().trim().max(1000).optional(),
  scope: z.enum(['SINGLE', 'FUTURE']).optional().default('SINGLE'),
  version: z.coerce.number().int().optional(),
});

const paySchema = z.object({
  paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data efetiva do pagamento.'),
  notes: z.string().trim().max(1000).optional(),
});

function buildReminderFilterSql(companyCode: string, query: Record<string, unknown>) {
  const conditions: string[] = ['r.company_code = $1'];
  const params: unknown[] = [companyCode];

  const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : '';
  const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : '';
  const description =
    typeof query.description === 'string' && query.description.trim()
      ? query.description.trim()
      : '';
  const account =
    typeof query.account === 'string' && query.account && query.account !== 'ALL'
      ? query.account
      : '';
  const digit =
    typeof query.digit === 'string' && query.digit && query.digit !== 'ALL' ? query.digit : '';
  const status =
    typeof query.status === 'string' && query.status && query.status !== 'ALL'
      ? query.status.toUpperCase()
      : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  if (startDate) {
    params.push(startDate);
    conditions.push(`r.due_date >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`r.due_date <= $${params.length}::date`);
  }
  if (description) {
    params.push(`%${description}%`);
    conditions.push(`r.description ILIKE $${params.length}`);
  }
  if (account) {
    params.push(account);
    conditions.push(`r.account = $${params.length}`);
  }
  if (digit) {
    params.push(digit);
    conditions.push(`r.digit = $${params.length}`);
  }
  if (status === 'PAGA' || status === 'PENDENTE' || status === 'SUSPENSA') {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(r.description ILIKE $${params.length} OR r.account ILIKE $${params.length} OR r.digit ILIKE $${params.length} OR COALESCE(r.notes, '') ILIKE $${params.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
    startDate,
    endDate,
    description,
    account,
    digit,
    status,
  };
}

remindersRouter.use(requireAuth);

remindersRouter.get('/', requirePermission('reminders', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const { whereClause, params } = buildReminderFilterSql(
      companyCode,
      req.query as Record<string, unknown>
    );
    const alertFilter =
      typeof req.query.alertStatus === 'string' && req.query.alertStatus !== 'ALL'
        ? req.query.alertStatus.toUpperCase()
        : '';

    const cfgRes = await db.query<{ due_alert_days: number }>(
      'SELECT due_alert_days FROM companies WHERE code = $1',
      [companyCode]
    );
    const alertDays = Number(cfgRes.rows[0]?.due_alert_days ?? 5);
    const todayIso = getTodayIsoBR();

    const sortMap: Record<string, string> = {
      due_date: 'r.due_date',
      description: 'r.description',
      amount: 'r.amount',
      account: 'r.account',
      digit: 'r.digit',
      status: 'r.status',
    };
    const sortBy = sortMap[String(req.query.sortBy || 'due_date')] || 'r.due_date';
    const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT r.*, s.start_date AS series_start_date, s.end_date AS series_end_date, s.suspended AS series_suspended
       FROM reminders r
       LEFT JOIN reminder_series s ON s.id = r.series_id
       ${whereClause}
       ORDER BY ${sortBy} ${sortDir}, r.description ASC`,
      params
    );

    let enriched: Array<
      Record<string, unknown> & {
        amount: number;
        alert_status: string;
        status: string;
        description: string;
        account: string;
        digit: string;
      }
    > = rowsRes.rows.map((r) => {
      const dueDate = toIsoDate(r.due_date as string | Date);
      const situation = computeReminderAlertSituation(
        String(r.status),
        dueDate,
        todayIso,
        alertDays
      );
      return {
        ...r,
        status: String(r.status),
        description: String(r.description),
        account: String(r.account),
        digit: String(r.digit),
        due_date: dueDate,
        paid_date: r.paid_date ? toIsoDate(r.paid_date as string | Date) : null,
        competence: formatCompetenceBR(Number(r.competence_year), Number(r.competence_month)),
        amount: roundMoney(Number(r.amount)),
        alert_status: situation,
      };
    });

    if (alertFilter) {
      enriched = enriched.filter((i) => i.alert_status === alertFilter);
    }

    const byDescMap = new Map<
      string,
      {
        description: string;
        account: string;
        digit: string;
        count: number;
        totalAmount: number;
        paidAmount: number;
        pendingAmount: number;
      }
    >();
    let totalAmount = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let overdueCount = 0;
    let dueSoonCount = 0;

    for (const item of enriched) {
      totalAmount = roundMoney(totalAmount + item.amount);
      if (item.status === 'PAGA') totalPaid = roundMoney(totalPaid + item.amount);
      if (item.status === 'PENDENTE') totalPending = roundMoney(totalPending + item.amount);
      if (item.alert_status === 'VENCIDA') overdueCount += 1;
      if (item.alert_status === 'PROXIMO_VENCIMENTO') dueSoonCount += 1;

      const key = `${item.description.toLowerCase()}|${item.account}|${item.digit}`;
      const existing = byDescMap.get(key) || {
        description: item.description,
        account: item.account,
        digit: item.digit,
        count: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
      };
      existing.count += 1;
      existing.totalAmount = roundMoney(existing.totalAmount + item.amount);
      if (item.status === 'PAGA') existing.paidAmount = roundMoney(existing.paidAmount + item.amount);
      if (item.status === 'PENDENTE')
        existing.pendingAmount = roundMoney(existing.pendingAmount + item.amount);
      byDescMap.set(key, existing);
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    res.json({
      items: enriched.slice(offset, offset + pageSize),
      total: enriched.length,
      page,
      pageSize,
      summary: {
        count: enriched.length,
        totalAmount,
        totalPaid,
        totalPending,
        overdueCount,
        dueSoonCount,
        byDescription: Array.from(byDescMap.values()),
      },
    });
  } catch (err) {
    next(err);
  }
});

remindersRouter.post('/', requirePermission('reminders', 'create'), async (req, res, next) => {
  try {
    const body = createReminderSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const competences = generateMonthlyCompetences(body.start_date, body.end_date);
    if (competences.length === 0) {
      throw new HttpError(400, 'Nenhuma competência mensal encontrada no intervalo informado.');
    }

    for (const c of competences) {
      await assertYearMonthOpen(db, companyCode, c.year, c.month);
      const dup = await db.query<{ id: string }>(
        `SELECT id FROM reminders
         WHERE company_code = $1
           AND LOWER(TRIM(description)) = LOWER(TRIM($2))
           AND account = $3
           AND digit = $4
           AND competence_year = $5
           AND competence_month = $6
         LIMIT 1`,
        [companyCode, body.description, body.account, body.digit, c.year, c.month]
      );
      if (dup.rows[0]) {
        throw new HttpError(
          409,
          `Já existe uma obrigação "${body.description}" (${body.account} - Dígito ${body.digit}) cadastrada na competência ${formatCompetenceBR(c.year, c.month)}. Geração de contas duplicadas não é permitida.`
        );
      }
    }

    const seriesId = crypto.randomUUID();
    const createdRows = await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO reminder_series (
           id, company_code, description, start_date, end_date, default_amount, account, digit, notes, created_by
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10)`,
        [
          seriesId,
          companyCode,
          body.description,
          body.start_date,
          body.end_date,
          roundMoney(body.amount),
          body.account,
          body.digit,
          body.notes,
          req.user!.id,
        ]
      );

      const inserted: Array<Record<string, unknown>> = [];
      for (const c of competences) {
        const id = crypto.randomUUID();
        const r = await tx.query<Record<string, unknown>>(
          `INSERT INTO reminders (
             id, company_code, series_id, competence_year, competence_month, due_date,
             description, amount, account, digit, status, notes, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, 'PENDENTE', $11, $12, $12)
           RETURNING *`,
          [
            id,
            companyCode,
            seriesId,
            c.year,
            c.month,
            c.dueDate,
            body.description,
            roundMoney(body.amount),
            body.account,
            body.digit,
            body.notes,
            req.user!.id,
          ]
        );
        inserted.push(r.rows[0]);
      }

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'INCLUSAO',
          module: 'Lembretes',
          recordId: seriesId,
          newValue: {
            description: body.description,
            account: body.account,
            digit: body.digit,
            amount: roundMoney(body.amount),
            occurrencesCreated: inserted.length,
            startDate: body.start_date,
            endDate: body.end_date,
          },
          description: `Obrigação recorrente "${body.description}" (${body.account}/${body.digit}) criada com ${inserted.length} lançamento(s) mensal(is) de ${formatBRL(body.amount)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return inserted;
    });

    res.status(201).json({
      seriesId,
      createdCount: createdRows.length,
      items: createdRows.map((r) => ({
        ...r,
        due_date: toIsoDate(r.due_date as string | Date),
        amount: roundMoney(Number(r.amount)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

remindersRouter.put('/:id', requirePermission('reminders', 'edit'), async (req, res, next) => {
  try {
    const body = updateReminderSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Lembrete não encontrado.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(
        409,
        'Este lembrete foi alterado por outro usuário. Atualize antes de salvar.',
        'CONCURRENCY_CONFLICT'
      );
    }

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );

    const newDescription = body.description ?? String(existing.description);
    const newAmount = body.amount !== undefined ? roundMoney(body.amount) : roundMoney(Number(existing.amount));
    const newAccount = body.account ?? String(existing.account);
    const newDigit = body.digit ?? String(existing.digit);
    const newNotes = body.notes !== undefined ? body.notes : String(existing.notes || '');
    const newDueDate = body.due_date ?? toIsoDate(existing.due_date as string | Date);

    const updatedCount = await db.transaction(async (tx) => {
      if (body.scope === 'FUTURE' && existing.series_id) {
        const targets = await tx.query<Record<string, unknown>>(
          `SELECT * FROM reminders
           WHERE company_code = $1
             AND series_id = $2
             AND (competence_year > $3 OR (competence_year = $3 AND competence_month >= $4))
             AND status <> 'PAGA'`,
          [companyCode, existing.series_id, existing.competence_year, existing.competence_month]
        );

        for (const t of targets.rows) {
          await assertYearMonthOpen(
            tx,
            companyCode,
            Number(t.competence_year),
            Number(t.competence_month)
          );
          await tx.query(
            `UPDATE reminders SET
               description = $1,
               amount = $2,
               account = $3,
               digit = $4,
               notes = $5,
               updated_by = $6,
               updated_at = NOW(),
               version = version + 1
             WHERE id = $7 AND company_code = $8`,
            [newDescription, newAmount, newAccount, newDigit, newNotes, req.user!.id, t.id, companyCode]
          );
        }

        await tx.query(
          `UPDATE reminder_series SET
             description = $1, default_amount = $2, account = $3, digit = $4, notes = $5, updated_at = NOW(), version = version + 1
           WHERE id = $6 AND company_code = $7`,
          [newDescription, newAmount, newAccount, newDigit, newNotes, existing.series_id, companyCode]
        );

        await recordAudit(
          {
            companyCode,
            userId: req.user!.id,
            userName: req.user!.name,
            operation: 'EDICAO',
            module: 'Lembretes',
            recordId: String(existing.series_id),
            previousValue: existing,
            newValue: {
              scope: 'FUTURE',
              updatedCount: targets.rows.length,
              description: newDescription,
              amount: newAmount,
              account: newAccount,
              digit: newDigit,
            },
            description: `Alteradas ${targets.rows.length} ocorrência(s) futura(s) de "${newDescription}" para ${formatBRL(newAmount)}.`,
            ipAddress: req.clientIp,
          },
          tx
        );

        return targets.rows.length;
      }

      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE reminders SET
           due_date = $1::date,
           description = $2,
           amount = $3,
           account = $4,
           digit = $5,
           notes = $6,
           updated_by = $7,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $8 AND company_code = $9
         RETURNING *`,
        [
          newDueDate,
          newDescription,
          newAmount,
          newAccount,
          newDigit,
          newNotes,
          req.user!.id,
          req.params.id,
          companyCode,
        ]
      );

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Lembretes',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: upd.rows[0],
          description: `Ocorrência de "${newDescription}" (${formatCompetenceBR(Number(existing.competence_year), Number(existing.competence_month))}) atualizada.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return 1;
    });

    res.json({ message: 'Obrigação atualizada com sucesso.', updatedCount });
  } catch (err) {
    next(err);
  }
});

remindersRouter.post('/:id/pay', requirePermission('reminders', 'edit'), async (req, res, next) => {
  try {
    const body = paySchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Lembrete não encontrado.');

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE reminders SET
           status = 'PAGA',
           paid_date = $1::date,
           notes = COALESCE($2, notes),
           updated_by = $3,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $4 AND company_code = $5
         RETURNING *`,
        [body.paid_date, body.notes ?? null, req.user!.id, req.params.id, companyCode]
      );

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Lembretes',
          recordId: String(req.params.id),
          previousValue: { status: existing.status, paid_date: existing.paid_date },
          newValue: { status: 'PAGA', paid_date: body.paid_date },
          description: `Conta "${existing.description}" (${formatCompetenceBR(Number(existing.competence_year), Number(existing.competence_month))}) marcada como PAGA em ${formatDateBR(body.paid_date)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return upd.rows[0];
    });

    res.json({
      ...updated,
      due_date: toIsoDate(updated.due_date as string | Date),
      paid_date: toIsoDate(updated.paid_date as string | Date),
      amount: roundMoney(Number(updated.amount)),
    });
  } catch (err) {
    next(err);
  }
});

remindersRouter.post('/:id/unpay', requirePermission('reminders', 'edit'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Lembrete não encontrado.');

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE reminders SET status = 'PENDENTE', paid_date = NULL, updated_by = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND company_code = $3`,
        [req.user!.id, req.params.id, companyCode]
      );
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Lembretes',
          recordId: String(req.params.id),
          previousValue: { status: existing.status, paid_date: existing.paid_date },
          newValue: { status: 'PENDENTE', paid_date: null },
          description: `Pagamento da conta "${existing.description}" estornado para PENDENTE.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Conta retornada para status PENDENTE.' });
  } catch (err) {
    next(err);
  }
});

remindersRouter.post(
  '/:id/suspend',
  requirePermission('reminders', 'edit'),
  async (req, res, next) => {
    try {
      const scope = String(req.body?.scope || 'FUTURE').toUpperCase();
      const reactivate = Boolean(req.body?.reactivate);
      const db = getDb();
      const companyCode = req.user!.companyCode;

      const existingRes = await db.query<Record<string, unknown>>(
        'SELECT * FROM reminders WHERE id = $1 AND company_code = $2',
        [req.params.id, companyCode]
      );
      const existing = existingRes.rows[0];
      if (!existing) throw new HttpError(404, 'Lembrete não encontrado.');

      const targetStatus = reactivate ? 'PENDENTE' : 'SUSPENSA';

      await db.transaction(async (tx) => {
        if (scope === 'FUTURE' && existing.series_id) {
          await tx.query(
            `UPDATE reminders SET status = $1, updated_by = $2, updated_at = NOW(), version = version + 1
             WHERE company_code = $3
               AND series_id = $4
               AND (competence_year > $5 OR (competence_year = $5 AND competence_month >= $6))
               AND status <> 'PAGA'`,
            [
              targetStatus,
              req.user!.id,
              companyCode,
              existing.series_id,
              existing.competence_year,
              existing.competence_month,
            ]
          );
          await tx.query(
            'UPDATE reminder_series SET suspended = $1, updated_at = NOW() WHERE id = $2 AND company_code = $3',
            [!reactivate, existing.series_id, companyCode]
          );
        } else {
          await assertYearMonthOpen(
            tx,
            companyCode,
            Number(existing.competence_year),
            Number(existing.competence_month)
          );
          await tx.query(
            `UPDATE reminders SET status = $1, updated_by = $2, updated_at = NOW(), version = version + 1 WHERE id = $3 AND company_code = $4`,
            [targetStatus, req.user!.id, req.params.id, companyCode]
          );
        }

        await recordAudit(
          {
            companyCode,
            userId: req.user!.id,
            userName: req.user!.name,
            operation: reactivate ? 'EDICAO' : 'CANCELAMENTO',
            module: 'Lembretes',
            recordId: String(req.params.id),
            previousValue: { status: existing.status },
            newValue: { status: targetStatus, scope },
            description: `Recorrência "${existing.description}" ${reactivate ? 'reativada' : 'suspensa'} (escopo: ${scope}).`,
            ipAddress: req.clientIp,
          },
          tx
        );
      });

      res.json({
        message: reactivate ? 'Obrigação reativada com sucesso.' : 'Recorrência suspensa com sucesso.',
      });
    } catch (err) {
      next(err);
    }
  }
);

remindersRouter.delete('/:id', requirePermission('reminders', 'delete'), async (req, res, next) => {
  try {
    const scope = String(req.query.scope || 'SINGLE').toUpperCase();
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM reminders WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Lembrete não encontrado.');

    await db.transaction(async (tx) => {
      if (scope === 'SERIES' && existing.series_id) {
        const allInSeries = await tx.query<Record<string, unknown>>(
          'SELECT * FROM reminders WHERE series_id = $1 AND company_code = $2',
          [existing.series_id, companyCode]
        );
        for (const r of allInSeries.rows) {
          await assertYearMonthOpen(
            tx,
            companyCode,
            Number(r.competence_year),
            Number(r.competence_month)
          );
        }
        await tx.query('DELETE FROM reminder_series WHERE id = $1 AND company_code = $2', [
          existing.series_id,
          companyCode,
        ]);
        await recordAudit(
          {
            companyCode,
            userId: req.user!.id,
            userName: req.user!.name,
            operation: 'EXCLUSAO',
            module: 'Lembretes',
            recordId: String(existing.series_id),
            previousValue: { description: existing.description, deletedCount: allInSeries.rows.length },
            description: `Série completa da obrigação "${existing.description}" excluída (${allInSeries.rows.length} ocorrências).`,
            ipAddress: req.clientIp,
          },
          tx
        );
      } else {
        await assertYearMonthOpen(
          tx,
          companyCode,
          Number(existing.competence_year),
          Number(existing.competence_month)
        );
        await tx.query('DELETE FROM reminders WHERE id = $1 AND company_code = $2', [
          req.params.id,
          companyCode,
        ]);
        await recordAudit(
          {
            companyCode,
            userId: req.user!.id,
            userName: req.user!.name,
            operation: 'EXCLUSAO',
            module: 'Lembretes',
            recordId: String(req.params.id),
            previousValue: existing,
            description: `Ocorrência de "${existing.description}" (${formatCompetenceBR(Number(existing.competence_year), Number(existing.competence_month))}) excluída.`,
            ipAddress: req.clientIp,
          },
          tx
        );
      }
    });

    res.json({ message: 'Obrigação excluída com sucesso.' });
  } catch (err) {
    next(err);
  }
});

remindersRouter.get('/export', requirePermission('reminders', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const { whereClause, params, startDate, endDate, description, account, digit, status } =
      buildReminderFilterSql(companyCode, req.query as Record<string, unknown>);

    const cfgRes = await db.query<{ due_alert_days: number }>(
      'SELECT due_alert_days FROM companies WHERE code = $1',
      [companyCode]
    );
    const alertDays = Number(cfgRes.rows[0]?.due_alert_days ?? 5);
    const todayIso = getTodayIsoBR();

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM reminders r ${whereClause} ORDER BY r.description ASC, r.account ASC, r.digit ASC, r.due_date ASC`,
      params
    );

    const byDesc = new Map<string, { desc: string; account: string; digit: string; count: number; total: number }>();
    let grandTotal = 0;
    let totalPaid = 0;
    let totalPending = 0;

    const rows = rowsRes.rows.map((r) => {
      const amount = roundMoney(Number(r.amount));
      const dueIso = toIsoDate(r.due_date as string | Date);
      const sit = computeReminderAlertSituation(String(r.status), dueIso, todayIso, alertDays);
      grandTotal = roundMoney(grandTotal + amount);
      if (r.status === 'PAGA') totalPaid = roundMoney(totalPaid + amount);
      if (r.status === 'PENDENTE') totalPending = roundMoney(totalPending + amount);

      const k = `${r.description}|${r.account}|${r.digit}`;
      const e = byDesc.get(k) || {
        desc: String(r.description),
        account: String(r.account),
        digit: String(r.digit),
        count: 0,
        total: 0,
      };
      e.count += 1;
      e.total = roundMoney(e.total + amount);
      byDesc.set(k, e);

      return {
        description: String(r.description),
        amount,
        account: String(r.account),
        digit: String(r.digit),
        competence: formatCompetenceBR(Number(r.competence_year), Number(r.competence_month)),
        due_date: formatDateBR(dueIso),
        situation: sit === 'PROXIMO_VENCIMENTO' ? 'Próximo do vencimento' : sit,
        paid_date: r.paid_date ? formatDateBR(r.paid_date as string | Date) : '-',
      };
    });

    const filters: string[] = [];
    if (description) filters.push(`Descrição: ${description}`);
    if (account) filters.push(`Conta: ${account}`);
    if (digit) filters.push(`Dígito: ${digit}`);
    if (status) filters.push(`Situação: ${status}`);

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Lembretes e Obrigações – ${req.user!.companyName}`,
      periodLabel:
        startDate || endDate
          ? `${startDate ? formatDateBR(startDate) : 'Início'} a ${endDate ? formatDateBR(endDate) : 'Atual'}`
          : 'Todas as competências',
      generatedBy: req.user!.name,
      filtersSummary: filters.join(' | ') || 'Todas as obrigações',
      landscape: true,
      columns: [
        { key: 'description', header: 'Descrição', width: 24, type: 'text' },
        { key: 'amount', header: 'Valor Mensal', width: 13, type: 'currency' },
        { key: 'account', header: 'Conta', width: 13, type: 'text' },
        { key: 'digit', header: 'Dígito', width: 8, type: 'text' },
        { key: 'competence', header: 'Competência', width: 11, type: 'text' },
        { key: 'due_date', header: 'Vencimento', width: 11, type: 'date' },
        { key: 'situation', header: 'Situação', width: 15, type: 'text' },
        { key: 'paid_date', header: 'Dt. Pagamento', width: 11, type: 'date' },
      ],
      rows,
      subtotalSections: [
        {
          title: 'Total por Descrição, Conta e Dígito',
          headers: ['Descrição', 'Conta', 'Dígito', 'Ocorrências', 'Total'],
          rows: Array.from(byDesc.values()).map((d) => [
            d.desc,
            d.account,
            d.digit,
            d.count,
            formatBRL(d.total),
          ]),
        },
      ],
      summaryItems: [
        { label: 'Total de Obrigações Listadas', value: rows.length },
        { label: 'Total Geral das Obrigações', value: grandTotal, isCurrency: true },
        { label: 'Total Pago', value: totalPaid, isCurrency: true },
        { label: 'Total Pendente', value: totalPending, isCurrency: true },
      ],
    };

    if (format === 'xlsx') {
      const buf = await generateExcelBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-lembretes.xlsx"');
      res.send(buf);
      return;
    }

    if (format === 'docx') {
      const buf = await generateWordBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-lembretes.docx"');
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financer-lembretes.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
