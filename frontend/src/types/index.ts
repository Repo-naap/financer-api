export type AppModule =
  | 'dashboard'
  | 'expenses'
  | 'trips'
  | 'reminders'
  | 'cash'
  | 'invoices'
  | 'imports'
  | 'reconciliation'
  | 'closing'
  | 'audit'
  | 'reports'
  | 'settings';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'export'
  | 'close_period'
  | 'reopen_period';

export type UserRole = 'ADMINISTRADOR' | 'FINANCEIRO' | 'CONSULTA' | 'PERSONALIZADO';
export type CompanyCode = 'NAAP' | 'INFOR_MANAGER' | 'CONTABILITA';
export type CompanyTheme = 'purple' | 'navy' | 'burgundy';

export interface CompanyInfo {
  code: CompanyCode;
  name: string;
  theme: CompanyTheme;
  office_document?: string;
  office_email?: string;
  office_phone?: string;
  initial_cash_balance: number;
  due_alert_days: number;
}

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionsMatrix = Record<AppModule, ModulePermissions>;

export interface UserProfile {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  active: boolean;
  permissions: PermissionsMatrix;
  allowedCompanies?: CompanyCode[];
  allowed_companies?: CompanyCode[];
  companyCode?: CompanyCode;
  companyName?: string;
  companyTheme?: CompanyTheme;
  last_login_at?: string;
  created_at?: string;
  version?: number;
}

export interface SystemConfig {
  office_name: string;
  office_document?: string;
  office_email?: string;
  office_phone?: string;
  initial_cash_balance: number;
  due_alert_days: number;
  setup_completed: boolean;
}

export interface ExpenseRecord {
  id: string;
  day: string;
  category: 'Alimentação' | 'Farmácia' | 'Gerais' | 'Combustíveis' | 'Outros';
  custom_description?: string | null;
  description_display?: string;
  invoice_number: string;
  original_amount: number;
  discount: number;
  interest: number;
  final_amount: number;
  expense_type: 'Empresa' | 'Pessoal';
  notes?: string;
  created_by_name?: string;
  created_at?: string;
  version: number;
}

export interface IbgeMunicipality {
  ibge_code: number;
  name: string;
  uf: string;
  state_name: string;
}

export interface TripRecord {
  id: string;
  trip_group: 'GP-A' | 'GP-B' | 'GP-C' | 'GP-D' | 'ALFA';
  collaborator: string;
  municipality_ibge_code: number;
  municipality_name: string;
  state_uf: string;
  payment_method: 'Espécie' | 'PIX' | 'Cartão';
  departure_date: string;
  departure_amount: number;
  return_date?: string | null;
  return_amount: number;
  times_count: number;
  people_count: number;
  spent_amount: number;
  vpp: number;
  notes?: string;
  created_by_name?: string;
  version: number;
}

export interface ReminderRecord {
  id: string;
  series_id?: string | null;
  competence_year: number;
  competence_month: number;
  competence: string;
  due_date: string;
  description: string;
  amount: number;
  account: 'PESSOAS' | 'NAAP' | 'INFOR MANAGER' | 'CONTABILITÁ';
  digit: '09' | '10' | 'PF';
  status: 'PENDENTE' | 'PAGA' | 'SUSPENSA';
  alert_status: 'PAGA' | 'SUSPENSA' | 'VENCIDA' | 'PROXIMO_VENCIMENTO' | 'PENDENTE';
  paid_date?: string | null;
  notes?: string;
  version: number;
}

export interface CashEntryRecord {
  id: string;
  entry_date: string;
  destination: string;
  purpose: string;
  entry_type: 'ENTRADA' | 'SAIDA';
  inflow: number;
  outflow: number;
  running_balance: number;
  notes?: string;
  created_by_name?: string;
  version: number;
}

export interface ReconciliationRecord {
  id: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  total_inflows: number;
  total_outflows: number;
  calculated_balance: number;
  checked_balance: number | null;
  difference: number | null;
  status: 'PENDENTE' | 'CONCILIADO' | 'DIVERGENTE';
  concluded: boolean;
  justification?: string;
  notes?: string;
  responsible_name?: string;
  checked_at?: string | null;
  version: number;
}

export interface MonthlyClosingSummary {
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
  inconsistencies: Array<{ severity: 'ALTA' | 'MEDIA' | 'INFO'; code: string; message: string }>;
  record: Record<string, unknown> | null;
}

export interface AuditLogRecord {
  id: string;
  user_id?: string | null;
  user_name: string;
  operation: string;
  module: string;
  record_id?: string | null;
  previous_value?: unknown;
  new_value?: unknown;
  description: string;
  ip_address?: string | null;
  created_at: string;
}
