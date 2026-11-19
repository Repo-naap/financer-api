import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createDbClient, setDbForTesting, closeDb, DbClient } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedIbgeMunicipalitiesIfEmpty } from '../src/db/ibgeSeed.js';
import { createApp } from '../src/app.js';

describe('FINANCER - Suite End-to-End Completa (PostgreSQL + API + Exportações + Segurança)', () => {
  let db: DbClient;
  let app: ReturnType<typeof createApp>;
  let adminToken = '';
  let financeToken = '';
  let consultaToken = '';
  let consultaUserId = '';
  let expenseId = '';
  let tripId = '';
  let reminderIds: string[] = [];
  let savedBackupPayload: unknown = null;

  beforeAll(async () => {
    db = createDbClient('pglite://memory', false);
    setDbForTesting(db);
    await runMigrations(db);
    await seedIbgeMunicipalitiesIfEmpty(db);
    app = createApp();
  }, 60000);

  afterAll(async () => {
    await closeDb();
  });

  it('1. Primeiro acesso (Setup Wizard) sem senhas padrão e criação do administrador', async () => {
    const statusBefore = await request(app).get('/api/setup/status').expect(200);
    expect(statusBefore.body.setupCompleted).toBe(false);

    const init = await request(app)
      .post('/api/setup/initialize')
      .send({
        officeName: 'Assessoria Contábil Horizonte Ltda',
        officeDocument: '12.345.678/0001-99',
        initialCashBalance: 1000,
        dueAlertDays: 5,
        adminName: 'Maria Administradora',
        adminLogin: 'maria.admin',
        adminPassword: 'SenhaSuperSegura!2026',
      })
      .expect(201);

    expect(init.body.token).toBeTruthy();
    expect(init.body.user.role).toBe('ADMINISTRADOR');
    adminToken = init.body.token;

    // Impede rodar setup novamente
    await request(app)
      .post('/api/setup/initialize')
      .send({
        officeName: 'Outro',
        adminName: 'Hacker',
        adminLogin: 'hacker',
        adminPassword: 'Password123!',
      })
      .expect(409);
  });

  it('2. Cadastro de usuários (Financeiro, Consulta), permissões, bloqueio de inativo e recuperação de senha', async () => {
    const finRes = await request(app)
      .post('/api/settings/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'João Financeiro',
        login: 'joao.fin',
        password: 'FinPassword!2026',
        role: 'FINANCEIRO',
      })
      .expect(201);
    expect(finRes.body.role).toBe('FINANCEIRO');

    const consRes = await request(app)
      .post('/api/settings/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ana Consulta',
        login: 'ana.cons',
        password: 'ConsPassword!2026',
        role: 'CONSULTA',
      })
      .expect(201);
    consultaUserId = consRes.body.id;

    // Login simultâneo de múltiplos usuários
    const loginFin = await request(app)
      .post('/api/auth/login')
      .send({ login: 'joao.fin', password: 'FinPassword!2026' })
      .expect(200);
    financeToken = loginFin.body.token;

    const loginCons = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana.cons', password: 'ConsPassword!2026' })
      .expect(200);
    consultaToken = loginCons.body.token;

    // Consulta NÃO pode cadastrar despesas (403)
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${consultaToken}`)
      .send({
        day: '2026-01-10',
        category: 'Alimentação',
        original_amount: 100,
        expense_type: 'Empresa',
      })
      .expect(403);

    // Recuperação de senha via código seguro
    const codeRes = await request(app)
      .post(`/api/settings/users/${consultaUserId}/reset-code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(codeRes.body.resetCode).toBeTruthy();

    await request(app)
      .post('/api/auth/reset-password')
      .send({
        login: 'ana.cons',
        resetCode: codeRes.body.resetCode,
        newPassword: 'NovaSenhaAna!2026',
      })
      .expect(200);

    // Sessão antiga revogada após reset, novo login funciona
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${consultaToken}`)
      .expect(401);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ login: 'ana.cons', password: 'NovaSenhaAna!2026' })
      .expect(200);
    consultaToken = relogin.body.token;
  });

  it('3. Despesas Mensais: cálculos, "Outros", duplicidade, concorrência, filtros e exportações PDF/XLSX/DOCX', async () => {
    // "Outros" sem descrição deve ser bloqueado
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        day: '2026-01-10',
        category: 'Outros',
        original_amount: 200,
        expense_type: 'Empresa',
      })
      .expect(400);

    // Despesa Empresarial com desconto e juros
    const e1 = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        day: '2026-01-10',
        category: 'Alimentação',
        invoice_number: '102030',
        original_amount: 500,
        discount: 50,
        interest: 15,
        expense_type: 'Empresa',
      })
      .expect(201);
    expect(e1.body.final_amount).toBe(465);
    expenseId = e1.body.id;

    // Duplicidade bloqueada
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        day: '2026-01-10',
        category: 'Alimentação',
        invoice_number: '102030',
        original_amount: 500,
        discount: 50,
        interest: 15,
        expense_type: 'Empresa',
      })
      .expect(409);

    // Despesa Pessoal na categoria Outros
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        day: '2026-01-15',
        category: 'Outros',
        custom_description: 'Material de papelaria pessoal',
        invoice_number: '9988',
        original_amount: 120,
        discount: 10,
        interest: 0,
        expense_type: 'Pessoal',
      })
      .expect(201);

    // Conflito de concorrência otimista (version desatualizada)
    await request(app)
      .put(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        day: '2026-01-10',
        category: 'Alimentação',
        invoice_number: '102030',
        original_amount: 550,
        discount: 50,
        interest: 15,
        expense_type: 'Empresa',
        version: 99,
      })
      .expect(409);

    // Filtros combinados
    const filtered = await request(app)
      .get('/api/expenses?expenseType=Empresa&category=Alimentação')
      .set('Authorization', `Bearer ${consultaToken}`)
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.summary.netTotal).toBe(465);

    // Exportação PDF, Excel com fórmulas, e Word
    const pdfRes = await request(app)
      .get('/api/expenses/export?format=pdf')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.slice(0, 4).toString()).toBe('%PDF');

    const xlsxRes = await request(app)
      .get('/api/expenses/export?format=xlsx')
      .set('Authorization', `Bearer ${financeToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxRes.body);
    const sheet = wb.getWorksheet('Relatório');
    expect(sheet).toBeTruthy();
    const formulaCell = sheet!.getCell('G7').value as { formula?: string };
    expect(formulaCell.formula).toBe('D7-E7+F7');

    const docxRes = await request(app)
      .get('/api/expenses/export?format=docx')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(docxRes.headers['content-type']).toContain('wordprocessingml');
  });

  it('4. Viagens: 5.570+ municípios IBGE, cálculo Valor Gasto e VPP, bloqueio divisão por zero e exportações', async () => {
    const munRes = await request(app)
      .get('/api/trips/municipalities?q=Recife&uf=PE')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(munRes.body.totalInDatabase).toBeGreaterThanOrEqual(5570);
    const recife = munRes.body.items.find((m: { name: string }) => m.name === 'Recife');
    expect(recife).toBeTruthy();

    // Pessoas = 0 deve ser bloqueado
    await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        trip_group: 'GP-A',
        collaborator: 'Carlos Silva',
        municipality_ibge_code: recife.ibge_code,
        payment_method: 'PIX',
        departure_date: '2026-01-12',
        departure_amount: 1000,
        return_amount: 200,
        times_count: 1,
        people_count: 0,
      })
      .expect(400);

    const created = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        trip_group: 'GP-A',
        collaborator: 'Carlos Silva',
        municipality_ibge_code: recife.ibge_code,
        payment_method: 'PIX',
        departure_date: '2026-01-12',
        departure_amount: 1000,
        return_date: '2026-01-14',
        return_amount: 200,
        times_count: 1,
        people_count: 4,
      })
      .expect(201);
    expect(created.body.spent_amount).toBe(800);
    expect(created.body.vpp).toBe(200);
    tripId = created.body.id;
    expect(tripId).toBeTruthy();

    await request(app)
      .get('/api/trips/export?format=xlsx')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    await request(app)
      .get('/api/trips/export?format=pdf')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
  });

  it('5. Lembretes: geração automática de 12 meses, bloqueio de duplicidade, edição futura e pagamento', async () => {
    const gen = await request(app)
      .post('/api/reminders')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        start_date: '2026-01-15',
        end_date: '2026-12-15',
        description: 'Conta mensal de serviço',
        amount: 500,
        account: 'NAAP',
        digit: '09',
      })
      .expect(201);
    expect(gen.body.createdCount).toBe(12);
    reminderIds = gen.body.items.map((i: { id: string }) => i.id);

    // Bloqueio de conta duplicada
    await request(app)
      .post('/api/reminders')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        start_date: '2026-01-15',
        end_date: '2026-03-15',
        description: 'Conta mensal de serviço',
        amount: 500,
        account: 'NAAP',
        digit: '09',
      })
      .expect(409);

    // Marcar Janeiro/2026 como pago
    await request(app)
      .post(`/api/reminders/${reminderIds[0]}/pay`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ paid_date: '2026-01-14', notes: 'Pago via PIX' })
      .expect(200);

    // Alterar ocorrências futuras a partir de Fevereiro para R$ 550,00
    const upd = await request(app)
      .put(`/api/reminders/${reminderIds[1]}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 550, scope: 'FUTURE' })
      .expect(200);
    expect(upd.body.updatedCount).toBe(11);
  });

  it('6. Caixa: bloqueio entrada+saída simultânea e saldo acumulado entre meses', async () => {
    // Bloqueia entrada e saída simultâneas
    await request(app)
      .post('/api/cash')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        entry_date: '2026-01-05',
        destination: 'Cliente X',
        purpose: 'Teste inválido',
        inflow: 500,
        outflow: 100,
      })
      .expect(400);

    // Saldo inicial do sistema = 1.000,00
    // Janeiro: +10.000,00 e -3.500,00 => Saldo final Jan = 7.500,00
    await request(app)
      .post('/api/cash')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        entry_date: '2026-01-05',
        destination: 'Honorários Clientes',
        purpose: 'Recebimento mensal de honorários',
        inflow: 10000,
        outflow: 0,
      })
      .expect(201);

    await request(app)
      .post('/api/cash')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        entry_date: '2026-01-20',
        destination: 'Fornecedor Energia',
        purpose: 'Pagamento energia elétrica',
        inflow: 0,
        outflow: 3500,
      })
      .expect(201);

    // Fevereiro: +2.000,00 => Saldo inicial Fev deve ser 7.500,00 e saldo final 9.500,00!
    await request(app)
      .post('/api/cash')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        entry_date: '2026-02-05',
        destination: 'Honorários Fev',
        purpose: 'Recebimento fevereiro',
        inflow: 2000,
        outflow: 0,
      })
      .expect(201);

    const febReport = await request(app)
      .get('/api/cash?reportMode=MENSAL&year=2026&month=2')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(febReport.body.summary.openingBalance).toBe(7500);
    expect(febReport.body.summary.totalInflows).toBe(2000);
    expect(febReport.body.summary.closingBalance).toBe(9500);
  });

  it('7. Conciliação Financeira: diferença automática e exigência de justificativa', async () => {
    const preview = await request(app)
      .get('/api/reconciliation/preview?periodStart=2026-01-01&periodEnd=2026-01-31')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(preview.body.calculatedBalance).toBe(7500);

    // Divergente sem justificativa não pode ser concluída
    await request(app)
      .post('/api/reconciliation')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        checked_balance: 7400,
        concluded: true,
        justification: '',
      })
      .expect(400);

    // Conciliada exatamente igual (7500)
    const ok = await request(app)
      .post('/api/reconciliation')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        checked_balance: 7500,
        concluded: true,
        notes: 'Conferido com extrato bancário e cofre.',
      })
      .expect(201);
    expect(ok.body.status).toBe('CONCILIADO');
    expect(ok.body.difference).toBe(0);
  });

  it('8. Fechamento Mensal: bloqueio do período fechado, transporte de saldo e reabertura exclusiva do Admin', async () => {
    const closed = await request(app)
      .post('/api/closing/2026/1/close')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ notes: 'Fechamento de Janeiro conferido.' })
      .expect(200);
    expect(closed.body.status).toBe('FECHADO');
    expect(closed.body.closingBalance).toBe(7500);

    // Verificar transporte automático do saldo inicial de Fevereiro
    const febSummary = await request(app)
      .get('/api/closing/2026/2')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(febSummary.body.openingBalance).toBe(7500);

    // Lançamentos em Janeiro agora estão BLOQUEADOS (423 Locked)
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        day: '2026-01-25',
        category: 'Gerais',
        original_amount: 50,
        expense_type: 'Empresa',
      })
      .expect(423);

    // Usuário Financeiro NÃO pode reabrir período fechado (403)
    await request(app)
      .post('/api/closing/2026/1/reopen')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ justification: 'Preciso ajustar um valor.' })
      .expect(403);

    // Admin sem justificativa é bloqueado (400)
    await request(app)
      .post('/api/closing/2026/1/reopen')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ justification: '' })
      .expect(400);

    // Admin com justificativa reabre com sucesso e registra auditoria
    const reopened = await request(app)
      .post('/api/closing/2026/1/reopen')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ justification: 'Ajuste contábil autorizado pela diretoria.' })
      .expect(200);
    expect(reopened.body.status).toBe('REABERTO');
  });

  it('9. Dashboard (11 indicadores + 6 gráficos + drill-down) e Auditoria imutável', async () => {
    const dash = await request(app)
      .get('/api/dashboard?period=MENSAL&year=2026&month=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(dash.body.indicators.totalCompanyExpenses).toBe(465);
    expect(dash.body.indicators.totalPersonalExpenses).toBe(110);
    expect(dash.body.indicators.totalTripsExpenses).toBe(800);
    expect(dash.body.indicators.totalCashInflows).toBe(10000);
    expect(dash.body.indicators.totalCashOutflows).toBe(3500);
    expect(dash.body.indicators.currentCashBalance).toBe(9500);
    expect(dash.body.charts.expensesByCategory.length).toBeGreaterThan(0);
    expect(dash.body.charts.monthlyExpenseEvolution).toHaveLength(12);

    const drill = await request(app)
      .get('/api/dashboard/drilldown?metric=company_expenses&period=MENSAL&year=2026&month=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(drill.body.items).toHaveLength(1);

    // Auditoria acessível apenas por admin (Consulta bloqueada)
    await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${consultaToken}`)
      .expect(403);

    const audit = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(audit.body.total).toBeGreaterThan(8);
    expect(audit.body.items.some((a: { operation: string }) => a.operation === 'REABERTURA')).toBe(
      true
    );
  });

  it('10. Backup completo e Restauração atômica verificada', async () => {
    const bkRes = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(bkRes.body.checksum).toBeTruthy();
    savedBackupPayload = bkRes.body.payload;

    // Exclui uma despesa após o backup
    await request(app)
      .delete(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const afterDel = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterDel.body.total).toBe(1);

    // Restaura o backup
    await request(app)
      .post('/api/settings/backups/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payload: savedBackupPayload })
      .expect(200);

    // Faz login novamente (sessões antigas revogadas na restauração) e confirma que a despesa voltou!
    const reloginAdmin = await request(app)
      .post('/api/auth/login')
      .send({ login: 'maria.admin', password: 'SenhaSuperSegura!2026' })
      .expect(200);
    adminToken = reloginAdmin.body.token;

    const afterRestore = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterRestore.body.total).toBe(2);
  });

  it('11. Multi-Empresa: isolamento total entre NAAP (Roxo), INFOR MANAGER (Azul Marinho) e CONTABILITÁ (Bordô)', async () => {
    const statusRes = await request(app).get('/api/setup/status').expect(200);
    expect(statusRes.body.companies).toHaveLength(3);
    expect(statusRes.body.companies.map((c: { code: string; theme: string }) => `${c.code}:${c.theme}`)).toEqual([
      'NAAP:purple',
      'INFOR_MANAGER:navy',
      'CONTABILITA:burgundy',
    ]);

    // Cria usuário restrito apenas à INFOR MANAGER e CONTABILITÁ
    await request(app)
      .post('/api/settings/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Lucas Infor',
        login: 'lucas.infor',
        password: 'InforPassword!2026',
        role: 'FINANCEIRO',
        allowed_companies: ['INFOR_MANAGER', 'CONTABILITA'],
      })
      .expect(201);

    // Tentativa de login na NAAP deve ser bloqueada (403)
    await request(app)
      .post('/api/auth/login')
      .send({ login: 'lucas.infor', password: 'InforPassword!2026', companyCode: 'NAAP' })
      .expect(403);

    // Login na INFOR MANAGER funciona com tema navy e dados 100% isolados da NAAP
    const loginInfor = await request(app)
      .post('/api/auth/login')
      .send({ login: 'lucas.infor', password: 'InforPassword!2026', companyCode: 'INFOR_MANAGER' })
      .expect(200);
    expect(loginInfor.body.company.name).toBe('INFOR MANAGER');
    expect(loginInfor.body.company.theme).toBe('navy');
    const inforToken = loginInfor.body.token;

    const inforExpensesBefore = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${inforToken}`)
      .expect(200);
    expect(inforExpensesBefore.body.total).toBe(0);

    // Cadastra despesa e lembrete com conta "INFOR MANAGER"
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${inforToken}`)
      .send({
        day: '2026-03-10',
        category: 'Gerais',
        original_amount: 350,
        expense_type: 'Empresa',
      })
      .expect(201);

    await request(app)
      .post('/api/reminders')
      .set('Authorization', `Bearer ${inforToken}`)
      .send({
        start_date: '2026-03-10',
        end_date: '2026-03-10',
        description: 'Licença Software',
        amount: 299.9,
        account: 'INFOR MANAGER',
        digit: '10',
      })
      .expect(201);

    // Troca sessão para CONTABILITÁ (tema burgundy) e confirma isolamento total
    const swCont = await request(app)
      .post('/api/auth/switch-company')
      .set('Authorization', `Bearer ${inforToken}`)
      .send({ companyCode: 'CONTABILITA' })
      .expect(200);
    expect(swCont.body.company.name).toBe('CONTABILITÁ');
    expect(swCont.body.company.theme).toBe('burgundy');

    const contExpenses = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${inforToken}`)
      .expect(200);
    expect(contExpenses.body.total).toBe(0);

    await request(app)
      .post('/api/reminders')
      .set('Authorization', `Bearer ${inforToken}`)
      .send({
        start_date: '2026-03-10',
        end_date: '2026-03-10',
        description: 'CRC Anuidade',
        amount: 420,
        account: 'CONTABILITÁ',
        digit: '09',
      })
      .expect(201);

    // NAAP continua vendo exatamente suas 2 despesas originais (nenhum vazamento)
    const naapExpenses = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(naapExpenses.body.total).toBe(2);
  });

  it('12. Conferência de Notas: catálogos NAAP/INFOR/CONTABILITÁ, lançamento, planilha por grupos e exportações', async () => {
    // 1. NAAP tem grupos (GP-A..RH-Folha) e 19 cidades cadastradas
    const naapCat = await request(app)
      .get('/api/invoices/catalogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(naapCat.body.usesGroups).toBe(true);
    expect(naapCat.body.cities.length).toBeGreaterThanOrEqual(19);
    expect(
      naapCat.body.cities.some(
        (c: { name: string; invoice_group: string }) =>
          c.name === 'Tacaratu' && c.invoice_group === 'GP-C'
      )
    ).toBe(true);

    // 2. Cadastrar nova cidade e novo órgão/fundo
    await request(app)
      .post('/api/invoices/cities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Caruaru', invoice_group: 'GP-A', agency: '1234' })
      .expect(201);

    await request(app)
      .post('/api/invoices/funds')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'FUNDEB', default_account: '9988-1' })
      .expect(201);

    // 3. Lançar nota de Tacaratu (GP-C) igual à planilha da imagem (3013 / 27.02)
    const inv = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        invoice_number: '3013',
        amount: 9968.01,
        city_name: 'Tacaratu',
        fund_name: 'PREFEITURA',
        agency: '2702',
        competence_year: 2026,
        competence_month: 1,
        competence_slot: 'MES',
        invoice_group: 'GP-C',
        status: 'PG',
        received_date: '2026-02-27',
      })
      .expect(201);
    expect(inv.body.invoice_number).toBe('3013');

    // 4. Conferir matriz por grupos
    const mat = await request(app)
      .get('/api/invoices/matrix?year=2026')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const gpC = mat.body.groups.find((g: { group_code: string }) => g.group_code === 'GP-C');
    expect(gpC).toBeTruthy();
    const tacaratu = gpC.cities.find((c: { city_name: string }) => c.city_name === 'Tacaratu');
    expect(tacaratu.funds[0].slots.JAN[0].display_bottom).toBe('3013/27.02');

    // 5. Exportar Excel matricial separado por grupos + PDF + Word
    const xlsxRes = await request(app)
      .get('/api/invoices/export?format=xlsx&year=2026')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxRes.body);
    expect(wb.getWorksheet('GP-C')).toBeTruthy();
    expect(wb.getWorksheet('RH-Folha')).toBeTruthy();

    await request(app)
      .get('/api/invoices/export?format=pdf&year=2026')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app)
      .get('/api/invoices/export?format=docx&year=2026')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 6. Verificar catálogos da INFOR MANAGER (21 cidades, sem grupos) e CONTABILITÁ (Timbaúba)
    await request(app)
      .post('/api/auth/switch-company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyCode: 'INFOR_MANAGER' })
      .expect(200);
    const inforCat = await request(app)
      .get('/api/invoices/catalogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(inforCat.body.usesGroups).toBe(false);
    expect(inforCat.body.cities.length).toBeGreaterThanOrEqual(21);
    expect(inforCat.body.cities.some((c: { name: string }) => c.name === 'João Alfredo')).toBe(true);

    await request(app)
      .post('/api/auth/switch-company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyCode: 'CONTABILITA' })
      .expect(200);
    const contCat = await request(app)
      .get('/api/invoices/catalogs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(contCat.body.usesGroups).toBe(false);
    expect(contCat.body.cities).toHaveLength(1);
    expect(contCat.body.cities[0].name).toBe('Timbaúba');
  });

  it('13. Importação Inteligente: auto-detecção e gravação de Excel (.xlsx tabular + matricial), CSV e PDF com proteção contra duplicidade', async () => {
    // Volta sessão do administrador para a NAAP
    await request(app)
      .post('/api/auth/switch-company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyCode: 'NAAP' })
      .expect(200);

    // 1. Excel tabular de Despesas Mensais -> detecta automaticamente "expenses"
    const expWb = new ExcelJS.Workbook();
    const expWs = expWb.addWorksheet('Despesas Antigas');
    expWs.addRow(['Dia', 'Despesa', 'Nota Fiscal', 'Valor Original', 'Desconto', 'Juros', 'Tipo']);
    expWs.addRow(['05/02/2026', 'Alimentação', '8801', 210.5, 10.5, 0, 'Empresa']);
    expWs.addRow(['08/02/2026', 'Internet Fibra', '8802', 199.9, 0, 5.1, 'Empresa']);
    const expBuf = Buffer.from(await expWb.xlsx.writeBuffer());

    const expAnalyze = await request(app)
      .post('/api/imports/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'planilha-antiga.xlsx',
        contentBase64: expBuf.toString('base64'),
        referenceYear: 2026,
      })
      .expect(200);
    expect(expAnalyze.body.detectedModule).toBe('expenses');
    expect(expAnalyze.body.confidence).toBe('ALTA');
    expect(expAnalyze.body.validCount).toBe(2);

    const expCommit = await request(app)
      .post('/api/imports/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetModule: expAnalyze.body.detectedModule,
        filename: 'planilha-antiga.xlsx',
        rows: expAnalyze.body.rows.map((r: { data: unknown }) => r.data),
      })
      .expect(201);
    expect(expCommit.body.importedCount).toBe(2);
    expect(expCommit.body.skippedDuplicates).toBe(0);

    // Re-importar o mesmo lote deve ignorar 100% como duplicados!
    const expCommitDup = await request(app)
      .post('/api/imports/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetModule: 'expenses',
        filename: 'planilha-antiga.xlsx',
        rows: expAnalyze.body.rows.map((r: { data: unknown }) => r.data),
      })
      .expect(201);
    expect(expCommitDup.body.importedCount).toBe(0);
    expect(expCommitDup.body.skippedDuplicates).toBe(2);

    // 2. Excel matricial de Conferência de Notas (estilo Tacaratu JAN..DEZ + PG + DATA DE RECEB.)
    const matWb = new ExcelJS.Workbook();
    const matWs = matWb.addWorksheet('GP-C');
    matWs.addRow(['Tacaratu', 'AGÊNCIA', 'R$', 'JAN', 'FEV', 'MAR', 'PC', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'ORÇ.', 'OUT', 'NOV', 'DEZ']);
    matWs.addRow(['SAÚDE', '2702', '5.959,14', 'PG', 'PG', '', '', '', '', '', '', '', '', '', '', '', '']);
    matWs.addRow(['DATA DE RECEB.', '6954-x', '', '3014/27.02', '3138/16.04', '', '', '', '', '', '', '', '', '', '', '', '']);
    const matBuf = Buffer.from(await matWb.xlsx.writeBuffer());

    const matAnalyze = await request(app)
      .post('/api/imports/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'controle-tacaratu-2025.xlsx',
        contentBase64: matBuf.toString('base64'),
        referenceYear: 2025,
      })
      .expect(200);
    expect(matAnalyze.body.detectedModule).toBe('invoices');
    expect(matAnalyze.body.confidence).toBe('ALTA');
    expect(matAnalyze.body.validCount).toBe(2);
    expect(matAnalyze.body.rows[0].data.invoice_number).toBe('3014');
    expect(matAnalyze.body.rows[0].data.invoice_group).toBe('GP-C');
    expect(matAnalyze.body.rows[0].data.received_date).toBe('2025-02-27');

    const matCommit = await request(app)
      .post('/api/imports/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetModule: 'invoices',
        filename: 'controle-tacaratu-2025.xlsx',
        rows: matAnalyze.body.rows.map((r: { data: unknown }) => r.data),
      })
      .expect(201);
    expect(matCommit.body.importedCount).toBe(2);

    // 3. CSV de Movimentação do Caixa (separador ";") -> detecta automaticamente "cash"
    const csvContent = [
      'Data;Destino;Finalidade;Entrada;Saída',
      '10/02/2026;Prefeitura de Cumaru;Honorários contábeis;4500,00;0,00',
      '11/02/2026;Papelaria Recife;Compra de resmas;0,00;180,00',
    ].join('\n');
    const csvAnalyze = await request(app)
      .post('/api/imports/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'extrato-caixa-antigo.csv',
        contentBase64: Buffer.from(csvContent, 'utf8').toString('base64'),
      })
      .expect(200);
    expect(csvAnalyze.body.detectedModule).toBe('cash');
    expect(csvAnalyze.body.confidence).toBe('ALTA');
    expect(csvAnalyze.body.validCount).toBe(2);

    const csvCommit = await request(app)
      .post('/api/imports/commit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        targetModule: 'cash',
        filename: 'extrato-caixa-antigo.csv',
        rows: csvAnalyze.body.rows.map((r: { data: unknown }) => r.data),
      })
      .expect(201);
    expect(csvCommit.body.importedCount).toBe(2);

    // 4. PDF real gerado pelo próprio FINANCER (/api/expenses/export?format=pdf) -> leitura e detecção automática
    const pdfRes = await request(app)
      .get('/api/expenses/export?format=pdf')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const pdfAnalyze = await request(app)
      .post('/api/imports/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        filename: 'relatorio-despesas-antigo.pdf',
        contentBase64: (pdfRes.body as Buffer).toString('base64'),
      })
      .expect(200);
    expect(pdfAnalyze.body.fileType).toBe('pdf');
    expect(pdfAnalyze.body.detectedModule).toBe('expenses');
    expect(pdfAnalyze.body.confidence).toBe('ALTA');
    expect(pdfAnalyze.body.validCount).toBeGreaterThanOrEqual(1);

    // 5. Download de planilha modelo (.xlsx)
    const tplRes = await request(app)
      .get('/api/imports/template/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.load(tplRes.body);
    expect(tplWb.worksheets.length).toBe(1);
  });
});
