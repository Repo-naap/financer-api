import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { calculateReconciliationResult, roundMoney } from '../domain/calculations.js';
import { formatBRL, formatDateBR, formatDateTimeBR, toIsoDate } from '../domain/formatters.js';
import { assertDatePeriodOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import { getCashBalanceBeforeDate } from '../services/closingService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const reconciliationRouter = Router();

const reconciliationSchema = z
  .object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida.'),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida.'),
    checked_balance: z.coerce.number().finite().nullable().optional(),
    concluded: z.boolean().optional().default(false),
    justification: z.string().trim().max(1000).optional().default(''),
    notes: z.string().trim().max(1000).optional().default(''),
    version: z.coerce.number().int().optional(),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: 'Data final não pode ser anterior à data inicial.',
    path: ['period_end'],
  });

async function computeSystemBalancesForPeriod(
  companyCode: string,
  periodStart: string,
  periodEnd: string
) {
  const db = getDb();
  const openingBalance = await getCashBalanceBeforeDate(companyCode, periodStart, db);
  const resCash = await db.query<{ inflows: string; outflows: string }>(
    `SELECT
       COALESCE(SUM(inflow), 0)::text AS inflows,
       COALESCE(SUM(outflow), 0)::text AS outflows
     FROM cash_entries
     WHERE company_code = $1 AND entry_date >= $2::date AND entry_date <= $3::date`,
    [companyCode, periodStart, periodEnd]
  );
  const totalInflows = roundMoney(Number(resCash.rows[0]?.inflows || 0));
  const totalOutflows = roundMoney(Number(resCash.rows[0]?.outflows || 0));
  const calculatedBalance = roundMoney(openingBalance + totalInflows - totalOutflows);
  return { openingBalance, totalInflows, totalOutflows, calculatedBalance };
}

reconciliationRouter.use(requireAuth);

reconciliationRouter.get(
  '/preview',
  requirePermission('reconciliation', 'view'),
  async (req, res, next) => {
    try {
      const periodStart = String(req.query.periodStart || '');
      const periodEnd = String(req.query.periodEnd || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
        throw new HttpError(400, 'Informe periodStart e periodEnd no formato AAAA-MM-DD.');
      }
      if (periodEnd < periodStart) {
        throw new HttpError(400, 'Data final deve ser maior ou igual à data inicial.');
      }
      const balances = await computeSystemBalancesForPeriod(
        req.user!.companyCode,
        periodStart,
        periodEnd
      );
      res.json(balances);
    } catch (err) {
      next(err);
    }
  }
);

reconciliationRouter.get('/', requirePermission('reconciliation', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const conditions: string[] = ['company_code = $1'];
    const params: unknown[] = [req.user!.companyCode];

    const startDate = typeof req.query.startDate === 'string' && req.query.startDate ? req.query.startDate : '';
    const endDate = typeof req.query.endDate === 'string' && req.query.endDate ? req.query.endDate : '';
    const status =
      typeof req.query.status === 'string' && req.query.status && req.query.status !== 'ALL'
        ? req.query.status.toUpperCase()
        : '';

    if (startDate) {
      params.push(startDate);
      conditions.push(`period_end >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`period_start <= $${params.length}::date`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM reconciliations ${where} ORDER BY period_end DESC, created_at DESC`,
      params
    );

    const items = rowsRes.rows.map((r) => ({
      ...r,
      period_start: toIsoDate(r.period_start as string | Date),
      period_end: toIsoDate(r.period_end as string | Date),
      opening_balance: roundMoney(Number(r.opening_balance)),
      total_inflows: roundMoney(Number(r.total_inflows)),
      total_outflows: roundMoney(Number(r.total_outflows)),
      calculated_balance: roundMoney(Number(r.calculated_balance)),
      checked_balance: r.checked_balance !== null ? roundMoney(Number(r.checked_balance)) : null,
      difference: r.difference !== null ? roundMoney(Number(r.difference)) : null,
    }));

    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.post('/', requirePermission('reconciliation', 'create'), async (req, res, next) => {
  try {
    const body = reconciliationSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    await assertDatePeriodOpen(db, companyCode, body.period_end);

    const balances = await computeSystemBalancesForPeriod(
      companyCode,
      body.period_start,
      body.period_end
    );
    const { difference, status } = calculateReconciliationResult(
      balances.calculatedBalance,
      body.checked_balance
    );

    if (body.concluded) {
      if (status === 'PENDENTE') {
        throw new HttpError(
          400,
          'Informe o saldo efetivamente conferido antes de concluir a conciliação.'
        );
      }
      if (status === 'DIVERGENTE' && (!body.justification || body.justification.trim().length < 5)) {
        throw new HttpError(
          400,
          'Não é permitido concluir uma conciliação com diferença divergente sem informar uma justificativa detalhada.'
        );
      }
    }

    const id = crypto.randomUUID();
    const created = await db.transaction(async (tx) => {
      const ins = await tx.query<Record<string, unknown>>(
        `INSERT INTO reconciliations (
           id, company_code, period_start, period_end, opening_balance, total_inflows, total_outflows,
           calculated_balance, checked_balance, difference, status, concluded,
           justification, notes, responsible_user_id, responsible_name, checked_at,
           created_by, updated_by
         ) VALUES (
           $1, $2, $3::date, $4::date, $5, $6, $7,
           $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17,
           $15, $15
         ) RETURNING *`,
        [
          id,
          companyCode,
          body.period_start,
          body.period_end,
          balances.openingBalance,
          balances.totalInflows,
          balances.totalOutflows,
          balances.calculatedBalance,
          body.checked_balance !== undefined && body.checked_balance !== null
            ? roundMoney(body.checked_balance)
            : null,
          difference,
          status,
          body.concluded,
          body.justification,
          body.notes,
          req.user!.id,
          req.user!.name,
          body.checked_balance !== undefined && body.checked_balance !== null
            ? new Date().toISOString()
            : null,
        ]
      );
      const row = ins.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'INCLUSAO',
          module: 'Conciliação Financeira',
          recordId: id,
          newValue: row,
          description: `Conciliação de ${formatDateBR(body.period_start)} a ${formatDateBR(body.period_end)} registrada com status ${status} (diferença: ${difference !== null ? formatBRL(difference) : 'N/A'}).`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.status(201).json({
      ...created,
      period_start: toIsoDate(created.period_start as string | Date),
      period_end: toIsoDate(created.period_end as string | Date),
      opening_balance: roundMoney(Number(created.opening_balance)),
      total_inflows: roundMoney(Number(created.total_inflows)),
      total_outflows: roundMoney(Number(created.total_outflows)),
      calculated_balance: roundMoney(Number(created.calculated_balance)),
      checked_balance: created.checked_balance !== null ? roundMoney(Number(created.checked_balance)) : null,
      difference: created.difference !== null ? roundMoney(Number(created.difference)) : null,
    });
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.put('/:id', requirePermission('reconciliation', 'edit'), async (req, res, next) => {
  try {
    const body = reconciliationSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM reconciliations WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Conciliação não encontrada.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(409, 'Esta conciliação foi modificada por outro usuário.', 'CONCURRENCY_CONFLICT');
    }

    await assertDatePeriodOpen(db, companyCode, body.period_end);

    const balances = await computeSystemBalancesForPeriod(
      companyCode,
      body.period_start,
      body.period_end
    );
    const { difference, status } = calculateReconciliationResult(
      balances.calculatedBalance,
      body.checked_balance
    );

    if (body.concluded) {
      if (status === 'PENDENTE') {
        throw new HttpError(400, 'Informe o saldo conferido antes de concluir a conciliação.');
      }
      if (status === 'DIVERGENTE' && (!body.justification || body.justification.trim().length < 5)) {
        throw new HttpError(
          400,
          'Não é permitido concluir uma conciliação divergente sem justificativa detalhada.'
        );
      }
    }

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE reconciliations SET
           period_start = $1::date,
           period_end = $2::date,
           opening_balance = $3,
           total_inflows = $4,
           total_outflows = $5,
           calculated_balance = $6,
           checked_balance = $7,
           difference = $8,
           status = $9,
           concluded = $10,
           justification = $11,
           notes = $12,
           responsible_user_id = $13,
           responsible_name = $14,
           checked_at = $15,
           updated_by = $13,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $16 AND company_code = $17
         RETURNING *`,
        [
          body.period_start,
          body.period_end,
          balances.openingBalance,
          balances.totalInflows,
          balances.totalOutflows,
          balances.calculatedBalance,
          body.checked_balance !== undefined && body.checked_balance !== null
            ? roundMoney(body.checked_balance)
            : null,
          difference,
          status,
          body.concluded,
          body.justification,
          body.notes,
          req.user!.id,
          req.user!.name,
          body.checked_balance !== undefined && body.checked_balance !== null
            ? new Date().toISOString()
            : null,
          req.params.id,
          companyCode,
        ]
      );
      const row = upd.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Conciliação Financeira',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: row,
          description: `Conciliação atualizada para status ${status} (concluída: ${body.concluded ? 'Sim' : 'Não'}).`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.json({
      ...updated,
      period_start: toIsoDate(updated.period_start as string | Date),
      period_end: toIsoDate(updated.period_end as string | Date),
    });
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.delete(
  '/:id',
  requirePermission('reconciliation', 'delete'),
  async (req, res, next) => {
    try {
      const db = getDb();
      const companyCode = req.user!.companyCode;
      const existingRes = await db.query<Record<string, unknown>>(
        'SELECT * FROM reconciliations WHERE id = $1 AND company_code = $2',
        [req.params.id, companyCode]
      );
      const existing = existingRes.rows[0];
      if (!existing) throw new HttpError(404, 'Conciliação não encontrada.');

      await assertDatePeriodOpen(db, companyCode, existing.period_end as string | Date);

      await db.transaction(async (tx) => {
        await tx.query('DELETE FROM reconciliations WHERE id = $1 AND company_code = $2', [
          req.params.id,
          companyCode,
        ]);
        await recordAudit(
          {
            companyCode,
            userId: req.user!.id,
            userName: req.user!.name,
            operation: 'EXCLUSAO',
            module: 'Conciliação Financeira',
            recordId: String(req.params.id),
            previousValue: existing,
            description: `Conciliação de ${formatDateBR(existing.period_start as string)} a ${formatDateBR(existing.period_end as string)} excluída.`,
            ipAddress: req.clientIp,
          },
          tx
        );
      });

      res.json({ message: 'Conciliação excluída com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

reconciliationRouter.get(
  '/export',
  requirePermission('reconciliation', 'export'),
  async (req, res, next) => {
    try {
      const format = String(req.query.format || 'pdf').toLowerCase();
      const db = getDb();

      const rowsRes = await db.query<Record<string, unknown>>(
        'SELECT * FROM reconciliations WHERE company_code = $1 ORDER BY period_end DESC, created_at DESC',
        [req.user!.companyCode]
      );

      const rows = rowsRes.rows.map((r) => ({
        period: `${formatDateBR(r.period_start as string)} a ${formatDateBR(r.period_end as string)}`,
        opening_balance: roundMoney(Number(r.opening_balance)),
        total_inflows: roundMoney(Number(r.total_inflows)),
        total_outflows: roundMoney(Number(r.total_outflows)),
        calculated_balance: roundMoney(Number(r.calculated_balance)),
        checked_balance: r.checked_balance !== null ? roundMoney(Number(r.checked_balance)) : 0,
        difference: r.difference !== null ? roundMoney(Number(r.difference)) : 0,
        status: `${r.status}${r.concluded ? ' (Concluída)' : ''}`,
        responsible_name: String(r.responsible_name || '-'),
        checked_at: r.checked_at ? formatDateTimeBR(r.checked_at as string) : '-',
        notes: [r.justification, r.notes].filter(Boolean).join(' | ') || '-',
      }));

      const payload: ReportExportPayload = {
        officeName: req.user!.companyName,
        theme: req.user!.companyTheme,
        title: `Relatório de Conciliação Financeira – ${req.user!.companyName}`,
        periodLabel: 'Todas as conciliações registradas',
        generatedBy: req.user!.name,
        landscape: true,
        columns: [
          { key: 'period', header: 'Período', width: 17, type: 'text' },
          { key: 'opening_balance', header: 'Saldo Inicial', width: 11, type: 'currency' },
          { key: 'total_inflows', header: 'Entradas', width: 11, type: 'currency' },
          { key: 'total_outflows', header: 'Saídas', width: 11, type: 'currency' },
          { key: 'calculated_balance', header: 'Saldo Calc.', width: 11, type: 'currency' },
          { key: 'checked_balance', header: 'Saldo Conf.', width: 11, type: 'currency' },
          { key: 'difference', header: 'Diferença', width: 10, type: 'currency' },
          { key: 'status', header: 'Situação', width: 12, type: 'text' },
          { key: 'responsible_name', header: 'Responsável', width: 12, type: 'text' },
          { key: 'checked_at', header: 'Data Conf.', width: 13, type: 'text' },
          { key: 'notes', header: 'Justificativa / Obs.', width: 18, type: 'text' },
        ],
        rows,
        summaryItems: [
          { label: 'Total de Conciliações', value: rows.length },
          {
            label: 'Conciliadas',
            value: rowsRes.rows.filter((r) => r.status === 'CONCILIADO').length,
          },
          {
            label: 'Divergentes',
            value: rowsRes.rows.filter((r) => r.status === 'DIVERGENTE').length,
          },
          {
            label: 'Pendentes',
            value: rowsRes.rows.filter((r) => r.status === 'PENDENTE').length,
          },
        ],
      };

      if (format === 'xlsx') {
        const buf = await generateExcelBuffer(payload);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', 'attachment; filename="financer-conciliacao.xlsx"');
        res.send(buf);
        return;
      }

      const buf = await generatePdfBuffer(payload);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="financer-conciliacao.pdf"');
      res.send(buf);
    } catch (err) {
      next(err);
    }
  }
);
