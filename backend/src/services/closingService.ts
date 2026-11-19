import crypto from 'node:crypto';
import { DbClient, getDb } from '../db/index.js';
import { roundMoney } from '../domain/calculations.js';
import { formatCompetenceBR } from '../domain/formatters.js';
import { HttpError } from '../domain/periodLock.js';
import { recordAudit } from './auditService.js';

export interface ClosingInconsistency {
  severity: 'ALTA' | 'MEDIA' | 'INFO';
  code: string;
  message: string;
}

export interface MonthlyClosingSummary {
  companyCode: string;
  year: number;
  month: number;
  competence: string;
  periodStart: string;
  periodEnd: string;
  status: 'ABERTO' | 'FECHADO' | 'REABERTO';
  openingBalance: number;
  totalPersonalExpenses: number;
  totalCompanyExpenses: number;
  totalExpenses: number;
  expensesCount: number;
  totalTrips: number;
  tripsCount: number;
  totalInflows: number;
  totalOutflows: number;
  cashEntriesCount: number;
  closingBalance: number;
  paidRemindersCount: number;
  paidRemindersAmount: number;
  pendingRemindersCount: number;
  pendingRemindersAmount: number;
  reconciliationStatus: string;
  inconsistencies: ClosingInconsistency[];
  record: Record<string, unknown> | null;
}

export function getMonthDateBounds(year: number, month: number): { start: string; end: string } {
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export function getPrevYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function getNextYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export async function getCashBalanceBeforeDate(
  companyCode: string,
  dateIso: string,
  db: DbClient = getDb()
): Promise<number> {
  const cfg = await db.query<{ initial_cash_balance: string }>(
    'SELECT initial_cash_balance FROM companies WHERE code = $1',
    [companyCode]
  );
  const baseInitial = roundMoney(Number(cfg.rows[0]?.initial_cash_balance || 0));

  const prior = await db.query<{ inflows: string; outflows: string }>(
    `SELECT
       COALESCE(SUM(inflow), 0)::text AS inflows,
       COALESCE(SUM(outflow), 0)::text AS outflows
     FROM cash_entries
     WHERE company_code = $1 AND entry_date < $2::date`,
    [companyCode, dateIso]
  );

  const inflows = roundMoney(Number(prior.rows[0]?.inflows || 0));
  const outflows = roundMoney(Number(prior.rows[0]?.outflows || 0));
  return roundMoney(baseInitial + inflows - outflows);
}

export async function getMonthOpeningBalance(
  companyCode: string,
  year: number,
  month: number,
  db: DbClient = getDb()
): Promise<number> {
  const prev = getPrevYearMonth(year, month);
  const prevClosed = await db.query<{ status: string; closing_balance: string }>(
    'SELECT status, closing_balance FROM monthly_closings WHERE company_code = $1 AND year = $2 AND month = $3',
    [companyCode, prev.year, prev.month]
  );
  if (prevClosed.rows[0]?.status === 'FECHADO') {
    return roundMoney(Number(prevClosed.rows[0].closing_balance));
  }
  const { start } = getMonthDateBounds(year, month);
  return getCashBalanceBeforeDate(companyCode, start, db);
}

export async function computeMonthlyClosingSummary(
  companyCode: string,
  year: number,
  month: number,
  db: DbClient = getDb()
): Promise<MonthlyClosingSummary> {
  const { start, end } = getMonthDateBounds(year, month);

  const existingRes = await db.query<Record<string, unknown>>(
    'SELECT * FROM monthly_closings WHERE company_code = $1 AND year = $2 AND month = $3',
    [companyCode, year, month]
  );
  const existing = existingRes.rows[0] || null;
  const status = (existing?.status as 'ABERTO' | 'FECHADO' | 'REABERTO') || 'ABERTO';

  const openingBalance = await getMonthOpeningBalance(companyCode, year, month, db);

  const expRes = await db.query<{
    personal: string;
    company: string;
    cnt: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN expense_type = 'Pessoal' THEN final_amount ELSE 0 END), 0)::text AS personal,
       COALESCE(SUM(CASE WHEN expense_type = 'Empresa' THEN final_amount ELSE 0 END), 0)::text AS company,
       COUNT(*)::text AS cnt
     FROM expenses
     WHERE company_code = $1 AND day >= $2::date AND day <= $3::date`,
    [companyCode, start, end]
  );

  const tripRes = await db.query<{ spent: string; cnt: string }>(
    `SELECT
       COALESCE(SUM(spent_amount), 0)::text AS spent,
       COUNT(*)::text AS cnt
     FROM trips
     WHERE company_code = $1 AND departure_date >= $2::date AND departure_date <= $3::date`,
    [companyCode, start, end]
  );

  const cashRes = await db.query<{ inflows: string; outflows: string; cnt: string }>(
    `SELECT
       COALESCE(SUM(inflow), 0)::text AS inflows,
       COALESCE(SUM(outflow), 0)::text AS outflows,
       COUNT(*)::text AS cnt
     FROM cash_entries
     WHERE company_code = $1 AND entry_date >= $2::date AND entry_date <= $3::date`,
    [companyCode, start, end]
  );

  const remRes = await db.query<{
    paid_cnt: string;
    paid_amt: string;
    pend_cnt: string;
    pend_amt: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PAGA')::text AS paid_cnt,
       COALESCE(SUM(amount) FILTER (WHERE status = 'PAGA'), 0)::text AS paid_amt,
       COUNT(*) FILTER (WHERE status = 'PENDENTE')::text AS pend_cnt,
       COALESCE(SUM(amount) FILTER (WHERE status = 'PENDENTE'), 0)::text AS pend_amt
     FROM reminders
     WHERE company_code = $1 AND competence_year = $2 AND competence_month = $3`,
    [companyCode, year, month]
  );

  const reconRes = await db.query<{
    status: string;
    concluded: boolean;
    difference: string | null;
    justification: string | null;
  }>(
    `SELECT status, concluded, difference::text, justification
     FROM reconciliations
     WHERE company_code = $1 AND period_start >= $2::date AND period_end <= $3::date
     ORDER BY created_at DESC
     LIMIT 1`,
    [companyCode, start, end]
  );

  const totalPersonalExpenses = roundMoney(Number(expRes.rows[0]?.personal || 0));
  const totalCompanyExpenses = roundMoney(Number(expRes.rows[0]?.company || 0));
  const totalExpenses = roundMoney(totalPersonalExpenses + totalCompanyExpenses);
  const expensesCount = Number(expRes.rows[0]?.cnt || 0);

  const totalTrips = roundMoney(Number(tripRes.rows[0]?.spent || 0));
  const tripsCount = Number(tripRes.rows[0]?.cnt || 0);

  const totalInflows = roundMoney(Number(cashRes.rows[0]?.inflows || 0));
  const totalOutflows = roundMoney(Number(cashRes.rows[0]?.outflows || 0));
  const cashEntriesCount = Number(cashRes.rows[0]?.cnt || 0);
  const closingBalance = roundMoney(openingBalance + totalInflows - totalOutflows);

  const paidRemindersCount = Number(remRes.rows[0]?.paid_cnt || 0);
  const paidRemindersAmount = roundMoney(Number(remRes.rows[0]?.paid_amt || 0));
  const pendingRemindersCount = Number(remRes.rows[0]?.pend_cnt || 0);
  const pendingRemindersAmount = roundMoney(Number(remRes.rows[0]?.pend_amt || 0));

  const latestRecon = reconRes.rows[0];
  const reconciliationStatus = latestRecon ? latestRecon.status : 'PENDENTE';

  const inconsistencies: ClosingInconsistency[] = [];
  if (!latestRecon) {
    inconsistencies.push({
      severity: 'MEDIA',
      code: 'NO_RECONCILIATION',
      message: 'Nenhuma conciliação financeira foi registrada para este mês.',
    });
  } else if (latestRecon.status === 'DIVERGENTE' && !latestRecon.concluded) {
    inconsistencies.push({
      severity: 'ALTA',
      code: 'UNRESOLVED_DIVERGENCE',
      message: `Existe conciliação DIVERGENTE (diferença de R$ ${Number(latestRecon.difference || 0).toFixed(2)}) ainda não concluída/justificada.`,
    });
  } else if (latestRecon.status === 'PENDENTE') {
    inconsistencies.push({
      severity: 'MEDIA',
      code: 'PENDING_RECONCILIATION',
      message: 'A conciliação financeira do período ainda está pendente de conferência.',
    });
  }

  if (pendingRemindersCount > 0) {
    inconsistencies.push({
      severity: 'MEDIA',
      code: 'PENDING_REMINDERS',
      message: `Existem ${pendingRemindersCount} conta(s)/lembrete(s) pendente(s) nesta competência.`,
    });
  }

  return {
    companyCode,
    year,
    month,
    competence: formatCompetenceBR(year, month),
    periodStart: start,
    periodEnd: end,
    status,
    openingBalance,
    totalPersonalExpenses,
    totalCompanyExpenses,
    totalExpenses,
    expensesCount,
    totalTrips,
    tripsCount,
    totalInflows,
    totalOutflows,
    cashEntriesCount,
    closingBalance,
    paidRemindersCount,
    paidRemindersAmount,
    pendingRemindersCount,
    pendingRemindersAmount,
    reconciliationStatus,
    inconsistencies,
    record: existing,
  };
}

export async function confirmMonthlyClosing(params: {
  companyCode: string;
  year: number;
  month: number;
  notes?: string;
  userId: string;
  userName: string;
  ipAddress?: string;
  db?: DbClient;
}): Promise<MonthlyClosingSummary> {
  const db = params.db || getDb();
  const summary = await computeMonthlyClosingSummary(
    params.companyCode,
    params.year,
    params.month,
    db
  );

  if (summary.status === 'FECHADO') {
    throw new HttpError(409, `O período ${summary.competence} já se encontra fechado.`);
  }

  const highSeverity = summary.inconsistencies.filter((i) => i.severity === 'ALTA');
  if (highSeverity.length > 0) {
    throw new HttpError(
      400,
      `Não é possível fechar o período com inconsistências críticas: ${highSeverity.map((i) => i.message).join(' ')}`
    );
  }

  await db.transaction(async (tx) => {
    const id = (summary.record?.id as string) || crypto.randomUUID();
    if (summary.record) {
      await tx.query(
        `UPDATE monthly_closings SET
           status = 'FECHADO',
           opening_balance = $1,
           total_personal_expenses = $2,
           total_company_expenses = $3,
           total_trips = $4,
           total_inflows = $5,
           total_outflows = $6,
           closing_balance = $7,
           pending_reminders_count = $8,
           pending_reminders_amount = $9,
           reconciliation_status = $10,
           inconsistencies = $11::jsonb,
           notes = $12,
           closed_by = $13,
           closed_by_name = $14,
           closed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
         WHERE id = $15`,
        [
          summary.openingBalance,
          summary.totalPersonalExpenses,
          summary.totalCompanyExpenses,
          summary.totalTrips,
          summary.totalInflows,
          summary.totalOutflows,
          summary.closingBalance,
          summary.pendingRemindersCount,
          summary.pendingRemindersAmount,
          summary.reconciliationStatus,
          JSON.stringify(summary.inconsistencies),
          params.notes || '',
          params.userId,
          params.userName,
          id,
        ]
      );
    } else {
      await tx.query(
        `INSERT INTO monthly_closings (
           id, company_code, year, month, status, opening_balance,
           total_personal_expenses, total_company_expenses, total_trips,
           total_inflows, total_outflows, closing_balance,
           pending_reminders_count, pending_reminders_amount,
           reconciliation_status, inconsistencies, notes,
           closed_by, closed_by_name, closed_at
         ) VALUES (
           $1, $2, $3, $4, 'FECHADO', $5,
           $6, $7, $8,
           $9, $10, $11,
           $12, $13,
           $14, $15::jsonb, $16,
           $17, $18, NOW()
         )`,
        [
          id,
          params.companyCode,
          params.year,
          params.month,
          summary.openingBalance,
          summary.totalPersonalExpenses,
          summary.totalCompanyExpenses,
          summary.totalTrips,
          summary.totalInflows,
          summary.totalOutflows,
          summary.closingBalance,
          summary.pendingRemindersCount,
          summary.pendingRemindersAmount,
          summary.reconciliationStatus,
          JSON.stringify(summary.inconsistencies),
          params.notes || '',
          params.userId,
          params.userName,
        ]
      );
    }

    const next = getNextYearMonth(params.year, params.month);
    const nextExisting = await tx.query<{ id: string; status: string }>(
      'SELECT id, status FROM monthly_closings WHERE company_code = $1 AND year = $2 AND month = $3',
      [params.companyCode, next.year, next.month]
    );
    if (!nextExisting.rows[0]) {
      await tx.query(
        `INSERT INTO monthly_closings (
           id, company_code, year, month, status, opening_balance, closing_balance
         ) VALUES ($1, $2, $3, $4, 'ABERTO', $5, $5)`,
        [crypto.randomUUID(), params.companyCode, next.year, next.month, summary.closingBalance]
      );
    } else if (nextExisting.rows[0].status !== 'FECHADO') {
      await tx.query(
        'UPDATE monthly_closings SET opening_balance = $1, updated_at = NOW() WHERE id = $2',
        [summary.closingBalance, nextExisting.rows[0].id]
      );
    }

    await recordAudit(
      {
        companyCode: params.companyCode,
        userId: params.userId,
        userName: params.userName,
        operation: 'FECHAMENTO_MENSAL',
        module: 'Fechamento Mensal',
        recordId: id,
        previousValue: summary.record,
        newValue: {
          competence: summary.competence,
          status: 'FECHADO',
          openingBalance: summary.openingBalance,
          closingBalance: summary.closingBalance,
          carriedOverToNextMonth: formatCompetenceBR(next.year, next.month),
        },
        description: `Fechamento mensal da competência ${summary.competence} confirmado com saldo final transportado de R$ ${summary.closingBalance.toFixed(2)}.`,
        ipAddress: params.ipAddress,
      },
      tx
    );
  });

  return computeMonthlyClosingSummary(params.companyCode, params.year, params.month, db);
}

export async function reopenMonthlyClosing(params: {
  companyCode: string;
  year: number;
  month: number;
  justification: string;
  userId: string;
  userName: string;
  ipAddress?: string;
  db?: DbClient;
}): Promise<MonthlyClosingSummary> {
  const db = params.db || getDb();
  const justification = params.justification?.trim();
  if (!justification || justification.length < 5) {
    throw new HttpError(
      400,
      'É obrigatório informar uma justificativa detalhada (mínimo 5 caracteres) para reabrir um período fechado.'
    );
  }

  const existingRes = await db.query<Record<string, unknown>>(
    'SELECT * FROM monthly_closings WHERE company_code = $1 AND year = $2 AND month = $3',
    [params.companyCode, params.year, params.month]
  );
  const existing = existingRes.rows[0];
  if (!existing || existing.status !== 'FECHADO') {
    throw new HttpError(
      400,
      `O período ${formatCompetenceBR(params.year, params.month)} não está fechado.`
    );
  }

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE monthly_closings SET
         status = 'REABERTO',
         reopened_by = $1,
         reopened_by_name = $2,
         reopened_at = NOW(),
         reopen_justification = $3,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $4`,
      [params.userId, params.userName, justification, existing.id]
    );

    await recordAudit(
      {
        companyCode: params.companyCode,
        userId: params.userId,
        userName: params.userName,
        operation: 'REABERTURA',
        module: 'Fechamento Mensal',
        recordId: String(existing.id),
        previousValue: { status: 'FECHADO', closed_at: existing.closed_at },
        newValue: { status: 'REABERTO', justification },
        description: `Período ${formatCompetenceBR(params.year, params.month)} reaberto pelo administrador. Justificativa: ${justification}`,
        ipAddress: params.ipAddress,
      },
      tx
    );
  });

  return computeMonthlyClosingSummary(params.companyCode, params.year, params.month, db);
}
