import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  calculateExpenseFinalAmount,
  calculateExpenseTotals,
  EXPENSE_CATEGORIES,
  EXPENSE_TYPES,
  roundMoney,
} from '../domain/calculations.js';
import { formatBRL, formatDateBR, toIsoDate } from '../domain/formatters.js';
import { assertDatePeriodOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  generateWordBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const expensesRouter = Router();

const expenseSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Utilize o calendário.'),
    category: z.enum(EXPENSE_CATEGORIES, {
      errorMap: () => ({ message: 'Selecione uma categoria de despesa válida.' }),
    }),
    custom_description: z.string().trim().max(255).optional().nullable(),
    invoice_number: z
      .string()
      .trim()
      .regex(/^\d*$/, 'Nota fiscal deve conter apenas números.')
      .max(60)
      .optional()
      .default(''),
    original_amount: z.coerce.number().min(0.01, 'Valor original deve ser maior que zero.'),
    discount: z.coerce.number().min(0, 'Desconto não pode ser negativo.').optional().default(0),
    interest: z.coerce.number().min(0, 'Juros não podem ser negativos.').optional().default(0),
    expense_type: z.enum(EXPENSE_TYPES, {
      errorMap: () => ({ message: 'Selecione o tipo: Empresa ou Pessoal.' }),
    }),
    notes: z.string().trim().max(1000).optional().default(''),
    version: z.coerce.number().int().optional(),
  })
  .refine(
    (d) => d.category !== 'Outros' || Boolean(d.custom_description && d.custom_description.trim().length > 0),
    {
      message: 'Ao selecionar "Outros", é obrigatório informar a descrição da despesa.',
      path: ['custom_description'],
    }
  );

function buildExpenseFilterSql(companyCode: string, query: Record<string, unknown>) {
  const conditions: string[] = ['e.company_code = $1'];
  const params: unknown[] = [companyCode];

  const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : '';
  const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : '';
  const category = typeof query.category === 'string' && query.category && query.category !== 'ALL' ? query.category : '';
  const expenseType =
    typeof query.expenseType === 'string' && query.expenseType && query.expenseType !== 'ALL'
      ? query.expenseType
      : '';
  const invoiceNumber =
    typeof query.invoiceNumber === 'string' && query.invoiceNumber.trim()
      ? query.invoiceNumber.trim()
      : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  if (startDate) {
    params.push(startDate);
    conditions.push(`e.day >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`e.day <= $${params.length}::date`);
  }
  if (category) {
    params.push(category);
    conditions.push(`e.category = $${params.length}`);
  }
  if (expenseType) {
    params.push(expenseType);
    conditions.push(`e.expense_type = $${params.length}`);
  }
  if (invoiceNumber) {
    params.push(`%${invoiceNumber}%`);
    conditions.push(`e.invoice_number ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(e.category ILIKE $${params.length} OR COALESCE(e.custom_description, '') ILIKE $${params.length} OR e.invoice_number ILIKE $${params.length} OR COALESCE(e.notes, '') ILIKE $${params.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
    startDate,
    endDate,
    category,
    expenseType,
    invoiceNumber,
  };
}

expensesRouter.use(requireAuth);

expensesRouter.get('/', requirePermission('expenses', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const { whereClause, params } = buildExpenseFilterSql(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const sortMap: Record<string, string> = {
      day: 'e.day',
      category: 'e.category',
      original_amount: 'e.original_amount',
      final_amount: 'e.final_amount',
      expense_type: 'e.expense_type',
      invoice_number: 'e.invoice_number',
    };
    const sortBy = sortMap[String(req.query.sortBy || 'day')] || 'e.day';
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const allRes = await db.query<Record<string, unknown>>(
      `SELECT e.*, u.name AS created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       ${whereClause}
       ORDER BY ${sortBy} ${sortDir}, e.created_at DESC`,
      params
    );

    const normalized = allRes.rows.map((r) => ({
      ...r,
      day: toIsoDate(r.day as string | Date),
      description_display:
        r.category === 'Outros' && r.custom_description
          ? `Outros - ${r.custom_description}`
          : String(r.category),
      original_amount: roundMoney(Number(r.original_amount)),
      discount: roundMoney(Number(r.discount)),
      interest: roundMoney(Number(r.interest)),
      final_amount: roundMoney(Number(r.final_amount)),
    }));

    const summary = calculateExpenseTotals(normalized as never);

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    res.json({
      items: normalized.slice(offset, offset + pageSize),
      total: normalized.length,
      page,
      pageSize,
      summary,
    });
  } catch (err) {
    next(err);
  }
});

expensesRouter.post('/', requirePermission('expenses', 'create'), async (req, res, next) => {
  try {
    const body = expenseSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    await assertDatePeriodOpen(db, companyCode, body.day);

    const finalAmount = calculateExpenseFinalAmount(
      body.original_amount,
      body.discount,
      body.interest
    );
    const customDesc = body.category === 'Outros' ? body.custom_description?.trim() || null : null;

    const dupRes = await db.query<{ id: string }>(
      `SELECT id FROM expenses
       WHERE company_code = $1
         AND day = $2::date
         AND category = $3
         AND COALESCE(LOWER(TRIM(custom_description)), '') = COALESCE(LOWER(TRIM($4)), '')
         AND invoice_number = $5
         AND original_amount = $6
         AND expense_type = $7
       LIMIT 1`,
      [
        companyCode,
        body.day,
        body.category,
        customDesc,
        body.invoice_number,
        roundMoney(body.original_amount),
        body.expense_type,
      ]
    );
    if (dupRes.rows[0]) {
      throw new HttpError(
        409,
        'Já existe uma despesa idêntica cadastrada nesta empresa para esta data, categoria, nota fiscal, valor e tipo.'
      );
    }

    const id = crypto.randomUUID();
    const inserted = await db.transaction(async (tx) => {
      const resInsert = await tx.query<Record<string, unknown>>(
        `INSERT INTO expenses (
           id, company_code, day, category, custom_description, invoice_number,
           original_amount, discount, interest, final_amount,
           expense_type, notes, created_by, updated_by
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         RETURNING *`,
        [
          id,
          companyCode,
          body.day,
          body.category,
          customDesc,
          body.invoice_number,
          roundMoney(body.original_amount),
          roundMoney(body.discount),
          roundMoney(body.interest),
          finalAmount,
          body.expense_type,
          body.notes,
          req.user!.id,
        ]
      );
      const row = resInsert.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'INCLUSAO',
          module: 'Despesas Mensais',
          recordId: id,
          newValue: row,
          description: `Despesa "${body.category}${customDesc ? ` - ${customDesc}` : ''}" (${body.expense_type}) no valor líquido de ${formatBRL(finalAmount)} em ${formatDateBR(body.day)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.status(201).json({
      ...inserted,
      day: toIsoDate(inserted.day as string | Date),
      original_amount: roundMoney(Number(inserted.original_amount)),
      discount: roundMoney(Number(inserted.discount)),
      interest: roundMoney(Number(inserted.interest)),
      final_amount: roundMoney(Number(inserted.final_amount)),
    });
  } catch (err) {
    next(err);
  }
});

expensesRouter.put('/:id', requirePermission('expenses', 'edit'), async (req, res, next) => {
  try {
    const body = expenseSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM expenses WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new HttpError(404, 'Despesa não encontrada.');
    }

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(
        409,
        'Este lançamento foi modificado por outro usuário enquanto você editava. Atualize os dados antes de salvar novamente.',
        'CONCURRENCY_CONFLICT'
      );
    }

    await assertDatePeriodOpen(db, companyCode, existing.day as string | Date);
    await assertDatePeriodOpen(db, companyCode, body.day);

    const finalAmount = calculateExpenseFinalAmount(
      body.original_amount,
      body.discount,
      body.interest
    );
    const customDesc = body.category === 'Outros' ? body.custom_description?.trim() || null : null;

    const updated = await db.transaction(async (tx) => {
      const updRes = await tx.query<Record<string, unknown>>(
        `UPDATE expenses SET
           day = $1::date,
           category = $2,
           custom_description = $3,
           invoice_number = $4,
           original_amount = $5,
           discount = $6,
           interest = $7,
           final_amount = $8,
           expense_type = $9,
           notes = $10,
           updated_by = $11,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $12 AND company_code = $13
         RETURNING *`,
        [
          body.day,
          body.category,
          customDesc,
          body.invoice_number,
          roundMoney(body.original_amount),
          roundMoney(body.discount),
          roundMoney(body.interest),
          finalAmount,
          body.expense_type,
          body.notes,
          req.user!.id,
          req.params.id,
          companyCode,
        ]
      );
      const row = updRes.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Despesas Mensais',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: row,
          description: `Despesa atualizada para "${body.category}${customDesc ? ` - ${customDesc}` : ''}" no valor líquido de ${formatBRL(finalAmount)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.json({
      ...updated,
      day: toIsoDate(updated.day as string | Date),
      original_amount: roundMoney(Number(updated.original_amount)),
      discount: roundMoney(Number(updated.discount)),
      interest: roundMoney(Number(updated.interest)),
      final_amount: roundMoney(Number(updated.final_amount)),
    });
  } catch (err) {
    next(err);
  }
});

expensesRouter.delete('/:id', requirePermission('expenses', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM expenses WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new HttpError(404, 'Despesa não encontrada.');
    }

    await assertDatePeriodOpen(db, companyCode, existing.day as string | Date);

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM expenses WHERE id = $1 AND company_code = $2', [
        req.params.id,
        companyCode,
      ]);
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EXCLUSAO',
          module: 'Despesas Mensais',
          recordId: String(req.params.id),
          previousValue: existing,
          description: `Despesa "${existing.category}" de ${formatDateBR(existing.day as string)} (${formatBRL(Number(existing.final_amount))}) excluída.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Despesa excluída com sucesso.' });
  } catch (err) {
    next(err);
  }
});

expensesRouter.get('/export', requirePermission('expenses', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    const db = getDb();
    const { whereClause, params, startDate, endDate, category, expenseType, invoiceNumber } =
      buildExpenseFilterSql(req.user!.companyCode, req.query as Record<string, unknown>);

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM expenses e ${whereClause} ORDER BY e.day ASC, e.created_at ASC`,
      params
    );
    const summary = calculateExpenseTotals(rowsRes.rows as never);

    const rows = rowsRes.rows.map((r) => ({
      day: formatDateBR(r.day as string | Date),
      description:
        r.category === 'Outros' && r.custom_description
          ? `Outros - ${r.custom_description}`
          : String(r.category),
      invoice_number: r.invoice_number || '-',
      original_amount: roundMoney(Number(r.original_amount)),
      discount: roundMoney(Number(r.discount)),
      interest: roundMoney(Number(r.interest)),
      final_amount: roundMoney(Number(r.final_amount)),
      expense_type: String(r.expense_type),
    }));

    const filtersApplied: string[] = [];
    if (category) filtersApplied.push(`Categoria: ${category}`);
    if (expenseType) filtersApplied.push(`Tipo: ${expenseType}`);
    if (invoiceNumber) filtersApplied.push(`NF: ${invoiceNumber}`);

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Despesas Mensais – ${req.user!.companyName}`,
      periodLabel:
        startDate || endDate
          ? `${startDate ? formatDateBR(startDate) : 'Início'} a ${endDate ? formatDateBR(endDate) : 'Atual'}`
          : 'Todo o período registrado',
      generatedBy: req.user!.name,
      filtersSummary: filtersApplied.join(' | ') || 'Todas as categorias e tipos',
      landscape: true,
      columns: [
        { key: 'day', header: 'Data', width: 11, type: 'date' },
        { key: 'description', header: 'Descrição da Despesa', width: 24, type: 'text' },
        { key: 'invoice_number', header: 'Nota Fiscal', width: 12, type: 'text' },
        { key: 'original_amount', header: 'Valor Original', width: 14, type: 'currency' },
        { key: 'discount', header: 'Desconto', width: 12, type: 'currency' },
        { key: 'interest', header: 'Juros', width: 12, type: 'currency' },
        { key: 'final_amount', header: 'Valor Final', width: 14, type: 'currency' },
        { key: 'expense_type', header: 'Tipo', width: 11, type: 'text' },
      ],
      rows,
      excelRowFormulas: (r) => ({
        final_amount: `D${r}-E${r}+F${r}`,
      }),
      subtotalSections: [
        {
          title: 'Subtotais por Categoria',
          headers: ['Categoria', 'Qtd.', 'Valor Bruto', 'Descontos', 'Juros', 'Total Líquido'],
          rows: summary.byCategory.map((c) => [
            c.category,
            c.count,
            formatBRL(c.grossTotal),
            formatBRL(c.totalDiscount),
            formatBRL(c.totalInterest),
            formatBRL(c.netTotal),
          ]),
        },
        {
          title: 'Subtotais por Tipo (Empresa x Pessoal)',
          headers: ['Tipo', 'Qtd.', 'Valor Bruto', 'Descontos', 'Juros', 'Total Líquido'],
          rows: summary.byType.map((t) => [
            t.type,
            t.count,
            formatBRL(t.grossTotal),
            formatBRL(t.totalDiscount),
            formatBRL(t.totalInterest),
            formatBRL(t.netTotal),
          ]),
        },
      ],
      summaryItems: [
        { label: 'Quantidade de Lançamentos', value: summary.count },
        { label: 'Total Bruto das Despesas', value: summary.grossTotal, isCurrency: true },
        { label: 'Total de Descontos', value: summary.totalDiscount, isCurrency: true },
        { label: 'Total de Juros', value: summary.totalInterest, isCurrency: true },
        { label: 'Total Líquido Gasto', value: summary.netTotal, isCurrency: true },
      ],
    };

    if (format === 'xlsx') {
      const buf = await generateExcelBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-despesas.xlsx"');
      res.send(buf);
      return;
    }

    if (format === 'docx') {
      const buf = await generateWordBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-despesas.docx"');
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financer-despesas.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
