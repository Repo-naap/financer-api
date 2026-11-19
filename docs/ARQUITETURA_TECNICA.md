# FINANCER – Arquitetura Técnica

## 1. Visão Geral da Arquitetura

O FINANCER segue uma arquitetura modular em camadas separando claramente interface visual, API REST, regras financeiras puras e persistência em banco relacional PostgreSQL:

- **Frontend (`frontend/`):** React 19 + TypeScript + Vite + Tailwind CSS + Recharts + Lucide Icons. Responsivo para desktop, tablet e celular.
- **Backend (`backend/`):** Node.js 22 + TypeScript + Express + Zod + Helmet + Express Rate Limit.
- **Camada de Domínio Financeiro (`backend/src/domain/`):** Funções puras, desacopladas de HTTP e UI, contendo todos os cálculos financeiros (`calculations.ts`), matriz de permissões (`permissions.ts`), proteção de fechamento (`periodLock.ts`) e formatação brasileira (`formatters.ts`).
- **Camada de Serviços (`backend/src/services/`):**
  - `authService.ts`: Hashing seguro de senhas com `crypto.scrypt` (salt aleatório de 16 bytes + `timingSafeEqual`), sessões persistidas em banco com token HMAC-SHA256 e revogação individual/global.
  - `auditService.ts`: Registro imutável de auditoria com sanitização de campos sensíveis.
  - `closingService.ts`: Conferência prévia, fechamento transacional, transporte automático de saldo e reabertura auditada.
  - `exportService.ts`: Geração de relatórios reais em PDF (`pdfkit`), Excel editável com fórmulas (`exceljs`) e Word editável (`docx`).
  - `backupService.ts`: Backup lógico completo com checksum SHA-256 e restauração atômica transacional.
- **Banco de Dados (`backend/sql/migrations/`):** PostgreSQL 16 centralizado com migrações SQL versionadas (`schema_migrations`), arquitetura **multi-empresa** (`companies`: `NAAP`, `INFOR_MANAGER`, `CONTABILITA`) com coluna `company_code` em todas as tabelas financeiras e auditoria garantindo isolamento completo, chaves estrangeiras, índices de busca, `CHECK` constraints de integridade e controle de concorrência otimista (`version`).

## 2. Controle de Concorrência Multiusuário

Todos os registros financeiros (`expenses`, `trips`, `reminders`, `cash_entries`, `reconciliations`, `monthly_closings`, `users`) possuem coluna `version` incrementada a cada atualização. Quando dois usuários editam o mesmo registro simultaneamente, o servidor compara a `version` enviada com a atual no PostgreSQL e rejeita gravações defasadas com HTTP `409 Conflict` (`CONCURRENCY_CONFLICT`), evitando sobrescrita silenciosa de dados.

## 3. Base Oficial de Municípios (IBGE)

A tabela `ibge_municipalities` é populada automaticamente no boot com os **5.571 municípios oficiais do IBGE** (`backend/sql/seed_ibge_municipios.json`) e pode ser sincronizada online a qualquer momento por meio do endpoint `POST /api/trips/municipalities/sync` (que consulta a API oficial `servicodados.ibge.gov.br`).

## 4. Evolução e Extensibilidade

Novos módulos podem ser adicionados seguindo o padrão:
1. Criar nova migração incremental em `backend/sql/migrations/002_...sql`;
2. Adicionar regras puras em `backend/src/domain/`;
3. Criar rota em `backend/src/routes/` protegida por `requireAuth` e `requirePermission`;
4. Registrar novo item na matriz de permissões e no menu lateral do frontend.
