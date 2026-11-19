export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Valor numérico inválido.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseMoney(value: unknown, fieldName = 'Valor'): number {
  const num = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} deve ser um número válido.`);
  }
  return roundMoney(num);
}

// ============================================================================
// 1. DESPESAS MENSAIS
// Fórmula: Valor final = Valor original - Desconto + Juros
// ============================================================================
export const EXPENSE_CATEGORIES = [
  'Alimentação',
  'Farmácia',
  'Gerais',
  'Combustíveis',
  'Outros',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_TYPES = ['Empresa', 'Pessoal'] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export function calculateExpenseFinalAmount(
  originalAmount: number,
  discount = 0,
  interest = 0
): number {
  const orig = roundMoney(originalAmount);
  const disc = roundMoney(discount);
  const intr = roundMoney(interest);
  if (orig < 0) throw new Error('Valor original não pode ser negativo.');
  if (disc < 0) throw new Error('Desconto não pode ser negativo.');
  if (intr < 0) throw new Error('Juros não podem ser negativos.');
  return roundMoney(orig - disc + intr);
}

export interface ExpenseCalcItem {
  category: string;
  custom_description?: string | null;
  expense_type: string;
  original_amount: number | string;
  discount: number | string;
  interest: number | string;
  final_amount: number | string;
}

export interface ExpenseTotalsSummary {
  count: number;
  grossTotal: number;
  totalDiscount: number;
  totalInterest: number;
  netTotal: number;
  byCategory: Array<{
    category: string;
    count: number;
    grossTotal: number;
    totalDiscount: number;
    totalInterest: number;
    netTotal: number;
  }>;
  byType: Array<{
    type: string;
    count: number;
    grossTotal: number;
    totalDiscount: number;
    totalInterest: number;
    netTotal: number;
  }>;
}

export function calculateExpenseTotals(items: ExpenseCalcItem[]): ExpenseTotalsSummary {
  let grossTotal = 0;
  let totalDiscount = 0;
  let totalInterest = 0;
  let netTotal = 0;

  const catMap = new Map<
    string,
    { count: number; grossTotal: number; totalDiscount: number; totalInterest: number; netTotal: number }
  >();
  const typeMap = new Map<
    string,
    { count: number; grossTotal: number; totalDiscount: number; totalInterest: number; netTotal: number }
  >();

  for (const item of items) {
    const orig = roundMoney(Number(item.original_amount) || 0);
    const disc = roundMoney(Number(item.discount) || 0);
    const intr = roundMoney(Number(item.interest) || 0);
    const fin = roundMoney(Number(item.final_amount) || 0);

    grossTotal = roundMoney(grossTotal + orig);
    totalDiscount = roundMoney(totalDiscount + disc);
    totalInterest = roundMoney(totalInterest + intr);
    netTotal = roundMoney(netTotal + fin);

    const catEntry = catMap.get(item.category) || {
      count: 0,
      grossTotal: 0,
      totalDiscount: 0,
      totalInterest: 0,
      netTotal: 0,
    };
    catEntry.count += 1;
    catEntry.grossTotal = roundMoney(catEntry.grossTotal + orig);
    catEntry.totalDiscount = roundMoney(catEntry.totalDiscount + disc);
    catEntry.totalInterest = roundMoney(catEntry.totalInterest + intr);
    catEntry.netTotal = roundMoney(catEntry.netTotal + fin);
    catMap.set(item.category, catEntry);

    const typeEntry = typeMap.get(item.expense_type) || {
      count: 0,
      grossTotal: 0,
      totalDiscount: 0,
      totalInterest: 0,
      netTotal: 0,
    };
    typeEntry.count += 1;
    typeEntry.grossTotal = roundMoney(typeEntry.grossTotal + orig);
    typeEntry.totalDiscount = roundMoney(typeEntry.totalDiscount + disc);
    typeEntry.totalInterest = roundMoney(typeEntry.totalInterest + intr);
    typeEntry.netTotal = roundMoney(typeEntry.netTotal + fin);
    typeMap.set(item.expense_type, typeEntry);
  }

  return {
    count: items.length,
    grossTotal,
    totalDiscount,
    totalInterest,
    netTotal,
    byCategory: Array.from(catMap.entries()).map(([category, v]) => ({ category, ...v })),
    byType: Array.from(typeMap.entries()).map(([type, v]) => ({ type, ...v })),
  };
}

// ============================================================================
// 2. VIAGENS
// Valor gasto = Valor de saída - Valor de devolução
// VPP = Valor gasto / Quantidade de pessoas (impedir divisão por zero!)
// ============================================================================
export const TRIP_GROUPS = ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'ALFA'] as const;
export type TripGroup = (typeof TRIP_GROUPS)[number];

export const PAYMENT_METHODS = ['Espécie', 'PIX', 'Cartão'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function calculateTripValues(
  departureAmount: number,
  returnAmount: number,
  peopleCount: number
): { spentAmount: number; vpp: number } {
  const dep = roundMoney(departureAmount);
  const ret = roundMoney(returnAmount);
  if (dep < 0) throw new Error('Valor de saída não pode ser negativo.');
  if (ret < 0) throw new Error('Valor de devolução não pode ser negativo.');
  if (!Number.isInteger(peopleCount) || peopleCount <= 0) {
    throw new Error('Quantidade de pessoas deve ser um número inteiro maior que zero.');
  }
  const spentAmount = roundMoney(dep - ret);
  const vpp = roundMoney(spentAmount / peopleCount);
  return { spentAmount, vpp };
}

export interface TripCalcItem {
  departure_amount: number | string;
  return_amount: number | string;
  spent_amount: number | string;
  people_count: number | string;
  vpp: number | string;
}

export interface TripTotalsSummary {
  count: number;
  totalDisbursed: number;
  totalReturned: number;
  totalSpent: number;
  totalPeople: number;
  averagePerPerson: number;
}

export function calculateTripTotals(items: TripCalcItem[]): TripTotalsSummary {
  let totalDisbursed = 0;
  let totalReturned = 0;
  let totalSpent = 0;
  let totalPeople = 0;

  for (const item of items) {
    totalDisbursed = roundMoney(totalDisbursed + (Number(item.departure_amount) || 0));
    totalReturned = roundMoney(totalReturned + (Number(item.return_amount) || 0));
    totalSpent = roundMoney(totalSpent + (Number(item.spent_amount) || 0));
    totalPeople += Number(item.people_count) || 0;
  }

  const averagePerPerson = totalPeople > 0 ? roundMoney(totalSpent / totalPeople) : 0;

  return {
    count: items.length,
    totalDisbursed,
    totalReturned,
    totalSpent,
    totalPeople,
    averagePerPerson,
  };
}

// ============================================================================
// 3. LEMBRETES / RECORRÊNCIAS
// ============================================================================
export const REMINDER_ACCOUNTS = ['PESSOAS', 'NAAP', 'INFOR MANAGER', 'CONTABILITÁ'] as const;
export const REMINDER_DIGITS = ['09', '10', 'PF'] as const;

export interface MonthlyOccurrenceSpec {
  year: number;
  month: number;
  dueDate: string; // YYYY-MM-DD
}

export function generateMonthlyCompetences(
  startDateIso: string,
  endDateIso: string
): MonthlyOccurrenceSpec[] {
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDateIso);
  const endMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDateIso);
  if (!startMatch || !endMatch) {
    throw new Error('Datas inicial e final devem estar no formato válido AAAA-MM-DD.');
  }

  const startYear = Number(startMatch[1]);
  const startMonth = Number(startMatch[2]);
  const dueDay = Number(startMatch[3]);
  const endYear = Number(endMatch[1]);
  const endMonth = Number(endMatch[2]);

  if (endDateIso < startDateIso) {
    throw new Error('Data final não pode ser anterior à data inicial.');
  }

  const results: MonthlyOccurrenceSpec[] = [];
  let y = startYear;
  let m = startMonth;

  // Limite de segurança de 240 meses (20 anos) para evitar loops acidentais
  let guard = 0;
  while ((y < endYear || (y === endYear && m <= endMonth)) && guard < 240) {
    const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const clampedDay = Math.min(dueDay, lastDayOfMonth);
    const dueDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
    results.push({ year: y, month: m, dueDate });

    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }

  return results;
}

export type ReminderAlertSituation =
  | 'PAGA'
  | 'SUSPENSA'
  | 'VENCIDA'
  | 'PROXIMO_VENCIMENTO'
  | 'PENDENTE';

export function computeReminderAlertSituation(
  status: string,
  dueDateIso: string,
  todayIso: string,
  alertDays = 5
): ReminderAlertSituation {
  if (status === 'PAGA') return 'PAGA';
  if (status === 'SUSPENSA') return 'SUSPENSA';

  const dueMs = Date.parse(`${dueDateIso}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  const diffDays = Math.floor((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'VENCIDA';
  if (diffDays <= alertDays) return 'PROXIMO_VENCIMENTO';
  return 'PENDENTE';
}

// ============================================================================
// 4. CAIXA
// Saldo final = Saldo inicial + Total de entradas - Total de saídas
// ============================================================================
export function validateCashMovement(inflow: number, outflow: number): {
  entryType: 'ENTRADA' | 'SAIDA';
  inflow: number;
  outflow: number;
} {
  const inf = roundMoney(inflow);
  const out = roundMoney(outflow);

  if (inf < 0 || out < 0) {
    throw new Error('Os valores de entrada e saída devem ser positivos ou zero.');
  }
  if (inf > 0 && out > 0) {
    throw new Error('Um mesmo lançamento não pode ser registrado simultaneamente como entrada e saída.');
  }
  if (inf === 0 && out === 0) {
    throw new Error('Informe um valor maior que zero para entrada ou saída.');
  }

  if (inf > 0) {
    return { entryType: 'ENTRADA', inflow: inf, outflow: 0 };
  }
  return { entryType: 'SAIDA', inflow: 0, outflow: out };
}

export interface CashEntryWithBalance<T> {
  entry: T;
  running_balance: number;
}

export function calculateCashRunningBalances<
  T extends { inflow: number | string; outflow: number | string }
>(
  openingBalance: number,
  entries: T[]
): {
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  closingBalance: number;
  items: Array<T & { running_balance: number }>;
} {
  let running = roundMoney(openingBalance);
  let totalInflows = 0;
  let totalOutflows = 0;

  const items = entries.map((e) => {
    const inf = roundMoney(Number(e.inflow) || 0);
    const out = roundMoney(Number(e.outflow) || 0);
    totalInflows = roundMoney(totalInflows + inf);
    totalOutflows = roundMoney(totalOutflows + out);
    running = roundMoney(running + inf - out);
    return {
      ...e,
      inflow: inf,
      outflow: out,
      running_balance: running,
    };
  });

  return {
    openingBalance: roundMoney(openingBalance),
    totalInflows,
    totalOutflows,
    closingBalance: running,
    items,
  };
}

// ============================================================================
// 5. CONCILIAÇÃO FINANCEIRA
// Diferença = Saldo conferido - Saldo registrado no sistema
// ============================================================================
export type ReconciliationStatus = 'PENDENTE' | 'CONCILIADO' | 'DIVERGENTE';

export function calculateReconciliationResult(
  calculatedBalance: number,
  checkedBalance: number | null | undefined
): { difference: number | null; status: ReconciliationStatus } {
  if (checkedBalance === null || checkedBalance === undefined || Number.isNaN(checkedBalance)) {
    return { difference: null, status: 'PENDENTE' };
  }
  const calc = roundMoney(calculatedBalance);
  const checked = roundMoney(checkedBalance);
  const difference = roundMoney(checked - calc);
  const status: ReconciliationStatus = difference === 0 ? 'CONCILIADO' : 'DIVERGENTE';
  return { difference, status };
}
