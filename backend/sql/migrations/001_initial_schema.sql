-- ============================================================================
-- FINANCER – Gestão Financeira e Contábil
-- Migração 001: Estrutura Inicial Completa do Banco de Dados PostgreSQL
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configurações gerais do escritório e parâmetros financeiros
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  office_name VARCHAR(200) NOT NULL DEFAULT 'Escritório de Assessoria Administrativa e Contábil',
  office_document VARCHAR(40) DEFAULT '',
  office_email VARCHAR(200) DEFAULT '',
  office_phone VARCHAR(40) DEFAULT '',
  initial_cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  due_alert_days INTEGER NOT NULL DEFAULT 5 CHECK (due_alert_days >= 0 AND due_alert_days <= 60),
  setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_config (id, setup_completed)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Usuários e permissões
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  login VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMINISTRADOR', 'FINANCEIRO', 'CONSULTA', 'PERSONALIZADO')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_users_login_lower ON users (LOWER(login));

-- Sessões ativas (permite auditoria e encerramento remoto de sessões)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  ip_address VARCHAR(80),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions (token_hash);

-- Histórico de logins e tentativas de acesso
CREATE TABLE IF NOT EXISTS login_history (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  login_attempted VARCHAR(80) NOT NULL,
  success BOOLEAN NOT NULL,
  reason VARCHAR(200),
  ip_address VARCHAR(80),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history (user_id);

-- Tokens de recuperação de senha
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Base oficial de municípios brasileiros (IBGE)
CREATE TABLE IF NOT EXISTS ibge_municipalities (
  ibge_code INTEGER PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  uf CHAR(2) NOT NULL,
  state_name VARCHAR(80) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ibge_uf_name ON ibge_municipalities (uf, name);
CREATE INDEX IF NOT EXISTS idx_ibge_name_lower ON ibge_municipalities (LOWER(name));

-- 1ª Aba: Despesas Mensais
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY,
  day DATE NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('Alimentação', 'Farmácia', 'Gerais', 'Combustíveis', 'Outros')),
  custom_description VARCHAR(255),
  invoice_number VARCHAR(60) NOT NULL DEFAULT '',
  original_amount NUMERIC(14, 2) NOT NULL CHECK (original_amount >= 0),
  discount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
  interest NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (interest >= 0),
  final_amount NUMERIC(14, 2) NOT NULL,
  expense_type VARCHAR(20) NOT NULL CHECK (expense_type IN ('Empresa', 'Pessoal')),
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (category <> 'Outros' OR (custom_description IS NOT NULL AND LENGTH(TRIM(custom_description)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_expenses_day ON expenses (day DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses (expense_type);

-- 2ª Aba: Viagens
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY,
  trip_group VARCHAR(20) NOT NULL CHECK (trip_group IN ('GP-A', 'GP-B', 'GP-C', 'GP-D', 'ALFA')),
  collaborator VARCHAR(160) NOT NULL,
  municipality_ibge_code INTEGER REFERENCES ibge_municipalities(ibge_code) ON DELETE SET NULL,
  municipality_name VARCHAR(160) NOT NULL,
  state_uf CHAR(2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('Espécie', 'PIX', 'Cartão')),
  departure_date DATE NOT NULL,
  departure_amount NUMERIC(14, 2) NOT NULL CHECK (departure_amount >= 0),
  return_date DATE,
  return_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (return_amount >= 0),
  times_count INTEGER NOT NULL DEFAULT 1 CHECK (times_count >= 1),
  people_count INTEGER NOT NULL CHECK (people_count >= 1),
  spent_amount NUMERIC(14, 2) NOT NULL,
  vpp NUMERIC(14, 2) NOT NULL,
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_trips_departure_date ON trips (departure_date DESC);
CREATE INDEX IF NOT EXISTS idx_trips_group ON trips (trip_group);
CREATE INDEX IF NOT EXISTS idx_trips_uf ON trips (state_uf);

-- 3ª Aba: Lembretes (Série recorrente + Ocorrências mensais)
CREATE TABLE IF NOT EXISTS reminder_series (
  id UUID PRIMARY KEY,
  description VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  default_amount NUMERIC(14, 2) NOT NULL CHECK (default_amount >= 0),
  account VARCHAR(20) NOT NULL CHECK (account IN ('PESSOAS', 'NAAP')),
  digit VARCHAR(10) NOT NULL CHECK (digit IN ('09', '10', 'PF')),
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY,
  series_id UUID REFERENCES reminder_series(id) ON DELETE CASCADE,
  competence_year INTEGER NOT NULL CHECK (competence_year >= 2000 AND competence_year <= 2100),
  competence_month INTEGER NOT NULL CHECK (competence_month >= 1 AND competence_month <= 12),
  due_date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  account VARCHAR(20) NOT NULL CHECK (account IN ('PESSOAS', 'NAAP')),
  digit VARCHAR(10) NOT NULL CHECK (digit IN ('09', '10', 'PF')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGA', 'SUSPENSA')),
  paid_date DATE,
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

-- Proteção contra duplicidade de obrigações na mesma competência
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_no_duplicate
  ON reminders (LOWER(TRIM(description)), account, digit, competence_year, competence_month);
CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders (due_date ASC);
CREATE INDEX IF NOT EXISTS idx_reminders_series ON reminders (series_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders (status);

-- 4ª Aba: Caixa (Movimentações de Entrada e Saída)
CREATE TABLE IF NOT EXISTS cash_entries (
  id UUID PRIMARY KEY,
  entry_date DATE NOT NULL,
  destination VARCHAR(200) NOT NULL,
  purpose VARCHAR(300) NOT NULL,
  entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('ENTRADA', 'SAIDA')),
  inflow NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (inflow >= 0),
  outflow NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (outflow >= 0),
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (
    (entry_type = 'ENTRADA' AND inflow > 0 AND outflow = 0)
    OR
    (entry_type = 'SAIDA' AND outflow > 0 AND inflow = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_cash_entries_date ON cash_entries (entry_date ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_type ON cash_entries (entry_type);

-- 5ª Aba: Conciliação Financeira
CREATE TABLE IF NOT EXISTS reconciliations (
  id UUID PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC(14, 2) NOT NULL,
  total_inflows NUMERIC(14, 2) NOT NULL,
  total_outflows NUMERIC(14, 2) NOT NULL,
  calculated_balance NUMERIC(14, 2) NOT NULL,
  checked_balance NUMERIC(14, 2),
  difference NUMERIC(14, 2),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'CONCILIADO', 'DIVERGENTE')),
  concluded BOOLEAN NOT NULL DEFAULT FALSE,
  justification TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  responsible_name VARCHAR(160) DEFAULT '',
  checked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_reconciliations_period ON reconciliations (period_start DESC, period_end DESC);

-- 6ª Aba: Fechamento Mensal
CREATE TABLE IF NOT EXISTS monthly_closings (
  id UUID PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  status VARCHAR(20) NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'FECHADO', 'REABERTO')),
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_personal_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_company_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_trips NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_inflows NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_outflows NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  closing_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  pending_reminders_count INTEGER NOT NULL DEFAULT 0,
  pending_reminders_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  reconciliation_status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  inconsistencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT DEFAULT '',
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name VARCHAR(160),
  closed_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_by_name VARCHAR(160),
  reopened_at TIMESTAMPTZ,
  reopen_justification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_closings_ym ON monthly_closings (year DESC, month DESC);

-- 7ª Aba: Auditoria e Histórico de Alterações (Imutável)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(160) NOT NULL,
  operation VARCHAR(40) NOT NULL CHECK (operation IN (
    'INCLUSAO',
    'EDICAO',
    'EXCLUSAO',
    'CANCELAMENTO',
    'REABERTURA',
    'ALTERACAO_PERMISSOES',
    'ALTERACAO_USUARIOS',
    'FECHAMENTO_MENSAL',
    'BACKUP',
    'RESTAURACAO',
    'CONFIGURACAO'
  )),
  module VARCHAR(60) NOT NULL,
  record_id VARCHAR(80),
  previous_value JSONB,
  new_value JSONB,
  description TEXT NOT NULL,
  ip_address VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs (module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs (operation);
