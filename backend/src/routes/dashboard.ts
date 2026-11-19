import { Router } from 'express';
import { getDb } from '../db/index.js';
import { computeReminderAlertSituation, roundMoney } from '../domain/calculations.js';
import { formatCompetenceBR, getTodayIsoBR, toIsoDate } from '../domain/formatters.js';
import { hasPermission } from '../domain/permissions.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { getCashBalanceBeforeDate, getMonthDateBounds } from '../services/closingService.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

function resolveDashboardRange(query: Record<string, unknown>) {
  const today = getTodayIsoBR();
  const [curYear, curMonth] = today.split('-').map(Number);

  const period = String(query.period || 'MENSAL').toUpperCase();
  const year = Number(query.year || curYear);
  const month = Number(query.month || curMonth);
  const quarter = Number(query.quarter || Math.ceil(curMonth / 3));

  if (period === 'ANUAL') {
    return {
      period: 'ANUAL',
      year,
      month,
      quarter,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      label: `Ano ${year}`,
    };
  }

  if (period === 'TRIMESTRAL') {
    const startM = (quarter - 1) * 3 + 1;
    const endM = startM + 2;
    const { start } = getMonthDateBounds(year, startM);
    const { end } = getMonthDateBounds(year, endM);
    return {
      period: 'TRIMESTRAL',
      year,
      month,
      quarter,
      startDate: start,
      endDate: end,
      label: `${quarter}º Trimestre de ${year}`,
    };
  }

  const { start, end } = getMonthDateBounds(year, month);
  return {
    period: 'MENSAL',
    year,
    month,
    quarter,
    startDate: start,
    endDate: end,
    label: `${String(month).padStart(2, '0')}/${year}`,
  };
}

dashboardRouter.get('/', requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const range = resolveDashboardRange(req.query as Record<string, unknown>);
    const todayIso = getTodayIsoBR();

    const cfgRes = await db.query<{ due_alert_days: number; initial_cash_balance: string }>(
      'SELECT due_alert_days, initial_cash_balance FROM companies WHERE code = $1',
      [companyCode]
    );
    const alertDays = Number(cfgRes.rows[0]?.due_alert_days ?? 5);

    // 1. Despesas no período
    const expRes = await db.query<{
      category: string;
      expense_type: string;
      final_amount: string;
      day: string;
    }>(
      `SELECT category, expense_type, final_amount::text, day::text
       FROM expenses
       WHERE company_code = $1 AND day >= $2::date AND day <= $3::date`,
      [companyCode, range.startDate, range.endDate]
    );

    let totalPersonalExpenses = 0;
    let totalCompanyExpenses = 0;
    const byCatMap = new Map<string, number>();

    for (const e of expRes.rows) {
      const val = roundMoney(Number(e.final_amount));
      if (e.expense_type === 'Pessoal') totalPersonalExpenses = roundMoney(totalPersonalExpenses + val);
      else totalCompanyExpenses = roundMoney(totalCompanyExpenses + val);
      byCatMap.set(e.category, roundMoney((byCatMap.get(e.category) || 0) + val));
    }

    const totalExpensesPeriod = roundMoney(totalPersonalExpenses + totalCompanyExpenses);

    const monthBounds = getMonthDateBounds(range.year, range.month);
    const monthExpRes = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(final_amount), 0)::text AS total
       FROM expenses
       WHERE company_code = $1 AND day >= $2::date AND day <= $3::date`,
      [companyCode, monthBounds.start, monthBounds.end]
    );
    const totalMonthExpenses = roundMoney(Number(monthExpRes.rows[0]?.total || 0));

    const evoRes = await db.query<{ m: string; personal: string; company: string; total: string }>(
      `SELECT
         EXTRACT(MONTH FROM day)::int::text AS m,
         COALESCE(SUM(CASE WHEN expense_type = 'Pessoal' THEN final_amount ELSE 0 END), 0)::text AS personal,
         COALESCE(SUM(CASE WHEN expense_type = 'Empresa' THEN final_amount ELSE 0 END), 0)::text AS company,
         COALESCE(SUM(final_amount), 0)::text AS total
       FROM expenses
       WHERE company_code = $1 AND EXTRACT(YEAR FROM day) = $2
       GROUP BY EXTRACT(MONTH FROM day)
       ORDER BY EXTRACT(MONTH FROM day) ASC`,
      [companyCode, range.year]
    );
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const evoByMonth = new Map(evoRes.rows.map((r) => [Number(r.m), r]));
    const monthlyExpenseEvolution = monthNames.map((label, idx) => {
      const m = idx + 1;
      const found = evoByMonth.get(m);
      return {
        month: m,
        label,
        pessoal: roundMoney(Number(found?.personal || 0)),
        empresa: roundMoney(Number(found?.company || 0)),
        total: roundMoney(Number(found?.total || 0)),
      };
    });

    // 2. Viagens no período
    const tripRes = await db.query<{ trip_group: string; spent_amount: string; people_count: number }>(
      `SELECT trip_group, spent_amount::text, people_count
       FROM trips
       WHERE company_code = $1 AND departure_date >= $2::date AND departure_date <= $3::date`,
      [companyCode, range.startDate, range.endDate]
    );
    let totalTripsExpenses = 0;
    const tripGroupMap = new Map<string, { group: string; total: number; count: number }>();
    for (const t of tripRes.rows) {
      const val = roundMoney(Number(t.spent_amount));
      totalTripsExpenses = roundMoney(totalTripsExpenses + val);
      const curr = tripGroupMap.get(t.trip_group) || { group: t.trip_group, total: 0, count: 0 };
      curr.total = roundMoney(curr.total + val);
      curr.count += 1;
      tripGroupMap.set(t.trip_group, curr);
    }

    // 3. Caixa
    const openingBeforePeriod = await getCashBalanceBeforeDate(companyCode, range.startDate, db);
    const cashPeriodRes = await db.query<{ inflows: string; outflows: string }>(
      `SELECT
         COALESCE(SUM(inflow), 0)::text AS inflows,
         COALESCE(SUM(outflow), 0)::text AS outflows
       FROM cash_entries
       WHERE company_code = $1 AND entry_date >= $2::date AND entry_date <= $3::date`,
      [companyCode, range.startDate, range.endDate]
    );
    const totalCashInflows = roundMoney(Number(cashPeriodRes.rows[0]?.inflows || 0));
    const totalCashOutflows = roundMoney(Number(cashPeriodRes.rows[0]?.outflows || 0));

    const allCashRes = await db.query<{ inflows: string; outflows: string }>(
      `SELECT COALESCE(SUM(inflow), 0)::text AS inflows, COALESCE(SUM(outflow), 0)::text AS outflows
       FROM cash_entries
       WHERE company_code = $1`,
      [companyCode]
    );
    const baseInitial = roundMoney(Number(cfgRes.rows[0]?.initial_cash_balance || 0));
    const currentCashBalance = roundMoney(
      baseInitial + Number(allCashRes.rows[0]?.inflows || 0) - Number(allCashRes.rows[0]?.outflows || 0)
    );
    const periodEndingCashBalance = roundMoney(
      openingBeforePeriod + totalCashInflows - totalCashOutflows
    );

    const cashEvoRes = await db.query<{ m: string; inflows: string; outflows: string }>(
      `SELECT
         EXTRACT(MONTH FROM entry_date)::int::text AS m,
         COALESCE(SUM(inflow), 0)::text AS inflows,
         COALESCE(SUM(outflow), 0)::text AS outflows
       FROM cash_entries
       WHERE company_code = $1 AND EXTRACT(YEAR FROM entry_date) = $2
       GROUP BY EXTRACT(MONTH FROM entry_date)
       ORDER BY EXTRACT(MONTH FROM entry_date) ASC`,
      [companyCode, range.year]
    );
    const cashByMonth = new Map(cashEvoRes.rows.map((r) => [Number(r.m), r]));
    let accCash = await getCashBalanceBeforeDate(companyCode, `${range.year}-01-01`, db);
    const cashFlowMovement = monthNames.map((label, idx) => {
      const m = idx + 1;
      const found = cashByMonth.get(m);
      const entradas = roundMoney(Number(found?.inflows || 0));
      const saidas = roundMoney(Number(found?.outflows || 0));
      accCash = roundMoney(accCash + entradas - saidas);
      return { month: m, label, entradas, saidas, saldo: accCash };
    });

    // 4. Lembretes / Contas
    const remPeriodRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM reminders
       WHERE company_code = $1 AND due_date >= $2::date AND due_date <= $3::date
       ORDER BY due_date ASC`,
      [companyCode, range.startDate, range.endDate]
    );

    let totalPendingBills = 0;
    let pendingBillsCount = 0;
    let totalPaidBills = 0;
    let paidBillsCount = 0;
    let overdueBillsCount = 0;
    let overdueBillsAmount = 0;

    for (const r of remPeriodRes.rows) {
      const amt = roundMoney(Number(r.amount));
      const dueIso = toIsoDate(r.due_date as string | Date);
      const sit = computeReminderAlertSituation(String(r.status), dueIso, todayIso, alertDays);
      if (r.status === 'PAGA') {
        totalPaidBills = roundMoney(totalPaidBills + amt);
        paidBillsCount += 1;
      } else if (r.status === 'PENDENTE') {
        totalPendingBills = roundMoney(totalPendingBills + amt);
        pendingBillsCount += 1;
        if (sit === 'VENCIDA') {
          overdueBillsCount += 1;
          overdueBillsAmount = roundMoney(overdueBillsAmount + amt);
        }
      }
    }

    const upcomingRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM reminders
       WHERE company_code = $1 AND status = 'PENDENTE'
       ORDER BY due_date ASC
       LIMIT 15`,
      [companyCode]
    );
    const upcomingDueBills = upcomingRes.rows.map((r) => {
      const dueIso = toIsoDate(r.due_date as string | Date);
      return {
        id: r.id,
        description: r.description,
        account: r.account,
        digit: r.digit,
        due_date: dueIso,
        competence: formatCompetenceBR(Number(r.competence_year), Number(r.competence_month)),
        amount: roundMoney(Number(r.amount)),
        alert_status: computeReminderAlertSituation(String(r.status), dueIso, todayIso, alertDays),
      };
    });

    const totalUpcomingAmount = roundMoney(
      upcomingDueBills
        .filter((u) => u.alert_status === 'VENCIDA' || u.alert_status === 'PROXIMO_VENCIMENTO')
        .reduce((s, u) => s + u.amount, 0)
    );

    const totalRegisteredOut = roundMoney(totalExpensesPeriod + totalTripsExpenses);
    const revenueVsExpense = {
      revenues: totalCashInflows,
      expenses: totalRegisteredOut,
      cashOutflows: totalCashOutflows,
      netResult: roundMoney(totalCashInflows - totalRegisteredOut),
    };

    res.json({
      company: {
        code: req.user!.companyCode,
        name: req.user!.companyName,
        theme: req.user!.companyTheme,
      },
      range,
      indicators: {
        totalPersonalExpenses,
        totalCompanyExpenses,
        totalTripsExpenses,
        totalCashInflows,
        totalCashOutflows,
        currentCashBalance,
        periodEndingCashBalance,
        totalPendingBills,
        pendingBillsCount,
        totalPaidBills,
        paidBillsCount,
        overdueBillsCount,
        overdueBillsAmount,
        upcomingDueCount: upcomingDueBills.filter(
          (u) => u.alert_status === 'VENCIDA' || u.alert_status === 'PROXIMO_VENCIMENTO'
        ).length,
        upcomingDueAmount: totalUpcomingAmount,
        totalMonthExpenses,
        revenueVsExpense,
      },
      upcomingDueBills,
      charts: {
        expensesByCategory: Array.from(byCatMap.entries()).map(([category, total]) => ({
          category,
          total,
        })),
        personalVsCompany: [
          { name: 'Empresa', value: totalCompanyExpenses },
          { name: 'Pessoal', value: totalPersonalExpenses },
        ],
        monthlyExpenseEvolution,
        tripsByGroup: Array.from(tripGroupMap.values()),
        cashFlowMovement,
        billsPaidVsPending: [
          { name: 'Pagas', value: totalPaidBills, count: paidBillsCount },
          { name: 'Pendentes', value: totalPendingBills, count: pendingBillsCount },
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/drilldown', requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const range = resolveDashboardRange(req.query as Record<string, unknown>);
    const metric = String(req.query.metric || '');
    const filterValue = typeof req.query.value === 'string' ? req.query.value : '';
    const user = req.user!;

    if (
      metric === 'personal_expenses' ||
      metric === 'company_expenses' ||
      metric === 'expense_category' ||
      metric === 'month_expenses'
    ) {
      if (!hasPermission(user, 'expenses', 'view')) {
        res.status(403).json({ error: 'Você não possui permissão para visualizar Despesas Mensais.' });
        return;
      }
      const conditions = ['company_code = $1', 'day >= $2::date', 'day <= $3::date'];
      const params: unknown[] = [companyCode, range.startDate, range.endDate];
      if (metric === 'personal_expenses') conditions.push(`expense_type = 'Pessoal'`);
      if (metric === 'company_expenses') conditions.push(`expense_type = 'Empresa'`);
      if (metric === 'expense_category' && filterValue) {
        params.push(filterValue);
        conditions.push(`category = $${params.length}`);
      }
      const rows = await db.query(
        `SELECT id, day, category, custom_description, invoice_number, original_amount, discount, interest, final_amount, expense_type
         FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY day DESC LIMIT 200`,
        params
      );
      res.json({
        module: 'expenses',
        title: `Lançamentos de Despesas – ${user.companyName} (${range.label})`,
        items: rows.rows.map((r) => ({
          ...r,
          day: toIsoDate(r.day as string | Date),
          final_amount: roundMoney(Number(r.final_amount)),
        })),
      });
      return;
    }

    if (metric === 'trips' || metric === 'trip_group') {
      if (!hasPermission(user, 'trips', 'view')) {
        res.status(403).json({ error: 'Você não possui permissão para visualizar Viagens.' });
        return;
      }
      const conditions = ['company_code = $1', 'departure_date >= $2::date', 'departure_date <= $3::date'];
      const params: unknown[] = [companyCode, range.startDate, range.endDate];
      if (metric === 'trip_group' && filterValue) {
        params.push(filterValue);
        conditions.push(`trip_group = $${params.length}`);
      }
      const rows = await db.query(
        `SELECT id, trip_group, collaborator, municipality_name, state_uf, payment_method, departure_date, departure_amount, return_amount, spent_amount, people_count, vpp
         FROM trips WHERE ${conditions.join(' AND ')} ORDER BY departure_date DESC LIMIT 200`,
        params
      );
      res.json({
        module: 'trips',
        title: `Lançamentos de Viagens – ${user.companyName} (${range.label})`,
        items: rows.rows.map((r) => ({
          ...r,
          departure_date: toIsoDate(r.departure_date as string | Date),
          spent_amount: roundMoney(Number(r.spent_amount)),
          vpp: roundMoney(Number(r.vpp)),
        })),
      });
      return;
    }

    if (metric === 'cash_inflows' || metric === 'cash_outflows' || metric === 'cash_balance') {
      if (!hasPermission(user, 'cash', 'view')) {
        res.status(403).json({ error: 'Você não possui permissão para visualizar o Caixa.' });
        return;
      }
      const conditions: string[] = ['company_code = $1'];
      const params: unknown[] = [companyCode];
      if (metric !== 'cash_balance') {
        params.push(range.startDate, range.endDate);
        conditions.push('entry_date >= $2::date', 'entry_date <= $3::date');
      }
      if (metric === 'cash_inflows') conditions.push(`entry_type = 'ENTRADA'`);
      if (metric === 'cash_outflows') conditions.push(`entry_type = 'SAIDA'`);
      const rows = await db.query(
        `SELECT id, entry_date, destination, purpose, entry_type, inflow, outflow
         FROM cash_entries WHERE ${conditions.join(' AND ')} ORDER BY entry_date DESC LIMIT 200`,
        params
      );
      res.json({
        module: 'cash',
        title: `Movimentações do Caixa – ${user.companyName} (${metric === 'cash_balance' ? 'Acumulado' : range.label})`,
        items: rows.rows.map((r) => ({
          ...r,
          entry_date: toIsoDate(r.entry_date as string | Date),
          inflow: roundMoney(Number(r.inflow)),
          outflow: roundMoney(Number(r.outflow)),
        })),
      });
      return;
    }

    if (metric === 'pending_bills' || metric === 'paid_bills' || metric === 'upcoming_bills') {
      if (!hasPermission(user, 'reminders', 'view')) {
        res.status(403).json({ error: 'Você não possui permissão para visualizar Lembretes.' });
        return;
      }
      const conditions = ['company_code = $1', 'due_date >= $2::date', 'due_date <= $3::date'];
      const params: unknown[] = [companyCode, range.startDate, range.endDate];
      if (metric === 'pending_bills' || metric === 'upcoming_bills') {
        conditions.push(`status = 'PENDENTE'`);
      }
      if (metric === 'paid_bills') conditions.push(`status = 'PAGA'`);
      const rows = await db.query(
        `SELECT id, description, account, digit, due_date, paid_date, amount, status, competence_year, competence_month
         FROM reminders WHERE ${conditions.join(' AND ')} ORDER BY due_date ASC LIMIT 200`,
        params
      );
      res.json({
        module: 'reminders',
        title: `Contas e Lembretes – ${user.companyName} (${range.label})`,
        items: rows.rows.map((r) => ({
          ...r,
          due_date: toIsoDate(r.due_date as string | Date),
          paid_date: r.paid_date ? toIsoDate(r.paid_date as string | Date) : null,
          amount: roundMoney(Number(r.amount)),
        })),
      });
      return;
    }

    res.json({ module: 'unknown', title: 'Detalhamento', items: [] });
  } catch (err) {
    next(err);
  }
});
