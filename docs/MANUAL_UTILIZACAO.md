# FINANCER – Manual de Utilização do Sistema

Guia prático de operação diária do **FINANCER – Gestão Financeira** (Multi-Empresa).

## 0. Seleção de Empresa e Identidade Visual
No ato do login, o usuário seleciona qual empresa deseja acessar (dentre aquelas autorizadas pelo Administrador):
- **NAAP** — Layout em tons de **Roxo / Lilás / Violeta**.
- **INFOR MANAGER** — Layout em tons de **Azul Marinho e subtons**.
- **CONTABILITÁ** — Layout em tons de **Bordô e subtons**.

Todos os dados (dashboard, despesas, viagens, lembretes, caixa, conciliação, fechamento mensal, auditoria, relatórios e exportações PDF/Excel/Word) ficam **100% separados por empresa**. Usuários autorizados para mais de uma empresa também podem alternar rapidamente no seletor **Empresa Ativa** no topo do menu lateral.

---

## 1. Painel Inicial (Dashboard)
- Selecione o período desejado: **Mensal**, **Trimestral** ou **Anual**.
- Acompanhe os **11 indicadores financeiros** atualizados automaticamente a cada lançamento.
- **Detalhamento (Drill-down):** clique em qualquer cartão de indicador ou barra/fatia dos 6 gráficos para visualizar a lista exata dos lançamentos que compõem aquele valor (respeitando suas permissões de acesso).
- Consulte o bloco de **Alertas de Contas e Próximos Vencimentos** em destaque no painel.

## 2. Despesas Mensais
- Clique em **Novo Lançamento**, preencha **Dia**, **Despesa** (`Alimentação`, `Farmácia`, `Gerais`, `Combustíveis` ou `Outros`), **Nota Fiscal** (somente números), **Valor Original**, **Desconto**, **Juros** e **Tipo** (`Empresa` ou `Pessoal`).
- Ao escolher **Outros**, o campo **Descrição da Despesa** aparece automaticamente e torna-se obrigatório.
- O sistema calcula automaticamente: `Valor Final = Valor Original - Desconto + Juros`.
- Clique em **Filtros e Relatório** para abrir a tela dedicada de filtros combinados (período, categoria, tipo, nota fiscal), visualizar subtotais por categoria/tipo e exportar em **PDF**, **Excel (.xlsx com fórmulas)** ou **Word (.docx)**.

## 3. Viagens
- Clique em **Nova Viagem**, informe **Grupo** (`GP-A`, `GP-B`, `GP-C`, `GP-D`, `ALFA`), **Colaborador**, selecione o **Município Brasileiro** (base oficial do IBGE filtrável por Estado/UF e pesquisável pelo nome; use **Atualizar lista IBGE** quando desejar sincronizar com a API oficial do IBGE), **Forma de Pagamento** (`Espécie`, `PIX`, `Cartão`), datas/valores de saída e devolução, **Vezes** e **Pessoas** (obrigatório > 0).
- Cálculos automáticos: `Valor Gasto = Valor de Saída - Valor de Devolução` e `VPP = Valor Gasto ÷ Pessoas`.
- Use **Filtros e Relatório** para combinar filtros e exportar em **PDF** ou **Excel (.xlsx com fórmulas)**.

## 4. Lembretes
- Clique em **Nova Obrigação Recorrente**, informe **Data Inicial**, **Data Final**, **Descrição**, **Valor Mensal**, **Conta** (`PESSOAS` ou `NAAP`) e **Dígito** (`09`, `10`, `PF`).
- O sistema gera automaticamente todos os compromissos mensais do intervalo sem permitir duplicidades.
- Em cada ocorrência você pode:
  - **Marcar como Paga** informando a data efetiva do pagamento e observações;
  - **Estornar pagamento** (caso pago por engano);
  - **Editar apenas esta ocorrência** ou **alterar todas as ocorrências futuras não pagas**;
  - **Suspender/Reativar** recorrências futuras;
  - **Excluir** uma ocorrência individual ou toda a série.
- Cores de situação: **Verde** (Paga), **Vermelho** (Vencida), **Amarelo** (Próximo do vencimento), **Roxo** (Pendente), **Cinza** (Suspensa).

## 5. Caixa
- Escolha a visualização **Mensal**, **Anual** ou **Período Livre**.
- Clique em **Nova Movimentação**, escolha **Entrada (+)** ou **Saída (-)** (nunca simultâneas), informe **Data**, **Destino/Responsável**, **Finalidade** e **Valor**.
- O **Saldo Inicial** do período considera automaticamente o saldo inicial configurado no sistema somado a todas as movimentações anteriores ao período selecionado.
- Exporte em **PDF**, **Excel (.xlsx)** ou **Word (.docx)**.

## 5.1. Conferência de Notas (Prestação de Serviço Contábil)
- Controle das notas fiscais emitidas por cidade, fundo/órgão da entidade (`PREFEITURA`, `SAÚDE`, `FMAS`, `FMDCA`, `EDUCAÇÃO`, `PM-FOLHA`, `CÂMARA` e novos órgãos cadastráveis) e mês/ano de competência (incluindo colunas especiais `PC` e `ORÇ.`).
- Na **NAAP**, as cidades e relatórios são separados automaticamente por grupos (`GP-A`, `GP-B`, `GP-C`, `GP-D` e `RH-Folha`). Na **INFOR MANAGER** (incluindo João Alfredo, Amaraji e Glória do Goitá) e na **CONTABILITÁ** (Timbaúba), a visualização é organizada diretamente por cidade.
- Use a sub-aba **Cadastrar Cidades e Órgãos** para incluir novas cidades e novos órgãos/fundos a qualquer momento.
- Na sub-aba **Planilha de Conferência**, visualize o mapa anual idêntico à planilha de conferência (`PG` em destaque azul-claro e `Nº Nota/DD.MM` em `DATA DE RECEB.`) e exporte em **Excel (.xlsx matricial separado por grupos)**, **PDF** ou **Word (.docx)**.

## 6. Conciliação Financeira
- Clique em **Nova Conferência / Conciliação** e selecione o período.
- O FINANCER exibe automaticamente **Saldo Inicial**, **Entradas**, **Saídas** e **Saldo Calculado**.
- Informe o **Saldo Efetivamente Conferido**:
  - Se igual ao saldo calculado &rarr; **CONCILIADO**;
  - Se diferente &rarr; **DIVERGENTE** (exige justificativa detalhada para marcar como concluída);
  - Se não informado &rarr; **PENDENTE**.
- Exporte o relatório de conciliação em **PDF** ou **Excel**.

## 7. Fechamento Mensal
- Selecione o mês e ano desejados.
- Revise os alertas/inconsistências e o resumo completo (despesas pessoais/empresariais, viagens, caixa, contas pendentes e conciliação).
- Clique em **Confirmar Fechamento Mensal**:
  - Todos os lançamentos daquele mês ficam **protegidos contra inclusão, edição e exclusão**;
  - O saldo final é **transportado automaticamente** como saldo inicial do mês seguinte.
- Caso seja necessário corrigir algo em um mês fechado, apenas um **Administrador** pode clicar em **Reabrir Período**, informando justificativa obrigatória registrada na Auditoria.

## 8. Auditoria
- Exclusiva de usuários autorizados (Administradores).
- Consulte todas as inclusões, edições, exclusões, fechamentos, reaberturas e alterações de usuários/permissões.
- Clique no ícone de visualização para comparar lado a lado o **Valor Anterior** e o **Valor Novo**.
- Exporte o histórico filtrado em **PDF** ou **Excel**.

## 9. Relatórios Gerais
- Área centralizada para filtrar e exportar relatórios de todos os 7 módulos operacionais em um só lugar.

## 10. Configurações
- **Usuários e Permissões:** cadastre usuários, configure perfis ou permissões personalizadas por aba e gere códigos de recuperação de senha.
- **Escritório e Parâmetros:** atualize o nome do escritório exibido nos relatórios, saldo inicial do caixa e dias de alerta.
- **Segurança, Sessões e Logins:** altere sua senha, acompanhe o histórico de tentativas de login e encerre sessões ativas remotamente.
- **Backup, Restauração e Servidor:** monitore o status do servidor/banco, gere backups verificados por SHA-256, baixe cópias de segurança ou restaure backups anteriores.

## 11. Importar Dados (Excel, CSV e PDF)
- **Upload Inteligente (múltiplos arquivos):** arraste ou selecione uma ou várias planilhas antigas **`.xlsx`**, **`.csv`** ou arquivos **`.pdf`** de uma só vez.
- **Identificação Automática:** o sistema analisa os cabeçalhos e o layout de cada arquivo (inclusive planilhas anuais matriciais de Conferência de Notas no formato `JAN..DEZ`, `PC`, `ORÇ.`, `PG` e `DATA DE RECEB.`) e identifica automaticamente para qual aba cada arquivo deve ir (**Despesas Mensais**, **Viagens**, **Lembretes**, **Caixa** ou **Conferência de Notas**), exibindo o nível de confiança (`ALTA`, `MÉDIA` ou `BAIXA`) e permitindo ajustar o destino manualmente se desejar.
- **Prévia e Segurança:** antes de gravar, visualize todos os registros lidos, totais estimados e eventuais alertas. Ao confirmar, os dados são gravados exclusivamente na empresa ativa (**NAAP**, **INFOR MANAGER** ou **CONTABILITÁ**), ignorando automaticamente duplicidades e períodos já fechados, com registro completo na Auditoria.
- **Planilhas Modelo:** caso queira organizar novos lotes, há botões para baixar modelos `.xlsx` prontos de cada módulo.
