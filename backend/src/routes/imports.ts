import { Router } from 'express';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  calculateExpenseFinalAmount,
  calculateTripValues,
  EXPENSE_CATEGORIES,
  EXPENSE_TYPES,
  PAYMENT_METHODS,
  roundMoney,
  TRIP_GROUPS,
  validateCashMovement,
} from '../domain/calculations.js';
import { hasPermission } from '../domain/permissions.js';
import { HttpError, isPeriodClosed } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  analyzeUploadedFile,
  ImportTargetModule,
  MODULE_LABELS_PT,
  normalizeText,
} from '../services/importService.js';

export const importsRouter = Router();

const IMPORT_MODULES = ['expenses', 'trips', 'reminders', 'cash', 'invoices'] as const;
const INVOICE_GROUPS = ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha', 'SEM_GRUPO'] as const;
const VALID_SLOTS = new Set([
  'JAN', 'FEV', 'MAR', 'PC', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'ORC', 'OUT', 'NOV', 'DEZ',
]);
const MONTH_TO_SLOT: Record<number, string> = {
  1: 'JAN', 2: 'FEV', 3: 'MAR', 4: 'ABR', 5: 'MAI', 6: 'JUN',
  7: 'JUL', 8: 'AGO', 9: 'SET', 10: 'OUT', 11: 'NOV', 12: 'DEZ',
};

const analyzeSchema = z.object({
  filename: z.string().trim().min(1, 'Informe o nome do arquivo.').max(255),
  contentBase64: z.string().min(1, 'O conteúdo do arquivo está vazio.'),
  overrideModule: z.enum(IMPORT_MODULES).optional(),
  referenceYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

const commitSchema = z.object({
  targetModule: z.enum(IMPORT_MODULES),
  filename: z.string().trim().min(1).max(255),
  rows: z.array(z.record(z.unknown())).min(1, 'Nenhum registro selecionado para importação.').max(5000),
});

function getExcelThemeColors(theme: 'purple' | 'navy' | 'burgundy') {
  if (theme === 'navy') {
    return { headerDark: 'FF003566', headerMid: 'FF0074C4', softFill: 'FFD6EFFF' };
  }
  if (theme === 'burgundy') {
    return { headerDark: 'FF5C1127', headerMid: 'FF7F1D3A', softFill: 'FFFFE4E6' };
  }
  return { headerDark: 'FF5C1241', headerMid: 'FFA82979', softFill: 'FFFAE3F2' };
}

function isIsoDate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

importsRouter.use(requireAuth);

// 1. Analisar planilha Excel (.xlsx / .csv) ou PDF (.pdf) e detectar automaticamente o módulo
importsRouter.post('/analyze', requirePermission('imports', 'view'), async (req, res, next) => {
  try {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos para análise.');
    }

    const { filename, contentBase64, overrideModule, referenceYear } = parsed.data;
    const ext = filename.toLowerCase().split('.').pop() || '';
    if (!['xlsx', 'csv', 'pdf', 'txt'].includes(ext)) {
      throw new HttpError(
        400,
        ext === 'xls'
          ? 'Arquivos no formato antigo .xls não são suportados diretamente. Abra no Excel e salve como .xlsx (Pasta de Trabalho do Excel) ou .csv.'
          : `Formato de arquivo ".${ext}" não suportado. Envie planilhas .xlsx, .csv ou documentos .pdf.`
      );
    }

    const cleanBase64 = contentBase64.includes(',')
      ? contentBase64.slice(contentBase64.indexOf(',') + 1)
      : contentBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0) {
      throw new HttpError(400, 'Arquivo vazio ou corrompido.');
    }

    const db = getDb();
    const companyCode = req.user!.companyCode;
    const citiesRes = await db.query<{ name: string; invoice_group: string }>(
      `SELECT name, invoice_group FROM invoice_cities WHERE company_code = $1 AND active = TRUE`,
      [companyCode]
    );
    const cityGroupLookup = new Map<string, string>();
    for (const c of citiesRes.rows) {
      cityGroupLookup.set(normalizeText(c.name), c.invoice_group);
    }

    const analysis = await analyzeUploadedFile({
      buffer,
      filename,
      overrideModule,
      referenceYear,
      companyName: req.user!.companyName,
      usesGroups: companyCode === 'NAAP',
      cityGroupLookup,
    });

    res.json(analysis);
  } catch (err) {
    if (err instanceof HttpError) {
      next(err);
      return;
    }
    const msg = err instanceof Error ? err.message : 'Falha ao ler o arquivo enviado.';
    next(new HttpError(400, `Não foi possível analisar o arquivo: ${msg}`));
  }
});

// 2. Confirmar e importar os registros validados no módulo correto da empresa ativa
importsRouter.post('/commit', requirePermission('imports', 'create'), async (req, res, next) => {
  try {
    const parsed = commitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos para importação.');
    }

    const { targetModule, filename, rows } = parsed.data;
    if (!hasPermission(req.user!, targetModule, 'create')) {
      throw new HttpError(
        403,
        `Você não possui permissão de inclusão no módulo "${MODULE_LABELS_PT[targetModule]}".`
      );
    }

    const db = getDb();
    const companyCode = req.user!.companyCode;
    const companyName = req.user!.companyName;
    const userId = req.user!.id;

    const periodClosedCache = new Map<string, boolean>();
    const checkPeriodClosed = async (year: number, month: number): Promise<boolean> => {
      const key = `${year}-${month}`;
      if (periodClosedCache.has(key)) return periodClosedCache.get(key)!;
      const closed = await isPeriodClosed(db, companyCode, year, month);
      periodClosedCache.set(key, closed);
      return closed;
    };

    // Para viagens, carrega índice de municípios IBGE em memória para busca rápida sem acentos
    let ibgeByNameUf: Map<string, { ibge_code: number; name: string; uf: string }> | null = null;
    let ibgeByName: Map<string, Array<{ ibge_code: number; name: string; uf: string }>> | null = null;
    if (targetModule === 'trips') {
      const ibgeRes = await db.query<{ ibge_code: number; name: string; uf: string }>(
        'SELECT ibge_code, name, uf FROM ibge_municipalities'
      );
      ibgeByNameUf = new Map();
      ibgeByName = new Map();
      for (const m of ibgeRes.rows) {
        const n = normalizeText(m.name);
        const uf = String(m.uf).toUpperCase().trim();
        ibgeByNameUf.set(`${n}|${uf}`, { ibge_code: Number(m.ibge_code), name: m.name, uf });
        const list = ibgeByName.get(n) || [];
        list.push({ ibge_code: Number(m.ibge_code), name: m.name, uf });
        ibgeByName.set(n, list);
      }
    }

    let importedCount = 0;
    let skippedDuplicates = 0;
    let skippedClosed = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (targetModule === 'expenses') {
          const day = String(row.day || '');
          const rawCategory = String(row.category || 'Outros');
          const category = (EXPENSE_CATEGORIES as readonly string[]).includes(rawCategory)
            ? rawCategory
            : 'Outros';
          const customDescription =
            category === 'Outros'
              ? String(row.custom_description || 'Despesa importada').trim().slice(0, 255) || 'Despesa importada'
              : null;
          const invoiceNumber = String(row.invoice_number || '').replace(/\D/g, '').slice(0, 60);
          const originalAmount = roundMoney(Number(row.original_amount || 0));
          const discount = Math.max(0, roundMoney(Number(row.discount || 0)));
          const interest = Math.max(0, roundMoney(Number(row.interest || 0)));
          const rawType = String(row.expense_type || 'Empresa');
          const expenseType = (EXPENSE_TYPES as readonly string[]).includes(rawType) ? rawType : 'Empresa';
          const notes = String(row.notes || '').trim().slice(0, 1000);

          if (!isIsoDate(day) || originalAmount <= 0) {
            skippedInvalid++;
            continue;
          }

          const year = Number(day.slice(0, 4));
          const month = Number(day.slice(5, 7));
          if (await checkPeriodClosed(year, month)) {
            skippedClosed++;
            continue;
          }

          const finalAmount = calculateExpenseFinalAmount(originalAmount, discount, interest);

          const dup = await db.query<{ id: string }>(
            `SELECT id FROM expenses
             WHERE company_code = $1 AND day = $2::date AND category = $3
               AND COALESCE(custom_description, '') = $4
               AND invoice_number = $5 AND original_amount = $6
               AND final_amount = $7 AND expense_type = $8
             LIMIT 1`,
            [
              companyCode,
              day,
              category,
              customDescription || '',
              invoiceNumber,
              originalAmount,
              finalAmount,
              expenseType,
            ]
          );
          if (dup.rows.length > 0) {
            skippedDuplicates++;
            continue;
          }

          await db.query(
            `INSERT INTO expenses (
               id, company_code, day, category, custom_description, invoice_number,
               original_amount, discount, interest, final_amount, expense_type, notes,
               created_by, updated_by
             ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
            [
              crypto.randomUUID(),
              companyCode,
              day,
              category,
              customDescription,
              invoiceNumber,
              originalAmount,
              discount,
              interest,
              finalAmount,
              expenseType,
              notes,
              userId,
            ]
          );
          importedCount++;
        } else if (targetModule === 'trips') {
          const rawGroup = String(row.trip_group || 'GP-A').toUpperCase();
          const tripGroup = (TRIP_GROUPS as readonly string[]).includes(rawGroup) ? rawGroup : 'GP-A';
          const collaborator = String(row.collaborator || '').trim().slice(0, 160);
          const rawMun = String(row.municipality_name || '').trim().slice(0, 160);
          const rawUf = String(row.state_uf || '').trim().toUpperCase().slice(0, 2);
          const rawPm = String(row.payment_method || 'PIX');
          const paymentMethod = (PAYMENT_METHODS as readonly string[]).includes(rawPm) ? rawPm : 'PIX';
          const departureDate = String(row.departure_date || '');
          const departureAmount = Math.max(0, roundMoney(Number(row.departure_amount || 0)));
          const returnDate = isIsoDate(row.return_date) ? row.return_date : null;
          const returnAmount = Math.max(0, roundMoney(Number(row.return_amount || 0)));
          const timesCount = Math.max(1, Math.trunc(Number(row.times_count || 1)));
          const peopleCount = Math.trunc(Number(row.people_count || 1));
          const notes = String(row.notes || '').trim().slice(0, 1000);

          if (!collaborator || !rawMun || !isIsoDate(departureDate) || peopleCount <= 0) {
            skippedInvalid++;
            continue;
          }

          const year = Number(departureDate.slice(0, 4));
          const month = Number(departureDate.slice(5, 7));
          if (await checkPeriodClosed(year, month)) {
            skippedClosed++;
            continue;
          }

          const normMun = normalizeText(rawMun);
          let matchedIbge = rawUf ? ibgeByNameUf?.get(`${normMun}|${rawUf}`) : undefined;
          if (!matchedIbge) {
            const candidates = ibgeByName?.get(normMun) || [];
            matchedIbge = candidates.find((c) => c.uf === 'PE') || candidates[0];
          }

          const municipalityIbgeCode = matchedIbge ? matchedIbge.ibge_code : null;
          const municipalityName = matchedIbge ? matchedIbge.name : rawMun;
          const stateUf = matchedIbge ? matchedIbge.uf : rawUf.length === 2 ? rawUf : 'PE';
          const { spentAmount, vpp } = calculateTripValues(departureAmount, returnAmount, peopleCount);

          const dup = await db.query<{ id: string }>(
            `SELECT id FROM trips
             WHERE company_code = $1 AND departure_date = $2::date
               AND LOWER(TRIM(collaborator)) = LOWER(TRIM($3))
               AND LOWER(TRIM(municipality_name)) = LOWER(TRIM($4))
               AND departure_amount = $5 AND return_amount = $6
             LIMIT 1`,
            [companyCode, departureDate, collaborator, municipalityName, departureAmount, returnAmount]
          );
          if (dup.rows.length > 0) {
            skippedDuplicates++;
            continue;
          }

          await db.query(
            `INSERT INTO trips (
               id, company_code, trip_group, collaborator, municipality_ibge_code,
               municipality_name, state_uf, payment_method, departure_date,
               departure_amount, return_date, return_amount, times_count,
               people_count, spent_amount, vpp, notes, created_by, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11::date,$12,$13,$14,$15,$16,$17,$18,$18)`,
            [
              crypto.randomUUID(),
              companyCode,
              tripGroup,
              collaborator,
              municipalityIbgeCode,
              municipalityName,
              stateUf,
              paymentMethod,
              departureDate,
              departureAmount,
              returnDate,
              returnAmount,
              timesCount,
              peopleCount,
              spentAmount,
              vpp,
              notes,
              userId,
            ]
          );
          importedCount++;
        } else if (targetModule === 'reminders') {
          const description = String(row.description || '').trim().slice(0, 255);
          const amount = roundMoney(Number(row.amount || 0));
          const dueDate = String(row.due_date || '');
          const rawAccount = String(row.account || companyName).trim();
          const validAccounts = ['PESSOAS', 'NAAP', 'INFOR MANAGER', 'CONTABILITÁ'];
          const account = validAccounts.includes(rawAccount) ? rawAccount : companyName;
          const rawDigit = String(row.digit || '09').trim().toUpperCase();
          const digit = rawDigit === '10' || rawDigit === 'PF' ? rawDigit : '09';
          const rawStatus = String(row.status || 'PENDENTE').toUpperCase();
          const status = rawStatus === 'PAGA' || rawStatus === 'SUSPENSA' ? rawStatus : 'PENDENTE';
          const paidDate = status === 'PAGA' && isIsoDate(row.paid_date) ? row.paid_date : status === 'PAGA' ? dueDate : null;
          const notes = String(row.notes || '').trim().slice(0, 1000);

          if (!description || amount <= 0 || !isIsoDate(dueDate)) {
            skippedInvalid++;
            continue;
          }

          const competenceYear = Number(row.competence_year) || Number(dueDate.slice(0, 4));
          const competenceMonth = Number(row.competence_month) || Number(dueDate.slice(5, 7));
          if (competenceMonth < 1 || competenceMonth > 12) {
            skippedInvalid++;
            continue;
          }

          if (await checkPeriodClosed(competenceYear, competenceMonth)) {
            skippedClosed++;
            continue;
          }

          const ins = await db.query<{ id: string }>(
            `INSERT INTO reminders (
               id, company_code, series_id, competence_year, competence_month,
               due_date, description, amount, account, digit, status, paid_date,
               notes, created_by, updated_by
             ) VALUES ($1,$2,NULL,$3,$4,$5::date,$6,$7,$8,$9,$10,$11::date,$12,$13,$13)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              crypto.randomUUID(),
              companyCode,
              competenceYear,
              competenceMonth,
              dueDate,
              description,
              amount,
              account,
              digit,
              status,
              paidDate,
              notes,
              userId,
            ]
          );
          if (ins.rows.length === 0) {
            skippedDuplicates++;
          } else {
            importedCount++;
          }
        } else if (targetModule === 'cash') {
          const entryDate = String(row.entry_date || '');
          const destination = String(row.destination || '').trim().slice(0, 200);
          const purpose = String(row.purpose || '').trim().slice(0, 300);
          const inflow = Math.max(0, roundMoney(Number(row.inflow || 0)));
          const outflow = Math.max(0, roundMoney(Number(row.outflow || 0)));
          const notes = String(row.notes || '').trim().slice(0, 1000);

          if (!isIsoDate(entryDate) || !destination || !purpose) {
            skippedInvalid++;
            continue;
          }

          let entryType: 'ENTRADA' | 'SAIDA';
          try {
            const validated = validateCashMovement(inflow, outflow);
            entryType = validated.entryType;
          } catch {
            skippedInvalid++;
            continue;
          }

          const year = Number(entryDate.slice(0, 4));
          const month = Number(entryDate.slice(5, 7));
          if (await checkPeriodClosed(year, month)) {
            skippedClosed++;
            continue;
          }

          const dup = await db.query<{ id: string }>(
            `SELECT id FROM cash_entries
             WHERE company_code = $1 AND entry_date = $2::date
               AND LOWER(TRIM(destination)) = LOWER(TRIM($3))
               AND LOWER(TRIM(purpose)) = LOWER(TRIM($4))
               AND inflow = $5 AND outflow = $6
             LIMIT 1`,
            [companyCode, entryDate, destination, purpose, inflow, outflow]
          );
          if (dup.rows.length > 0) {
            skippedDuplicates++;
            continue;
          }

          await db.query(
            `INSERT INTO cash_entries (
               id, company_code, entry_date, destination, purpose, entry_type,
               inflow, outflow, notes, created_by, updated_by
             ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$10)`,
            [
              crypto.randomUUID(),
              companyCode,
              entryDate,
              destination,
              purpose,
              entryType,
              inflow,
              outflow,
              notes,
              userId,
            ]
          );
          importedCount++;
        } else if (targetModule === 'invoices') {
          const invoiceNumber = String(row.invoice_number || '').replace(/\D/g, '').slice(0, 60);
          const amount = roundMoney(Number(row.amount || 0));
          const cityName = String(row.city_name || '').trim().slice(0, 160);
          const fundName = String(row.fund_name || 'PREFEITURA').trim().toUpperCase().slice(0, 160);
          const agency = String(row.agency || '').trim().slice(0, 40);
          const bankAccount = String(row.bank_account || '').trim().slice(0, 40);
          const competenceYear = Number(row.competence_year || 0);
          const competenceMonth = Number(row.competence_month || 0);
          const rawSlot = String(row.competence_slot || 'MES').toUpperCase();
          const competenceSlot = VALID_SLOTS.has(rawSlot)
            ? rawSlot
            : MONTH_TO_SLOT[competenceMonth] || 'JAN';

          const rawGroup = String(row.invoice_group || 'SEM_GRUPO');
          const invoiceGroup =
            companyCode === 'NAAP'
              ? (INVOICE_GROUPS as readonly string[]).includes(rawGroup) && rawGroup !== 'SEM_GRUPO'
                ? rawGroup
                : 'GP-A'
              : 'SEM_GRUPO';

          const rawStatus = String(row.status || 'EMITIDA').toUpperCase();
          const status = ['PENDENTE', 'EMITIDA', 'PG', 'CANCELADA'].includes(rawStatus)
            ? rawStatus
            : 'EMITIDA';
          const receivedDate = isIsoDate(row.received_date) ? row.received_date : null;
          const notes = String(row.notes || '').trim().slice(0, 1000);

          if (
            !invoiceNumber ||
            amount <= 0 ||
            !cityName ||
            !fundName ||
            competenceYear < 2000 ||
            competenceYear > 2100 ||
            competenceMonth < 1 ||
            competenceMonth > 12
          ) {
            skippedInvalid++;
            continue;
          }

          if (await checkPeriodClosed(competenceYear, competenceMonth)) {
            skippedClosed++;
            continue;
          }

          // Garante que a cidade e o órgão/fundo constem no catálogo da empresa ativa
          await db.query(
            `INSERT INTO invoice_cities (id, company_code, name, invoice_group, agency, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [crypto.randomUUID(), companyCode, cityName, invoiceGroup, agency, userId]
          );
          await db.query(
            `INSERT INTO invoice_funds (id, company_code, name, default_account, created_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [crypto.randomUUID(), companyCode, fundName, bankAccount, userId]
          );

          const ins = await db.query<{ id: string }>(
            `INSERT INTO service_invoices (
               id, company_code, invoice_number, amount, city_name, fund_name,
               agency, bank_account, competence_year, competence_month, competence_slot,
               invoice_group, status, received_date, notes, created_by, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15,$16,$16)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              crypto.randomUUID(),
              companyCode,
              invoiceNumber,
              amount,
              cityName,
              fundName,
              agency,
              bankAccount,
              competenceYear,
              competenceMonth,
              competenceSlot,
              invoiceGroup,
              status,
              receivedDate,
              notes,
              userId,
            ]
          );
          if (ins.rows.length === 0) {
            skippedDuplicates++;
          } else {
            importedCount++;
          }
        }
      } catch (rowErr) {
        skippedInvalid++;
        if (errors.length < 15) {
          errors.push(`Linha ${i + 1}: ${rowErr instanceof Error ? rowErr.message : 'erro inesperado'}`);
        }
      }
    }

    await recordAudit({
      companyCode,
      userId,
      userName: req.user!.name,
      operation: 'INCLUSAO',
      module: 'Importação de Dados',
      newValue: {
        filename,
        targetModule,
        importedCount,
        skippedDuplicates,
        skippedClosed,
        skippedInvalid,
      },
      description: `Importação do arquivo "${filename}" para ${MODULE_LABELS_PT[targetModule]} (${companyName}): ${importedCount} registro(s) importado(s), ${skippedDuplicates} duplicado(s) ignorado(s), ${skippedClosed} em período fechado, ${skippedInvalid} inválido(s).`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      targetModule,
      targetModuleLabel: MODULE_LABELS_PT[targetModule],
      importedCount,
      skippedDuplicates,
      skippedClosed,
      skippedInvalid,
      errors,
    });
  } catch (err) {
    next(err);
  }
});

// 3. Download de planilhas modelo (.xlsx) por módulo
importsRouter.get('/template/:module', requirePermission('imports', 'view'), async (req, res, next) => {
  try {
    const mod = String(req.params.module) as ImportTargetModule;
    if (!(IMPORT_MODULES as readonly string[]).includes(mod)) {
      throw new HttpError(400, 'Módulo de modelo inválido.');
    }

    const companyName = req.user!.companyName;
    const companyCode = req.user!.companyCode;
    const colors = getExcelThemeColors(req.user!.companyTheme);
    const year = new Date().getFullYear();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FINANCER – Gestão Financeira';
    const ws = wb.addWorksheet(MODULE_LABELS_PT[mod].slice(0, 31));

    const templates: Record<ImportTargetModule, { headers: string[]; sampleRows: unknown[][] }> = {
      expenses: {
        headers: ['Dia', 'Despesa', 'Nota Fiscal', 'Valor Original', 'Desconto', 'Juros', 'Tipo', 'Observações'],
        sampleRows: [
          [`10/01/${year}`, 'Alimentação', '1045', 185.5, 0, 0, 'Empresa', 'Almoço equipe técnica'],
          [`15/01/${year}`, 'Combustíveis', '1089', 320.0, 10, 0, 'Empresa', 'Abastecimento viagem'],
        ],
      },
      trips: {
        headers: [
          'Grupo',
          'Colaborador',
          'Município',
          'UF',
          'Forma',
          'Data de Saída',
          'Valor de Saída',
          'Data de Devolução',
          'Valor de Devolução',
          'Vezes',
          'Pessoas',
        ],
        sampleRows: [
          ['GP-A', 'João Silva', 'Cumaru', 'PE', 'PIX', `12/01/${year}`, 600, `14/01/${year}`, 80, 1, 2],
          ['GP-B', 'Maria Souza', 'Gravatá', 'PE', 'Espécie', `20/01/${year}`, 450, `21/01/${year}`, 50, 1, 2],
        ],
      },
      reminders: {
        headers: ['Descrição', 'Valor', 'Conta', 'Dígito', 'Vencimento', 'Competência', 'Situação', 'Dt. Pagamento'],
        sampleRows: [
          ['Energia Elétrica Escritório', 640.25, companyName, '09', `15/01/${year}`, `01/${year}`, 'PAGA', `14/01/${year}`],
          ['Internet Fibra', 249.9, companyName, '10', `20/01/${year}`, `01/${year}`, 'PENDENTE', ''],
        ],
      },
      cash: {
        headers: ['Data', 'Destino', 'Finalidade', 'Entrada', 'Saída'],
        sampleRows: [
          [`05/01/${year}`, 'Prefeitura Municipal', 'Honorários contábeis mensais', 9968.01, 0],
          [`08/01/${year}`, 'Papelaria Central', 'Material de expediente', 0, 215.4],
        ],
      },
      invoices: {
        headers: [
          'Número da Nota',
          'Valor',
          'Cidade',
          'Fundo',
          'Mês',
          'Grupo',
          'Situação',
          'Data de Recebimento',
          'Agência',
        ],
        sampleRows: [
          [
            '3013',
            9968.01,
            companyCode === 'CONTABILITA' ? 'Timbaúba' : 'Tacaratu',
            'PREFEITURA',
            `01/${year}`,
            companyCode === 'NAAP' ? 'GP-C' : 'SEM_GRUPO',
            'PG',
            `27/02/${year}`,
            '2702',
          ],
          [
            '3014',
            5959.14,
            companyCode === 'CONTABILITA' ? 'Timbaúba' : 'Tacaratu',
            'SAÚDE',
            `01/${year}`,
            companyCode === 'NAAP' ? 'GP-C' : 'SEM_GRUPO',
            'EMITIDA',
            '',
            '2702',
          ],
        ],
      },
    };

    const spec = templates[mod];
    const titleRow = ws.addRow([`FINANCER (${companyName}) – Modelo de Importação: ${MODULE_LABELS_PT[mod]}`]);
    ws.mergeCells(1, 1, 1, spec.headers.length);
    titleRow.height = 26;
    titleRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.headerDark } };
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

    const headerRow = ws.addRow(spec.headers);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.headerMid } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (const r of spec.sampleRows) {
      const dr = ws.addRow(r);
      dr.eachCell((cell) => {
        if (typeof cell.value === 'number' && cell.value > 10) {
          cell.numFmt = 'R$ #,##0.00';
        }
      });
    }

    spec.headers.forEach((_, idx) => {
      ws.getColumn(idx + 1).width = 20;
    });

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="FINANCER-modelo-${mod}.xlsx"`
    );
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
