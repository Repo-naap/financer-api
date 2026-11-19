import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { syncIbgeFromOfficialApi } from '../db/ibgeSeed.js';
import {
  calculateTripTotals,
  calculateTripValues,
  PAYMENT_METHODS,
  roundMoney,
  TRIP_GROUPS,
} from '../domain/calculations.js';
import { formatBRL, formatDateBR, toIsoDate } from '../domain/formatters.js';
import { assertDatePeriodOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const tripsRouter = Router();

const tripSchema = z.object({
  trip_group: z.enum(TRIP_GROUPS, {
    errorMap: () => ({ message: 'Selecione um grupo válido (GP-A, GP-B, GP-C, GP-D ou ALFA).' }),
  }),
  collaborator: z.string().trim().min(2, 'Informe o nome do colaborador.').max(160),
  municipality_ibge_code: z.coerce.number().int().positive('Selecione um município brasileiro válido.'),
  payment_method: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: 'Selecione a forma de pagamento (Espécie, PIX ou Cartão).' }),
  }),
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de saída inválida.'),
  departure_amount: z.coerce.number().min(0, 'Valor de saída não pode ser negativo.'),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de devolução inválida.')
    .optional()
    .nullable()
    .or(z.literal('')),
  return_amount: z.coerce.number().min(0, 'Valor de devolução não pode ser negativo.').optional().default(0),
  times_count: z.coerce.number().int().min(1, 'Quantidade de vezes deve ser pelo menos 1.').default(1),
  people_count: z.coerce
    .number()
    .int('Quantidade de pessoas deve ser um número inteiro.')
    .min(1, 'Quantidade de pessoas deve ser maior que zero (não é permitida divisão por zero).'),
  notes: z.string().trim().max(1000).optional().default(''),
  version: z.coerce.number().int().optional(),
});

function buildTripFilterSql(companyCode: string, query: Record<string, unknown>) {
  const conditions: string[] = ['t.company_code = $1'];
  const params: unknown[] = [companyCode];

  const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : '';
  const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : '';
  const group = typeof query.group === 'string' && query.group && query.group !== 'ALL' ? query.group : '';
  const uf = typeof query.uf === 'string' && query.uf && query.uf !== 'ALL' ? query.uf.toUpperCase() : '';
  const municipality =
    typeof query.municipality === 'string' && query.municipality.trim()
      ? query.municipality.trim()
      : '';
  const collaborator =
    typeof query.collaborator === 'string' && query.collaborator.trim()
      ? query.collaborator.trim()
      : '';
  const paymentMethod =
    typeof query.paymentMethod === 'string' && query.paymentMethod && query.paymentMethod !== 'ALL'
      ? query.paymentMethod
      : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  if (startDate) {
    params.push(startDate);
    conditions.push(`t.departure_date >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`t.departure_date <= $${params.length}::date`);
  }
  if (group) {
    params.push(group);
    conditions.push(`t.trip_group = $${params.length}`);
  }
  if (uf) {
    params.push(uf);
    conditions.push(`t.state_uf = $${params.length}`);
  }
  if (municipality) {
    params.push(`%${municipality}%`);
    conditions.push(`t.municipality_name ILIKE $${params.length}`);
  }
  if (collaborator) {
    params.push(`%${collaborator}%`);
    conditions.push(`t.collaborator ILIKE $${params.length}`);
  }
  if (paymentMethod) {
    params.push(paymentMethod);
    conditions.push(`t.payment_method = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(t.collaborator ILIKE $${params.length} OR t.municipality_name ILIKE $${params.length} OR t.trip_group ILIKE $${params.length} OR t.state_uf ILIKE $${params.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
    startDate,
    endDate,
    group,
    uf,
    municipality,
    collaborator,
    paymentMethod,
  };
}

tripsRouter.use(requireAuth);

tripsRouter.get('/states', requirePermission('trips', 'view'), async (_req, res, next) => {
  try {
    const db = getDb();
    const resStates = await db.query<{ uf: string; state_name: string; count: string }>(
      `SELECT uf, state_name, COUNT(*)::text AS count
       FROM ibge_municipalities
       GROUP BY uf, state_name
       ORDER BY uf ASC`
    );
    res.json({ states: resStates.rows });
  } catch (err) {
    next(err);
  }
});

tripsRouter.get('/municipalities', requirePermission('trips', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const uf = typeof req.query.uf === 'string' ? req.query.uf.trim().toUpperCase() : '';
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 100)));

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (uf && uf !== 'ALL') {
      params.push(uf);
      conditions.push(`uf = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(name ILIKE $${params.length} OR state_name ILIKE $${params.length} OR uf ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const rowsRes = await db.query(
      `SELECT ibge_code, name, uf, state_name, updated_at
       FROM ibge_municipalities
       ${where}
       ORDER BY uf ASC, name ASC
       LIMIT $${params.length}`,
      params
    );

    const totalRes = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM ibge_municipalities');

    res.json({
      items: rowsRes.rows,
      totalInDatabase: Number(totalRes.rows[0]?.cnt || 0),
    });
  } catch (err) {
    next(err);
  }
});

tripsRouter.post(
  '/municipalities/sync',
  requirePermission('trips', 'create'),
  async (req, res, next) => {
    try {
      const result = await syncIbgeFromOfficialApi();
      await recordAudit({
        companyCode: req.user!.companyCode,
        userId: req.user!.id,
        userName: req.user!.name,
        operation: 'CONFIGURACAO',
        module: 'Viagens',
        description: `Base oficial de municípios do IBGE atualizada (${result.total} municípios sincronizados).`,
        ipAddress: req.clientIp,
      });
      res.json({
        message: `Lista oficial do IBGE atualizada com sucesso: ${result.total} municípios.`,
        ...result,
      });
    } catch (err) {
      next(
        new HttpError(
          502,
          `Não foi possível atualizar a lista diretamente da API do IBGE no momento: ${
            err instanceof Error ? err.message : 'sem conexão'
          }`
        )
      );
    }
  }
);

tripsRouter.get('/', requirePermission('trips', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const { whereClause, params } = buildTripFilterSql(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const sortMap: Record<string, string> = {
      departure_date: 't.departure_date',
      trip_group: 't.trip_group',
      collaborator: 't.collaborator',
      municipality_name: 't.municipality_name',
      spent_amount: 't.spent_amount',
      vpp: 't.vpp',
    };
    const sortBy = sortMap[String(req.query.sortBy || 'departure_date')] || 't.departure_date';
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const allRes = await db.query<Record<string, unknown>>(
      `SELECT t.*, u.name AS created_by_name
       FROM trips t
       LEFT JOIN users u ON u.id = t.created_by
       ${whereClause}
       ORDER BY ${sortBy} ${sortDir}, t.created_at DESC`,
      params
    );

    const normalized = allRes.rows.map((r) => ({
      ...r,
      departure_date: toIsoDate(r.departure_date as string | Date),
      return_date: r.return_date ? toIsoDate(r.return_date as string | Date) : null,
      departure_amount: roundMoney(Number(r.departure_amount)),
      return_amount: roundMoney(Number(r.return_amount)),
      spent_amount: roundMoney(Number(r.spent_amount)),
      vpp: roundMoney(Number(r.vpp)),
      times_count: Number(r.times_count),
      people_count: Number(r.people_count),
    }));

    const summary = calculateTripTotals(normalized as never);

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

tripsRouter.post('/', requirePermission('trips', 'create'), async (req, res, next) => {
  try {
    const body = tripSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    await assertDatePeriodOpen(db, companyCode, body.departure_date);

    const munRes = await db.query<{ ibge_code: number; name: string; uf: string }>(
      'SELECT ibge_code, name, uf FROM ibge_municipalities WHERE ibge_code = $1',
      [body.municipality_ibge_code]
    );
    const mun = munRes.rows[0];
    if (!mun) {
      throw new HttpError(400, 'Município não encontrado na base oficial do IBGE.');
    }

    const { spentAmount, vpp } = calculateTripValues(
      body.departure_amount,
      body.return_amount,
      body.people_count
    );

    const returnDate = body.return_date && body.return_date.length === 10 ? body.return_date : null;

    const dupRes = await db.query<{ id: string }>(
      `SELECT id FROM trips
       WHERE company_code = $1
         AND trip_group = $2
         AND LOWER(TRIM(collaborator)) = LOWER(TRIM($3))
         AND municipality_ibge_code = $4
         AND departure_date = $5::date
         AND departure_amount = $6
       LIMIT 1`,
      [companyCode, body.trip_group, body.collaborator, mun.ibge_code, body.departure_date, roundMoney(body.departure_amount)]
    );
    if (dupRes.rows[0]) {
      throw new HttpError(
        409,
        'Já existe um lançamento idêntico de viagem nesta empresa para este colaborador, município, data de saída e valor.'
      );
    }

    const id = crypto.randomUUID();
    const created = await db.transaction(async (tx) => {
      const ins = await tx.query<Record<string, unknown>>(
        `INSERT INTO trips (
           id, company_code, trip_group, collaborator, municipality_ibge_code, municipality_name, state_uf,
           payment_method, departure_date, departure_amount, return_date, return_amount,
           times_count, people_count, spent_amount, vpp, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11::date, $12, $13, $14, $15, $16, $17, $18, $18)
         RETURNING *`,
        [
          id,
          companyCode,
          body.trip_group,
          body.collaborator,
          mun.ibge_code,
          mun.name,
          mun.uf,
          body.payment_method,
          body.departure_date,
          roundMoney(body.departure_amount),
          returnDate,
          roundMoney(body.return_amount),
          body.times_count,
          body.people_count,
          spentAmount,
          vpp,
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
          module: 'Viagens',
          recordId: id,
          newValue: row,
          description: `Viagem de ${body.collaborator} (${body.trip_group}) para ${mun.name}/${mun.uf}. Gasto: ${formatBRL(spentAmount)} | VPP: ${formatBRL(vpp)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.status(201).json({
      ...created,
      departure_date: toIsoDate(created.departure_date as string | Date),
      return_date: created.return_date ? toIsoDate(created.return_date as string | Date) : null,
      departure_amount: roundMoney(Number(created.departure_amount)),
      return_amount: roundMoney(Number(created.return_amount)),
      spent_amount: roundMoney(Number(created.spent_amount)),
      vpp: roundMoney(Number(created.vpp)),
    });
  } catch (err) {
    next(err);
  }
});

tripsRouter.put('/:id', requirePermission('trips', 'edit'), async (req, res, next) => {
  try {
    const body = tripSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM trips WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Viagem não encontrada.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(
        409,
        'Esta viagem foi alterada por outro usuário. Recarregue os dados antes de salvar.',
        'CONCURRENCY_CONFLICT'
      );
    }

    await assertDatePeriodOpen(db, companyCode, existing.departure_date as string | Date);
    await assertDatePeriodOpen(db, companyCode, body.departure_date);

    const munRes = await db.query<{ ibge_code: number; name: string; uf: string }>(
      'SELECT ibge_code, name, uf FROM ibge_municipalities WHERE ibge_code = $1',
      [body.municipality_ibge_code]
    );
    const mun = munRes.rows[0];
    if (!mun) throw new HttpError(400, 'Município não encontrado na base oficial do IBGE.');

    const { spentAmount, vpp } = calculateTripValues(
      body.departure_amount,
      body.return_amount,
      body.people_count
    );
    const returnDate = body.return_date && body.return_date.length === 10 ? body.return_date : null;

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE trips SET
           trip_group = $1,
           collaborator = $2,
           municipality_ibge_code = $3,
           municipality_name = $4,
           state_uf = $5,
           payment_method = $6,
           departure_date = $7::date,
           departure_amount = $8,
           return_date = $9::date,
           return_amount = $10,
           times_count = $11,
           people_count = $12,
           spent_amount = $13,
           vpp = $14,
           notes = $15,
           updated_by = $16,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $17 AND company_code = $18
         RETURNING *`,
        [
          body.trip_group,
          body.collaborator,
          mun.ibge_code,
          mun.name,
          mun.uf,
          body.payment_method,
          body.departure_date,
          roundMoney(body.departure_amount),
          returnDate,
          roundMoney(body.return_amount),
          body.times_count,
          body.people_count,
          spentAmount,
          vpp,
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
          module: 'Viagens',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: row,
          description: `Viagem de ${body.collaborator} (${mun.name}/${mun.uf}) atualizada. Gasto: ${formatBRL(spentAmount)} | VPP: ${formatBRL(vpp)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.json({
      ...updated,
      departure_date: toIsoDate(updated.departure_date as string | Date),
      return_date: updated.return_date ? toIsoDate(updated.return_date as string | Date) : null,
      departure_amount: roundMoney(Number(updated.departure_amount)),
      return_amount: roundMoney(Number(updated.return_amount)),
      spent_amount: roundMoney(Number(updated.spent_amount)),
      vpp: roundMoney(Number(updated.vpp)),
    });
  } catch (err) {
    next(err);
  }
});

tripsRouter.delete('/:id', requirePermission('trips', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM trips WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Viagem não encontrada.');

    await assertDatePeriodOpen(db, companyCode, existing.departure_date as string | Date);

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM trips WHERE id = $1 AND company_code = $2', [
        req.params.id,
        companyCode,
      ]);
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EXCLUSAO',
          module: 'Viagens',
          recordId: String(req.params.id),
          previousValue: existing,
          description: `Viagem de ${existing.collaborator} (${existing.municipality_name}/${existing.state_uf}) excluída.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Viagem excluída com sucesso.' });
  } catch (err) {
    next(err);
  }
});

tripsRouter.get('/export', requirePermission('trips', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    const db = getDb();
    const {
      whereClause,
      params,
      startDate,
      endDate,
      group,
      uf,
      municipality,
      collaborator,
      paymentMethod,
    } = buildTripFilterSql(req.user!.companyCode, req.query as Record<string, unknown>);

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM trips t ${whereClause} ORDER BY t.departure_date ASC, t.created_at ASC`,
      params
    );
    const summary = calculateTripTotals(rowsRes.rows as never);

    const rows = rowsRes.rows.map((r) => ({
      trip_group: String(r.trip_group),
      collaborator: String(r.collaborator),
      municipality: `${r.municipality_name}/${r.state_uf}`,
      payment_method: String(r.payment_method),
      departure_date: formatDateBR(r.departure_date as string | Date),
      departure_amount: roundMoney(Number(r.departure_amount)),
      return_date: r.return_date ? formatDateBR(r.return_date as string | Date) : '-',
      return_amount: roundMoney(Number(r.return_amount)),
      times_count: Number(r.times_count),
      people_count: Number(r.people_count),
      spent_amount: roundMoney(Number(r.spent_amount)),
      vpp: roundMoney(Number(r.vpp)),
    }));

    const filtersApplied: string[] = [];
    if (group) filtersApplied.push(`Grupo: ${group}`);
    if (uf) filtersApplied.push(`UF: ${uf}`);
    if (municipality) filtersApplied.push(`Município: ${municipality}`);
    if (collaborator) filtersApplied.push(`Colaborador: ${collaborator}`);
    if (paymentMethod) filtersApplied.push(`Forma: ${paymentMethod}`);

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Viagens – ${req.user!.companyName}`,
      periodLabel:
        startDate || endDate
          ? `${startDate ? formatDateBR(startDate) : 'Início'} a ${endDate ? formatDateBR(endDate) : 'Atual'}`
          : 'Todo o período registrado',
      generatedBy: req.user!.name,
      filtersSummary: filtersApplied.join(' | ') || 'Todos os registros',
      landscape: true,
      columns: [
        { key: 'trip_group', header: 'Grupo', width: 8, type: 'text' },
        { key: 'collaborator', header: 'Colaborador', width: 15, type: 'text' },
        { key: 'municipality', header: 'Município/UF', width: 16, type: 'text' },
        { key: 'payment_method', header: 'Forma', width: 9, type: 'text' },
        { key: 'departure_date', header: 'Dt. Saída', width: 10, type: 'date' },
        { key: 'departure_amount', header: 'Val. Saída', width: 12, type: 'currency' },
        { key: 'return_date', header: 'Dt. Devol.', width: 10, type: 'date' },
        { key: 'return_amount', header: 'Val. Devol.', width: 12, type: 'currency' },
        { key: 'times_count', header: 'Vezes', width: 7, type: 'number' },
        { key: 'people_count', header: 'Pessoas', width: 8, type: 'number' },
        { key: 'spent_amount', header: 'Valor Gasto', width: 12, type: 'currency' },
        { key: 'vpp', header: 'VPP', width: 11, type: 'currency' },
      ],
      rows,
      excelRowFormulas: (r) => ({
        spent_amount: `F${r}-H${r}`,
        vpp: `IF(J${r}>0,K${r}/J${r},0)`,
      }),
      summaryItems: [
        { label: 'Total Disponibilizado', value: summary.totalDisbursed, isCurrency: true },
        { label: 'Total Devolvido', value: summary.totalReturned, isCurrency: true },
        { label: 'Total Efetivamente Gasto', value: summary.totalSpent, isCurrency: true },
        { label: 'Total de Pessoas', value: summary.totalPeople },
        { label: 'Valor Médio por Pessoa (VPP Médio)', value: summary.averagePerPerson, isCurrency: true },
      ],
    };

    if (format === 'xlsx') {
      const buf = await generateExcelBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-viagens.xlsx"');
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financer-viagens.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
