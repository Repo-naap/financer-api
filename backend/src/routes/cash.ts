import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  calculateCashRunningBalances,
  roundMoney,
  validateCashMovement,
} from '../domain/calculations.js';
import { formatBRL, formatDateBR, toIsoDate } from '../domain/formatters.js';
import { assertDatePeriodOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import { getCashBalanceBeforeDate, getMonthDateBounds } from '../services/closingService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  generateWordBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const cashRouter = Router();

const cashEntrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data da movimentação inválida.'),
  destination: z.string().trim().min(2, 'Informe o destino ou responsável.').max(200),
  purpose: z.string().trim().min(2, 'Informe a finalidade da movimentação.').max(300),
  inflow: z.coerce.number().min(0, 'Valor de entrada não pode ser negativo.').optional().default(0),
  outflow: z.coerce.number().min(0, 'Valor de saída não pode ser negativo.').optional().default(0),
  notes: z.string().trim().max(1000).optional().default(''),
  version: z.coerce.number().int().optional(),
});

function resolveCashPeriod(query: Record<string, unknown>): {
  startDate: string;
  endDate: string;
  periodLabel: string;
} {
  const mode = String(query.reportMode || '').toUpperCase();
  const year = Number(query.year || 0);
  const month = Number(query.month || 0);

  if (mode === 'MENSAL' && year >= 2000 && month >= 1 && month <= 12) {
    const { start, end } = getMonthDateBounds(year, month);
    return {
      startDate: start,
      endDate: end,
      periodLabel: `Mensal (${String(month).padStart(2, '0')}/${year})`,
    };
  }

  if (mode === 'ANUAL' && year >= 2000) {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      periodLabel: `Anual (${year})`,
    };
  }

  const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : '';
  const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : '';
  const periodLabel =
    startDate || endDate
      ? `${startDate ? formatDateBR(startDate) : 'Início'} a ${endDate ? formatDateBR(endDate) : 'Atual'}`
      : 'Todo o período registrado';

  return { startDate, endDate, periodLabel };
}

async function queryCashWithRunningBalance(companyCode: string, query: Record<string, unknown>) {
  const db = getDb();
  const { startDate, endDate, periodLabel } = resolveCashPeriod(query);

  const destination =
    typeof query.destination === 'string' && query.destination.trim()
      ? query.destination.trim()
      : '';
  const purpose =
    typeof query.purpose === 'string' && query.purpose.trim() ? query.purpose.trim() : '';
  const entryType =
    typeof query.entryType === 'string' && query.entryType && query.entryType !== 'ALL'
      ? query.entryType.toUpperCase()
      : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  let openingBalance = 0;
  if (startDate) {
    openingBalance = await getCashBalanceBeforeDate(companyCode, startDate, db);
  } else {
    const cfg = await db.query<{ initial_cash_balance: string }>(
      'SELECT initial_cash_balance FROM companies WHERE code = $1',
      [companyCode]
    );
    openingBalance = roundMoney(Number(cfg.rows[0]?.initial_cash_balance || 0));
  }

  const dateConditions: string[] = ['c.company_code = $1'];
  const dateParams: unknown[] = [companyCode];
  if (startDate) {
    dateParams.push(startDate);
    dateConditions.push(`c.entry_date >= $${dateParams.length}::date`);
  }
  if (endDate) {
    dateParams.push(endDate);
    dateConditions.push(`c.entry_date <= $${dateParams.length}::date`);
  }
  const dateWhere = `WHERE ${dateConditions.join(' AND ')}`;

  const rowsRes = await db.query<Record<string, unknown>>(
    `SELECT c.*, u.name AS created_by_name
     FROM cash_entries c
     LEFT JOIN users u ON u.id = c.created_by
     ${dateWhere}
     ORDER BY c.entry_date ASC, c.created_at ASC`,
    dateParams
  );

  const normalized = rowsRes.rows.map((r) => ({
    ...r,
    entry_date: toIsoDate(r.entry_date as string | Date),
    inflow: roundMoney(Number(r.inflow)),
    outflow: roundMoney(Number(r.outflow)),
  }));

  const calc = calculateCashRunningBalances(openingBalance, normalized);

  let filteredItems = calc.items;
  if (destination) {
    const d = destination.toLowerCase();
    filteredItems = filteredItems.filter((i) =>
      String((i as Record<string, unknown>).destination || '').toLowerCase().includes(d)
    );
  }
  if (purpose) {
    const p = purpose.toLowerCase();
    filteredItems = filteredItems.filter((i) =>
      String((i as Record<string, unknown>).purpose || '').toLowerCase().includes(p)
    );
  }
  if (entryType === 'ENTRADA' || entryType === 'SAIDA') {
    filteredItems = filteredItems.filter(
      (i) => (i as Record<string, unknown>).entry_type === entryType
    );
  }
  if (search) {
    const s = search.toLowerCase();
    filteredItems = filteredItems.filter(
      (i) =>
        String((i as Record<string, unknown>).destination || '').toLowerCase().includes(s) ||
        String((i as Record<string, unknown>).purpose || '').toLowerCase().includes(s) ||
        String((i as Record<string, unknown>).notes || '').toLowerCase().includes(s)
    );
  }

  const filteredInflows = roundMoney(filteredItems.reduce((acc, i) => acc + i.inflow, 0));
  const filteredOutflows = roundMoney(filteredItems.reduce((acc, i) => acc + i.outflow, 0));
  const hasSecondaryFilters = Boolean(destination || purpose || entryType || search);

  return {
    items: filteredItems,
    periodLabel,
    startDate,
    endDate,
    destination,
    purpose,
    entryType,
    summary: {
      count: filteredItems.length,
      openingBalance: calc.openingBalance,
      totalInflows: hasSecondaryFilters ? filteredInflows : calc.totalInflows,
      totalOutflows: hasSecondaryFilters ? filteredOutflows : calc.totalOutflows,
      closingBalance: hasSecondaryFilters
        ? roundMoney(calc.openingBalance + filteredInflows - filteredOutflows)
        : calc.closingBalance,
      periodClosingBalance: calc.closingBalance,
    },
  };
}

cashRouter.use(requireAuth);

cashRouter.get('/', requirePermission('cash', 'view'), async (req, res, next) => {
  try {
    const data = await queryCashWithRunningBalance(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );
    const sortDir = String(req.query.sortDir || 'asc').toLowerCase();
    const list = sortDir === 'desc' ? [...data.items].reverse() : data.items;

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    res.json({
      items: list.slice(offset, offset + pageSize),
      total: list.length,
      page,
      pageSize,
      periodLabel: data.periodLabel,
      summary: data.summary,
    });
  } catch (err) {
    next(err);
  }
});

cashRouter.post('/', requirePermission('cash', 'create'), async (req, res, next) => {
  try {
    const body = cashEntrySchema.parse(req.body);
    const movement = validateCashMovement(body.inflow, body.outflow);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    await assertDatePeriodOpen(db, companyCode, body.entry_date);

    const dup = await db.query<{ id: string }>(
      `SELECT id FROM cash_entries
       WHERE company_code = $1
         AND entry_date = $2::date
         AND LOWER(TRIM(destination)) = LOWER(TRIM($3))
         AND LOWER(TRIM(purpose)) = LOWER(TRIM($4))
         AND entry_type = $5
         AND inflow = $6
         AND outflow = $7
       LIMIT 1`,
      [
        companyCode,
        body.entry_date,
        body.destination,
        body.purpose,
        movement.entryType,
        movement.inflow,
        movement.outflow,
      ]
    );
    if (dup.rows[0]) {
      throw new HttpError(
        409,
        'Já existe uma movimentação idêntica no caixa desta empresa para esta data, destino, finalidade e valor.'
      );
    }

    const id = crypto.randomUUID();
    const created = await db.transaction(async (tx) => {
      const ins = await tx.query<Record<string, unknown>>(
        `INSERT INTO cash_entries (
           id, company_code, entry_date, destination, purpose, entry_type, inflow, outflow, notes, created_by, updated_by
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`,
        [
          id,
          companyCode,
          body.entry_date,
          body.destination,
          body.purpose,
          movement.entryType,
          movement.inflow,
          movement.outflow,
          body.notes,
          req.user!.id,
        ]
      );
      const row = ins.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'INCLUSAO',
          module: 'Caixa',
          recordId: id,
          newValue: row,
          description: `${movement.entryType === 'ENTRADA' ? 'Entrada' : 'Saída'} no caixa de ${formatBRL(
            movement.entryType === 'ENTRADA' ? movement.inflow : movement.outflow
          )} - ${body.destination} (${body.purpose}).`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.status(201).json({
      ...created,
      entry_date: toIsoDate(created.entry_date as string | Date),
      inflow: roundMoney(Number(created.inflow)),
      outflow: roundMoney(Number(created.outflow)),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('simultaneamente')) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  }
});

cashRouter.put('/:id', requirePermission('cash', 'edit'), async (req, res, next) => {
  try {
    const body = cashEntrySchema.parse(req.body);
    const movement = validateCashMovement(body.inflow, body.outflow);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM cash_entries WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Movimentação de caixa não encontrada.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(
        409,
        'Esta movimentação foi alterada por outro usuário. Atualize antes de salvar.',
        'CONCURRENCY_CONFLICT'
      );
    }

    await assertDatePeriodOpen(db, companyCode, existing.entry_date as string | Date);
    await assertDatePeriodOpen(db, companyCode, body.entry_date);

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE cash_entries SET
           entry_date = $1::date,
           destination = $2,
           purpose = $3,
           entry_type = $4,
           inflow = $5,
           outflow = $6,
           notes = $7,
           updated_by = $8,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $9 AND company_code = $10
         RETURNING *`,
        [
          body.entry_date,
          body.destination,
          body.purpose,
          movement.entryType,
          movement.inflow,
          movement.outflow,
          body.notes,
          req.user!.id,
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
          module: 'Caixa',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: row,
          description: `Movimentação do caixa atualizada (${body.destination} - ${body.purpose}).`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.json({
      ...updated,
      entry_date: toIsoDate(updated.entry_date as string | Date),
      inflow: roundMoney(Number(updated.inflow)),
      outflow: roundMoney(Number(updated.outflow)),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('simultaneamente')) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  }
});

cashRouter.delete('/:id', requirePermission('cash', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM cash_entries WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Movimentação de caixa não encontrada.');

    await assertDatePeriodOpen(db, companyCode, existing.entry_date as string | Date);

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM cash_entries WHERE id = $1 AND company_code = $2', [
        req.params.id,
        companyCode,
      ]);
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EXCLUSAO',
          module: 'Caixa',
          recordId: String(req.params.id),
          previousValue: existing,
          description: `Movimentação do caixa (${existing.destination} - ${existing.purpose}) excluída.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Movimentação de caixa excluída com sucesso.' });
  } catch (err) {
    next(err);
  }
});

cashRouter.get('/export', requirePermission('cash', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    const data = await queryCashWithRunningBalance(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const rows = data.items.map((item) => {
      const r = item as Record<string, unknown>;
      return {
        entry_date: formatDateBR(r.entry_date as string),
        destination: String(r.destination),
        purpose: String(r.purpose),
        inflow: Number(r.inflow),
        outflow: Number(r.outflow),
        running_balance: Number(r.running_balance),
      };
    });

    const filters: string[] = [];
    if (data.destination) filters.push(`Destino: ${data.destination}`);
    if (data.purpose) filters.push(`Finalidade: ${data.purpose}`);
    if (data.entryType) filters.push(`Tipo: ${data.entryType}`);

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Movimentação do Caixa – ${req.user!.companyName}`,
      periodLabel: data.periodLabel,
      generatedBy: req.user!.name,
      filtersSummary: filters.join(' | ') || 'Todas as movimentações',
      landscape: true,
      columns: [
        { key: 'entry_date', header: 'Data', width: 11, type: 'date' },
        { key: 'destination', header: 'Destino / Responsável', width: 20, type: 'text' },
        { key: 'purpose', header: 'Finalidade', width: 26, type: 'text' },
        { key: 'inflow', header: 'Entrada (+)', width: 13, type: 'currency' },
        { key: 'outflow', header: 'Saída (-)', width: 13, type: 'currency' },
        { key: 'running_balance', header: 'Saldo Acumulado', width: 15, type: 'currency' },
      ],
      rows,
      summaryItems: [
        { label: 'Saldo Inicial do Período', value: data.summary.openingBalance, isCurrency: true },
        { label: 'Total de Entradas', value: data.summary.totalInflows, isCurrency: true },
        { label: 'Total de Saídas', value: data.summary.totalOutflows, isCurrency: true },
        { label: 'Saldo Final do Período', value: data.summary.closingBalance, isCurrency: true },
      ],
    };

    if (format === 'xlsx') {
      const buf = await generateExcelBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-caixa.xlsx"');
      res.send(buf);
      return;
    }

    if (format === 'docx') {
      const buf = await generateWordBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-caixa.docx"');
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financer-caixa.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
