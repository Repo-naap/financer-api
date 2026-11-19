-- ============================================================================
-- FINANCER – Gestão Financeira e Contábil
-- Migração 002: Suporte Multi-Empresa (NAAP, INFOR MANAGER e CONTABILITÁ)
-- com isolamento total de dados, parâmetros próprios e temas visuais.
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
  code VARCHAR(30) PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  theme VARCHAR(30) NOT NULL CHECK (theme IN ('purple', 'navy', 'burgundy')),
  office_document VARCHAR(40) DEFAULT '',
  office_email VARCHAR(200) DEFAULT '',
  office_phone VARCHAR(40) DEFAULT '',
  initial_cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  due_alert_days INTEGER NOT NULL DEFAULT 5 CHECK (due_alert_days >= 0 AND due_alert_days <= 60),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO companies (code, name, theme)
VALUES
  ('NAAP', 'NAAP', 'purple'),
  ('INFOR_MANAGER', 'INFOR MANAGER', 'navy'),
  ('CONTABILITA', 'CONTABILITÁ', 'burgundy')
ON CONFLICT (code) DO NOTHING;

-- Sincroniza parâmetros existentes do system_config para a NAAP caso já configurada
UPDATE companies c
SET
  office_document = COALESCE(NULLIF(sc.office_document, ''), c.office_document),
  office_email = COALESCE(NULLIF(sc.office_email, ''), c.office_email),
  office_phone = COALESCE(NULLIF(sc.office_phone, ''), c.office_phone),
  initial_cash_balance = sc.initial_cash_balance,
  due_alert_days = sc.due_alert_days
FROM system_config sc
WHERE c.code = 'NAAP' AND sc.id = 1 AND sc.setup_completed = TRUE;

-- Empresas permitidas por usuário
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_companies JSONB NOT NULL DEFAULT '["NAAP","INFOR_MANAGER","CONTABILITA"]'::jsonb;

-- Vincular sessões e histórico de login à empresa selecionada
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);

ALTER TABLE login_history
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) DEFAULT 'NAAP';

-- Isolamento por empresa nas tabelas financeiras e auditoria
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_expenses_company_day ON expenses (company_code, day DESC);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_trips_company_date ON trips (company_code, departure_date DESC);

ALTER TABLE reminder_series
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_reminder_series_company ON reminder_series (company_code);

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_reminders_company_due ON reminders (company_code, due_date ASC);

-- Atualizar CHECK de account em reminder_series e reminders para aceitar cada empresa
ALTER TABLE reminder_series DROP CONSTRAINT IF EXISTS reminder_series_account_check;
ALTER TABLE reminder_series
  ADD CONSTRAINT reminder_series_account_check
  CHECK (account IN ('PESSOAS', 'NAAP', 'INFOR MANAGER', 'CONTABILITÁ'));

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_account_check;
ALTER TABLE reminders
  ADD CONSTRAINT reminders_account_check
  CHECK (account IN ('PESSOAS', 'NAAP', 'INFOR MANAGER', 'CONTABILITÁ'));

-- Recriar unicidade de lembretes isolada por empresa
DROP INDEX IF EXISTS uq_reminders_no_duplicate;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_no_duplicate
  ON reminders (company_code, LOWER(TRIM(description)), account, digit, competence_year, competence_month);

ALTER TABLE cash_entries
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_cash_entries_company_date ON cash_entries (company_code, entry_date ASC, created_at ASC);

ALTER TABLE reconciliations
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_reconciliations_company ON reconciliations (company_code, period_end DESC);

ALTER TABLE monthly_closings
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
ALTER TABLE monthly_closings DROP CONSTRAINT IF EXISTS monthly_closings_year_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_closings_company_ym
  ON monthly_closings (company_code, year, month);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS company_code VARCHAR(30) NOT NULL DEFAULT 'NAAP' REFERENCES companies(code);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON audit_logs (company_code, created_at DESC);
