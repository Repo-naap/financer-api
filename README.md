# FINANCER – Gestão Financeira e Contábil

Sistema profissional web **multi-empresa** de gestão financeira e contábil desenvolvido para escritórios de assessoria administrativa e contábil, atendendo de forma totalmente isolada às empresas **NAAP** (tema roxo/lilás), **INFOR MANAGER** (tema azul marinho) e **CONTABILITÁ** (tema bordô), com banco de dados centralizado **PostgreSQL**, acesso multiusuário simultâneo, seleção da empresa no ato do login, controle granular de permissões, fechamento mensal protegido, auditoria imutável e exportações reais em **PDF**, **Excel (.xlsx com fórmulas)** e **Word (.docx)** na identidade visual de cada empresa.

## Módulos Implementados (12 Abas)

1. **Painel Inicial (Dashboard)** – 11 indicadores financeiros clicáveis (drill-down), 6 gráficos interativos, filtros Mensal/Trimestral/Anual e painel de alertas de vencimento.
2. **Despesas Mensais** – Categorias (`Alimentação`, `Farmácia`, `Gerais`, `Combustíveis`, `Outros` com descrição obrigatória), NF numérica, desconto, juros, cálculo automático (`Valor original - Desconto + Juros`), separação Empresa/Pessoal, tela dedicada de filtros, subtotais e exportação em PDF, Excel (com fórmulas) e Word.
3. **Viagens** – Grupos (`GP-A`, `GP-B`, `GP-C`, `GP-D`, `ALFA`), base oficial completa dos **5.571 municípios brasileiros do IBGE** pesquisável por estado (UF) com atualização online pela API do IBGE, cálculo automático de **Valor Gasto** e **VPP** (bloqueio de divisão por zero), filtros combinados e exportação em PDF e Excel (com fórmulas).
4. **Lembretes** – Controle de obrigações recorrentes (`PESSOAS` / `NAAP`, dígitos `09`, `10`, `PF`), geração automática de competências mensais sem duplicidade, edição individual ou de ocorrências futuras, suspensão/reativação, baixa com data efetiva, alertas coloridos e exportação em PDF, Excel e Word.
5. **Caixa** – Movimentações exclusivas de Entrada (+) ou Saída (-), saldo acumulado automático considerando movimentações anteriores ao período selecionado, relatórios mensais/anuais/livres e exportação em PDF, Excel e Word.
6. **Conferência de Notas** – Controle de notas fiscais de prestação de serviço contábil (número da nota, valor, cidade, fundo/órgão, mês/ano, grupos `GP-A` a `RH-Folha` na NAAP e livre por cidade na INFOR MANAGER/CONTABILITÁ), cadastro expansível de cidades e órgãos/fundos, planilha anual matricial por grupos (`JAN..DEZ`, `PC`, `ORÇ.`) e exportação em Excel matricial, PDF e Word.
7. **Importar Dados** – Upload inteligente de planilhas antigas **Excel (`.xlsx` / `.csv`)** e relatórios **PDF (`.pdf`)** com identificação automática do módulo de destino (Despesas, Viagens, Lembretes, Caixa ou Conferência de Notas — inclusive planilhas matriciais anuais `JAN..DEZ / PG / DATA DE RECEB.`), prévia detalhada, proteção contra duplicidades, respeito ao bloqueio de períodos fechados, registro em auditoria e planilhas modelo para download.
8. **Conciliação Financeira** – Conferência automática entre saldo calculado pelo sistema e saldo real conferido, cálculo de diferença, status automático (`CONCILIADO`, `DIVERGENTE`, `PENDENTE`), exigência de justificativa para concluir divergências e exportação em PDF e Excel.
9. **Fechamento Mensal** – Conferência prévia de inconsistências, bloqueio efetivo contra alterações/exclusões no período fechado, transporte automático do saldo final para o mês seguinte e reabertura exclusiva do Administrador com justificativa obrigatória e registro em auditoria.
10. **Auditoria** – Histórico automático e imutável de todas as operações (usuário, data/hora, operação, aba, valor anterior e valor novo), filtros e exportação em PDF e Excel.
11. **Relatórios Gerais** – Central unificada com cabeçalho institucional do escritório, paginação em PDF, fórmulas em Excel e tabelas editáveis em Word.
12. **Configurações** – Perfis (`ADMINISTRADOR`, `FINANCEIRO`, `CONSULTA`, `PERSONALIZADO`), matriz granular de permissões por aba e ação, acesso por empresa, sessões ativas, histórico de logins, recuperação de senha, parâmetros da empresa e backup/restauração verificados por SHA-256.

## Início Rápido

### Opção 1: Servidor Online com Docker + PostgreSQL + HTTPS (Recomendado)
```bash
./scripts/install-linux.sh
```
Ou manualmente:
```bash
cp .env.example .env
docker compose up -d --build
```

### Opção 2: Execução Local com Node.js 20+
```bash
npm run install:all
npm run build
npm start
```
Acesse `http://localhost:3001` no navegador e complete o **Assistente de Primeiro Acesso** (o sistema não utiliza senhas padrão).

## Documentação Completa

- [Manual de Instalação, Banco de Dados e Publicação Online](docs/MANUAL_INSTALACAO_E_PUBLICACAO.md)
- [Manual de Utilização das 10 Abas](docs/MANUAL_UTILIZACAO.md)
- [Documentação de Arquitetura Técnica](docs/ARQUITETURA_TECNICA.md)
