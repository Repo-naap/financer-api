import { DbClient } from '../db/index.js';
import { formatCompetenceBR, toIsoDate } from './formatters.js';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function extractYearMonth(dateValue: Date | string): { year: number; month: number } {
  const iso = toIsoDate(dateValue);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    throw new HttpError(400, `Data inválida: ${String(dateValue)}`);
  }
  return { year: Number(m[1]), month: Number(m[2]) };
}

export async function isPeriodClosed(
  db: DbClient,
  companyCode: string,
  year: number,
  month: number
): Promise<boolean> {
  const res = await db.query<{ status: string }>(
    'SELECT status FROM monthly_closings WHERE company_code = $1 AND year = $2 AND month = $3',
    [companyCode, year, month]
  );
  return res.rows[0]?.status === 'FECHADO';
}

export async function assertYearMonthOpen(
  db: DbClient,
  companyCode: string,
  year: number,
  month: number
): Promise<void> {
  const closed = await isPeriodClosed(db, companyCode, year, month);
  if (closed) {
    throw new HttpError(
      423,
      `O período ${formatCompetenceBR(year, month)} está FECHADO para esta empresa. Alterações e exclusões estão bloqueadas. Somente um Administrador pode reabrir o período com justificativa.`,
      'PERIOD_CLOSED'
    );
  }
}

export async function assertDatePeriodOpen(
  db: DbClient,
  companyCode: string,
  dateValue: Date | string
): Promise<void> {
  const { year, month } = extractYearMonth(dateValue);
  await assertYearMonthOpen(db, companyCode, year, month);
}
