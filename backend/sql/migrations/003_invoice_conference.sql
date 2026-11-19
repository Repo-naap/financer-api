-- ============================================================================
-- FINANCER – Gestão Financeira e Contábil
-- Migração 003: Conferência de Notas Fiscais de Prestação de Serviço Contábil
-- Cadastro de Cidades, Órgãos/Fundos das Entidades e Lançamentos de Notas
-- ============================================================================

-- Cidades atendidas por empresa (pré-populada conforme regras NAAP, INFOR MANAGER e CONTABILITÁ)
CREATE TABLE IF NOT EXISTS invoice_cities (
  id UUID PRIMARY KEY,
  company_code VARCHAR(30) NOT NULL REFERENCES companies(code),
  name VARCHAR(160) NOT NULL,
  invoice_group VARCHAR(30) NOT NULL DEFAULT 'SEM_GRUPO'
    CHECK (invoice_group IN ('GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha', 'SEM_GRUPO')),
  agency VARCHAR(40) DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_cities_company_name_group
  ON invoice_cities (company_code, LOWER(TRIM(name)), invoice_group);
CREATE INDEX IF NOT EXISTS idx_invoice_cities_company ON invoice_cities (company_code, invoice_group, name);

-- Órgãos / Fundos das Entidades por empresa (PREFEITURA, SAÚDE, FMAS, FMDCA, EDUCAÇÃO, PM-FOLHA, etc.)
CREATE TABLE IF NOT EXISTS invoice_funds (
  id UUID PRIMARY KEY,
  company_code VARCHAR(30) NOT NULL REFERENCES companies(code),
  name VARCHAR(160) NOT NULL,
  default_account VARCHAR(40) DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_funds_company_name
  ON invoice_funds (company_code, LOWER(TRIM(name)));

-- Lançamentos de Notas Fiscais para Conferência
CREATE TABLE IF NOT EXISTS service_invoices (
  id UUID PRIMARY KEY,
  company_code VARCHAR(30) NOT NULL REFERENCES companies(code),
  invoice_number VARCHAR(60) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  city_name VARCHAR(160) NOT NULL,
  fund_name VARCHAR(160) NOT NULL,
  agency VARCHAR(40) DEFAULT '',
  bank_account VARCHAR(40) DEFAULT '',
  competence_year INTEGER NOT NULL CHECK (competence_year >= 2000 AND competence_year <= 2100),
  competence_month INTEGER NOT NULL CHECK (competence_month >= 1 AND competence_month <= 12),
  competence_slot VARCHAR(10) NOT NULL DEFAULT 'MES'
    CHECK (competence_slot IN ('JAN', 'FEV', 'MAR', 'PC', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'ORC', 'OUT', 'NOV', 'DEZ', 'MES')),
  invoice_group VARCHAR(30) NOT NULL DEFAULT 'SEM_GRUPO'
    CHECK (invoice_group IN ('GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha', 'SEM_GRUPO')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'EMITIDA', 'PG', 'CANCELADA')),
  received_date DATE,
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_invoices_company_number_year
  ON service_invoices (company_code, invoice_number, competence_year, competence_slot, LOWER(TRIM(city_name)), LOWER(TRIM(fund_name)));
CREATE INDEX IF NOT EXISTS idx_service_invoices_company_ym
  ON service_invoices (company_code, competence_year DESC, competence_month DESC);
CREATE INDEX IF NOT EXISTS idx_service_invoices_company_group
  ON service_invoices (company_code, invoice_group, city_name);

-- ============================================================================
-- Seed inicial das Cidades por Empresa e Grupo
-- ============================================================================

-- NAAP: GP-A (Cumaru, Capoeiras, Paranatama, Quipapá)
INSERT INTO invoice_cities (id, company_code, name, invoice_group) VALUES
  ('10000000-0000-4000-8000-000000000001', 'NAAP', 'Cumaru', 'GP-A'),
  ('10000000-0000-4000-8000-000000000002', 'NAAP', 'Capoeiras', 'GP-A'),
  ('10000000-0000-4000-8000-000000000003', 'NAAP', 'Paranatama', 'GP-A'),
  ('10000000-0000-4000-8000-000000000004', 'NAAP', 'Quipapá', 'GP-A'),
-- NAAP: GP-B (Serra Talhada, Gravatá, Serrita, Sirinhaém)
  ('10000000-0000-4000-8000-000000000005', 'NAAP', 'Serra Talhada', 'GP-B'),
  ('10000000-0000-4000-8000-000000000006', 'NAAP', 'Gravatá', 'GP-B'),
  ('10000000-0000-4000-8000-000000000007', 'NAAP', 'Serrita', 'GP-B'),
  ('10000000-0000-4000-8000-000000000008', 'NAAP', 'Sirinhaém', 'GP-B'),
-- NAAP: GP-C (Tacaratu, Brejão, Câmara de Cumaru, Câmara de Brejo da Madre de Deus)
  ('10000000-0000-4000-8000-000000000009', 'NAAP', 'Tacaratu', 'GP-C'),
  ('10000000-0000-4000-8000-000000000010', 'NAAP', 'Brejão', 'GP-C'),
  ('10000000-0000-4000-8000-000000000011', 'NAAP', 'Câmara de Cumaru', 'GP-C'),
  ('10000000-0000-4000-8000-000000000012', 'NAAP', 'Câmara de Brejo da Madre de Deus', 'GP-C'),
-- NAAP: GP-D (Águas Belas, Itamaracá, Petrolândia, Belo Jardim)
  ('10000000-0000-4000-8000-000000000013', 'NAAP', 'Águas Belas', 'GP-D'),
  ('10000000-0000-4000-8000-000000000014', 'NAAP', 'Itamaracá', 'GP-D'),
  ('10000000-0000-4000-8000-000000000015', 'NAAP', 'Petrolândia', 'GP-D'),
  ('10000000-0000-4000-8000-000000000016', 'NAAP', 'Belo Jardim', 'GP-D'),
-- NAAP: RH-Folha (Vitória de Santo Antão, Timbaúba, Gravatá (PM-Folha))
  ('10000000-0000-4000-8000-000000000017', 'NAAP', 'Vitória de Santo Antão', 'RH-Folha'),
  ('10000000-0000-4000-8000-000000000018', 'NAAP', 'Timbaúba', 'RH-Folha'),
  ('10000000-0000-4000-8000-000000000019', 'NAAP', 'Gravatá', 'RH-Folha'),

-- INFOR MANAGER: todas as mesmas cidades + João Alfredo, Amaraji e Glória do Goitá (sem definição por grupos)
  ('20000000-0000-4000-8000-000000000001', 'INFOR_MANAGER', 'Cumaru', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000002', 'INFOR_MANAGER', 'Capoeiras', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000003', 'INFOR_MANAGER', 'Paranatama', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000004', 'INFOR_MANAGER', 'Quipapá', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000005', 'INFOR_MANAGER', 'Serra Talhada', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000006', 'INFOR_MANAGER', 'Gravatá', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000007', 'INFOR_MANAGER', 'Serrita', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000008', 'INFOR_MANAGER', 'Sirinhaém', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000009', 'INFOR_MANAGER', 'Tacaratu', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000010', 'INFOR_MANAGER', 'Brejão', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000011', 'INFOR_MANAGER', 'Câmara de Cumaru', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000012', 'INFOR_MANAGER', 'Câmara de Brejo da Madre de Deus', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000013', 'INFOR_MANAGER', 'Águas Belas', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000014', 'INFOR_MANAGER', 'Itamaracá', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000015', 'INFOR_MANAGER', 'Petrolândia', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000016', 'INFOR_MANAGER', 'Belo Jardim', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000017', 'INFOR_MANAGER', 'Vitória de Santo Antão', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000018', 'INFOR_MANAGER', 'Timbaúba', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000019', 'INFOR_MANAGER', 'João Alfredo', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000020', 'INFOR_MANAGER', 'Amaraji', 'SEM_GRUPO'),
  ('20000000-0000-4000-8000-000000000021', 'INFOR_MANAGER', 'Glória do Goitá', 'SEM_GRUPO'),

-- CONTABILITÁ: apenas Timbaúba inicialmente
  ('30000000-0000-4000-8000-000000000001', 'CONTABILITA', 'Timbaúba', 'SEM_GRUPO')
ON CONFLICT DO NOTHING;

-- Seed inicial dos Órgãos / Fundos das Entidades para as 3 empresas
INSERT INTO invoice_funds (id, company_code, name, display_order) VALUES
  ('40000000-0000-4000-8000-000000000001', 'NAAP', 'PREFEITURA', 1),
  ('40000000-0000-4000-8000-000000000002', 'NAAP', 'SAÚDE', 2),
  ('40000000-0000-4000-8000-000000000003', 'NAAP', 'FMAS', 3),
  ('40000000-0000-4000-8000-000000000004', 'NAAP', 'FMDCA', 4),
  ('40000000-0000-4000-8000-000000000005', 'NAAP', 'EDUCAÇÃO', 5),
  ('40000000-0000-4000-8000-000000000006', 'NAAP', 'PM-FOLHA', 6),
  ('40000000-0000-4000-8000-000000000007', 'NAAP', 'CÂMARA', 7),

  ('40000000-0000-4000-8000-000000000101', 'INFOR_MANAGER', 'PREFEITURA', 1),
  ('40000000-0000-4000-8000-000000000102', 'INFOR_MANAGER', 'SAÚDE', 2),
  ('40000000-0000-4000-8000-000000000103', 'INFOR_MANAGER', 'FMAS', 3),
  ('40000000-0000-4000-8000-000000000104', 'INFOR_MANAGER', 'FMDCA', 4),
  ('40000000-0000-4000-8000-000000000105', 'INFOR_MANAGER', 'EDUCAÇÃO', 5),
  ('40000000-0000-4000-8000-000000000106', 'INFOR_MANAGER', 'PM-FOLHA', 6),
  ('40000000-0000-4000-8000-000000000107', 'INFOR_MANAGER', 'CÂMARA', 7),

  ('40000000-0000-4000-8000-000000000201', 'CONTABILITA', 'PREFEITURA', 1),
  ('40000000-0000-4000-8000-000000000202', 'CONTABILITA', 'SAÚDE', 2),
  ('40000000-0000-4000-8000-000000000203', 'CONTABILITA', 'FMAS', 3),
  ('40000000-0000-4000-8000-000000000204', 'CONTABILITA', 'FMDCA', 4),
  ('40000000-0000-4000-8000-000000000205', 'CONTABILITA', 'EDUCAÇÃO', 5),
  ('40000000-0000-4000-8000-000000000206', 'CONTABILITA', 'PM-FOLHA', 6),
  ('40000000-0000-4000-8000-000000000207', 'CONTABILITA', 'CÂMARA', 7)
ON CONFLICT DO NOTHING;
