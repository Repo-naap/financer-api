import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { getDb } from '../db/index.js';
import { roundMoney } from '../domain/calculations.js';
import { formatBRL, formatDateBR, formatDateTimeBR, toIsoDate } from '../domain/formatters.js';
import { assertYearMonthOpen, HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/auditService.js';
import {
  generatePdfBuffer,
  generateWordBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const invoicesRouter = Router();

export const INVOICE_GROUPS = ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha', 'SEM_GRUPO'] as const;
export const MATRIX_SLOTS = [
  { key: 'JAN', label: 'JAN', month: 1 },
  { key: 'FEV', label: 'FEV', month: 2 },
  { key: 'MAR', label: 'MAR', month: 3 },
  { key: 'PC', label: 'PC', month: 3 },
  { key: 'ABR', label: 'ABR', month: 4 },
  { key: 'MAI', label: 'MAI', month: 5 },
  { key: 'JUN', label: 'JUN', month: 6 },
  { key: 'JUL', label: 'JUL', month: 7 },
  { key: 'AGO', label: 'AGO', month: 8 },
  { key: 'SET', label: 'SET', month: 9 },
  { key: 'ORC', label: 'ORÇ.', month: 9 },
  { key: 'OUT', label: 'OUT', month: 10 },
  { key: 'NOV', label: 'NOV', month: 11 },
  { key: 'DEZ', label: 'DEZ', month: 12 },
] as const;

const MONTH_TO_SLOT: Record<number, string> = {
  1: 'JAN',
  2: 'FEV',
  3: 'MAR',
  4: 'ABR',
  5: 'MAI',
  6: 'JUN',
  7: 'JUL',
  8: 'AGO',
  9: 'SET',
  10: 'OUT',
  11: 'NOV',
  12: 'DEZ',
};

const citySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da cidade.').max(160),
  invoice_group: z.enum(INVOICE_GROUPS).optional().default('SEM_GRUPO'),
  agency: z.string().trim().max(40).optional().default(''),
});

const fundSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do fundo ou órgão da entidade.').max(160),
  default_account: z.string().trim().max(40).optional().default(''),
  display_order: z.coerce.number().int().min(1).max(999).optional().default(50),
});

const invoiceSchema = z.object({
  invoice_number: z
    .string()
    .trim()
    .min(1, 'Informe o número da nota fiscal.')
    .regex(/^\d+$/, 'Número da nota deve conter apenas dígitos numéricos.')
    .max(60),
  amount: z.coerce.number().min(0.01, 'Valor da nota deve ser maior que zero.'),
  city_name: z.string().trim().min(2, 'Informe a cidade.').max(160),
  fund_name: z.string().trim().min(2, 'Informe o fundo / órgão da entidade.').max(160),
  agency: z.string().trim().max(40).optional().default(''),
  bank_account: z.string().trim().max(40).optional().default(''),
  competence_year: z.coerce.number().int().min(2000).max(2100),
  competence_month: z.coerce.number().int().min(1).max(12),
  competence_slot: z
    .enum(['JAN', 'FEV', 'MAR', 'PC', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'ORC', 'OUT', 'NOV', 'DEZ', 'MES'])
    .optional()
    .default('MES'),
  invoice_group: z.enum(INVOICE_GROUPS).optional().default('SEM_GRUPO'),
  status: z.enum(['PENDENTE', 'EMITIDA', 'PG', 'CANCELADA']).optional().default('EMITIDA'),
  received_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de recebimento inválida.')
    .optional()
    .nullable()
    .or(z.literal('')),
  notes: z.string().trim().max(1000).optional().default(''),
  version: z.coerce.number().int().optional(),
});

function resolveSlot(month: number, slot?: string): string {
  if (slot && slot !== 'MES') return slot;
  return MONTH_TO_SLOT[month] || 'JAN';
}

function formatDayMonthDot(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[2]}.${m[1]}`;
}

function getExcelThemeColors(theme: 'purple' | 'navy' | 'burgundy') {
  if (theme === 'navy') {
    return { headerDark: 'FF003566', headerMid: 'FF0074C4', softFill: 'FFD6EFFF', zebraFill: 'FFEDF8FF', textDark: 'FF003566' };
  }
  if (theme === 'burgundy') {
    return { headerDark: 'FF5C1127', headerMid: 'FF7F1D3A', softFill: 'FFFFE4E6', zebraFill: 'FFFFF1F2', textDark: 'FF4A0D1F' };
  }
  return { headerDark: 'FF5C1241', headerMid: 'FFA82979', softFill: 'FFFAE3F2', zebraFill: 'FFFDF2F9', textDark: 'FF5C1241' };
}

function buildFilterSql(companyCode: string, query: Record<string, unknown>) {
  const conditions: string[] = ['i.company_code = $1'];
  const params: unknown[] = [companyCode];

  const year = Number(query.year || 0);
  const month = Number(query.month || 0);
  const group = typeof query.group === 'string' && query.group && query.group !== 'ALL' ? query.group : '';
  const city = typeof query.city === 'string' && query.city.trim() ? query.city.trim() : '';
  const fund = typeof query.fund === 'string' && query.fund.trim() ? query.fund.trim() : '';
  const status = typeof query.status === 'string' && query.status && query.status !== 'ALL' ? query.status : '';
  const invoiceNumber =
    typeof query.invoiceNumber === 'string' && query.invoiceNumber.trim()
      ? query.invoiceNumber.trim()
      : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  if (year >= 2000) {
    params.push(year);
    conditions.push(`i.competence_year = $${params.length}`);
  }
  if (month >= 1 && month <= 12) {
    params.push(month);
    conditions.push(`i.competence_month = $${params.length}`);
  }
  if (group) {
    params.push(group);
    conditions.push(`i.invoice_group = $${params.length}`);
  }
  if (city) {
    params.push(`%${city}%`);
    conditions.push(`i.city_name ILIKE $${params.length}`);
  }
  if (fund) {
    params.push(`%${fund}%`);
    conditions.push(`i.fund_name ILIKE $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (invoiceNumber) {
    params.push(`%${invoiceNumber}%`);
    conditions.push(`i.invoice_number ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(i.invoice_number ILIKE $${params.length} OR i.city_name ILIKE $${params.length} OR i.fund_name ILIKE $${params.length} OR i.invoice_group ILIKE $${params.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
    year,
    month,
    group,
    city,
    fund,
    status,
    invoiceNumber,
  };
}

interface MatrixCell {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  received_date: string | null;
  display_bottom: string;
}

interface MatrixFundRow {
  fund_name: string;
  agency: string;
  bank_account: string;
  reference_amount: number;
  slots: Record<string, MatrixCell[]>;
  total_amount: number;
  total_paid: number;
}

interface MatrixCityBlock {
  city_name: string;
  agency: string;
  invoice_group: string;
  funds: MatrixFundRow[];
  city_reference_total: number;
  city_total_amount: number;
  city_total_paid: number;
}

interface MatrixGroupBlock {
  group_code: string;
  group_label: string;
  cities: MatrixCityBlock[];
  group_total_amount: number;
  group_total_paid: number;
}

async function buildInvoiceMatrix(
  companyCode: string,
  companyName: string,
  year: number,
  filterGroup?: string,
  filterCity?: string
): Promise<{
  year: number;
  usesGroups: boolean;
  groups: MatrixGroupBlock[];
  grandTotalAmount: number;
  grandTotalPaid: number;
}> {
  const db = getDb();
  const usesGroups = companyCode === 'NAAP';

  const citiesRes = await db.query<{ name: string; invoice_group: string; agency: string }>(
    `SELECT name, invoice_group, agency
     FROM invoice_cities
     WHERE company_code = $1 AND active = TRUE
     ORDER BY invoice_group ASC, name ASC`,
    [companyCode]
  );

  const fundsRes = await db.query<{ name: string; default_account: string; display_order: number }>(
    `SELECT name, default_account, display_order
     FROM invoice_funds
     WHERE company_code = $1 AND active = TRUE
     ORDER BY display_order ASC, name ASC`,
    [companyCode]
  );

  const conds = ['company_code = $1', 'competence_year = $2'];
  const params: unknown[] = [companyCode, year];
  if (filterGroup && filterGroup !== 'ALL') {
    params.push(filterGroup);
    conds.push(`invoice_group = $${params.length}`);
  }
  if (filterCity && filterCity.trim()) {
    params.push(`%${filterCity.trim()}%`);
    conds.push(`city_name ILIKE $${params.length}`);
  }

  const invRes = await db.query<Record<string, unknown>>(
    `SELECT * FROM service_invoices
     WHERE ${conds.join(' AND ')}
     ORDER BY invoice_group ASC, city_name ASC, fund_name ASC, competence_month ASC, invoice_number ASC`,
    params
  );

  const fundOrderMap = new Map<string, number>();
  fundsRes.rows.forEach((f, idx) => fundOrderMap.set(f.name.toUpperCase(), f.display_order || idx + 1));

  const cityAgencyMap = new Map<string, string>();
  citiesRes.rows.forEach((c) => {
    cityAgencyMap.set(`${c.invoice_group}|${c.name.toLowerCase()}`, c.agency || '');
  });

  // Agrupa: group -> city -> fund
  const groupOrder = usesGroups ? ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha', 'SEM_GRUPO'] : ['SEM_GRUPO'];
  const groupMap = new Map<
    string,
    Map<string, Map<string, { agency: string; bankAccount: string; refAmt: number; slots: Record<string, MatrixCell[]>; total: number; paid: number }>>
  >();

  // Pré-semeia cidades cadastradas filtradas (para facilitar conferência visual por grupo mesmo quando ainda não há notas)
  for (const c of citiesRes.rows) {
    const g = usesGroups ? c.invoice_group : 'SEM_GRUPO';
    if (filterGroup && filterGroup !== 'ALL' && g !== filterGroup) continue;
    if (filterCity && filterCity.trim() && !c.name.toLowerCase().includes(filterCity.trim().toLowerCase())) {
      continue;
    }
    if (!groupMap.has(g)) groupMap.set(g, new Map());
    if (!groupMap.get(g)!.has(c.name)) groupMap.get(g)!.set(c.name, new Map());
  }

  for (const row of invRes.rows) {
    const g = usesGroups ? String(row.invoice_group || 'SEM_GRUPO') : 'SEM_GRUPO';
    const cityName = String(row.city_name);
    const fundName = String(row.fund_name).toUpperCase();
    const slotKey = resolveSlot(Number(row.competence_month), String(row.competence_slot || 'MES'));
    const amount = roundMoney(Number(row.amount));
    const status = String(row.status);
    const recIso = row.received_date ? toIsoDate(row.received_date as string | Date) : null;
    const invNum = String(row.invoice_number);
    const dm = formatDayMonthDot(recIso);

    if (!groupMap.has(g)) groupMap.set(g, new Map());
    const citiesInGroup = groupMap.get(g)!;
    if (!citiesInGroup.has(cityName)) citiesInGroup.set(cityName, new Map());
    const fundsInCity = citiesInGroup.get(cityName)!;

    const existingFund = fundsInCity.get(fundName) || {
      agency: String(row.agency || cityAgencyMap.get(`${g}|${cityName.toLowerCase()}`) || ''),
      bankAccount: String(row.bank_account || ''),
      refAmt: amount,
      slots: {},
      total: 0,
      paid: 0,
    };
    if (row.agency) existingFund.agency = String(row.agency);
    if (row.bank_account) existingFund.bankAccount = String(row.bank_account);
    existingFund.refAmt = amount;

    if (!existingFund.slots[slotKey]) existingFund.slots[slotKey] = [];
    existingFund.slots[slotKey].push({
      id: String(row.id),
      invoice_number: invNum,
      amount,
      status,
      received_date: recIso,
      display_bottom: dm ? `${invNum}/${dm}` : invNum,
    });

    if (status !== 'CANCELADA') {
      existingFund.total = roundMoney(existingFund.total + amount);
      if (status === 'PG') {
        existingFund.paid = roundMoney(existingFund.paid + amount);
      }
    }
    fundsInCity.set(fundName, existingFund);
  }

  const groupLabels: Record<string, string> = {
    'GP-A': 'GRUPO A (GP-A)',
    'GP-B': 'GRUPO B (GP-B)',
    'GP-C': 'GRUPO C (GP-C)',
    'GP-D': 'GRUPO D (GP-D)',
    'RH-Folha': 'RH E FOLHA (RH-Folha)',
    SEM_GRUPO: usesGroups ? 'OUTRAS / SEM GRUPO' : `CONFERÊNCIA DE NOTAS – ${companyName}`,
  };

  let grandTotalAmount = 0;
  let grandTotalPaid = 0;
  const groups: MatrixGroupBlock[] = [];

  for (const gCode of groupOrder) {
    const citiesInGroup = groupMap.get(gCode);
    if (!citiesInGroup || citiesInGroup.size === 0) continue;

    let groupTotalAmount = 0;
    let groupTotalPaid = 0;
    const cities: MatrixCityBlock[] = [];

    for (const [cityName, fundsMap] of citiesInGroup.entries()) {
      const funds: MatrixFundRow[] = Array.from(fundsMap.entries())
        .sort(([a], [b]) => (fundOrderMap.get(a) ?? 999) - (fundOrderMap.get(b) ?? 999) || a.localeCompare(b))
        .map(([fundName, data]) => ({
          fund_name: fundName,
          agency: data.agency,
          bank_account: data.bankAccount,
          reference_amount: data.refAmt,
          slots: data.slots,
          total_amount: data.total,
          total_paid: data.paid,
        }));

      const cityRefTotal = roundMoney(funds.reduce((s, f) => s + f.reference_amount, 0));
      const cityTotalAmount = roundMoney(funds.reduce((s, f) => s + f.total_amount, 0));
      const cityTotalPaid = roundMoney(funds.reduce((s, f) => s + f.total_paid, 0));

      groupTotalAmount = roundMoney(groupTotalAmount + cityTotalAmount);
      groupTotalPaid = roundMoney(groupTotalPaid + cityTotalPaid);

      cities.push({
        city_name: cityName,
        agency: cityAgencyMap.get(`${gCode}|${cityName.toLowerCase()}`) || funds[0]?.agency || '',
        invoice_group: gCode,
        funds,
        city_reference_total: cityRefTotal,
        city_total_amount: cityTotalAmount,
        city_total_paid: cityTotalPaid,
      });
    }

    grandTotalAmount = roundMoney(grandTotalAmount + groupTotalAmount);
    grandTotalPaid = roundMoney(grandTotalPaid + groupTotalPaid);

    groups.push({
      group_code: gCode,
      group_label: groupLabels[gCode] || gCode,
      cities,
      group_total_amount: groupTotalAmount,
      group_total_paid: groupTotalPaid,
    });
  }

  return { year, usesGroups, groups, grandTotalAmount, grandTotalPaid };
}

async function generateMatrixExcelBuffer(params: {
  companyName: string;
  theme: 'purple' | 'navy' | 'burgundy';
  generatedBy: string;
  matrix: Awaited<ReturnType<typeof buildInvoiceMatrix>>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FINANCER – Gestão Financeira';
  wb.created = new Date();
  const pal = getExcelThemeColors(params.theme);

  const slotHeaders = MATRIX_SLOTS.map((s) => s.label);
  const totalCols = 3 + slotHeaders.length + 1; // Cidade/Fundo + Agência + R$ + 14 slots + TOTAL

  for (const grp of params.matrix.groups) {
    const sheetName = grp.group_code === 'SEM_GRUPO' ? 'Conferência' : grp.group_code;
    const sheet = wb.addWorksheet(sheetName.slice(0, 31));
    const lastColLetter = sheet.getColumn(totalCols).letter;

    // Cabeçalho Institucional
    sheet.mergeCells(`A1:${lastColLetter}1`);
    const c1 = sheet.getCell('A1');
    c1.value = `FINANCER – ${params.companyName} | CONFERÊNCIA DE NOTAS (${params.matrix.year}) – ${grp.group_label}`;
    c1.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.headerDark } };
    c1.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(1).height = 26;

    sheet.mergeCells(`A2:${lastColLetter}2`);
    sheet.getCell('A2').value = `Emitido em: ${formatDateTimeBR(new Date())}  |  Responsável: ${params.generatedBy}`;
    sheet.getCell('A2').font = { size: 9, color: { argb: 'FF475569' } };

    // Larguras das colunas
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(3).width = 14;
    for (let i = 4; i <= 3 + slotHeaders.length; i++) {
      sheet.getColumn(i).width = 12;
    }
    sheet.getColumn(totalCols).width = 15;

    let rowIdx = 4;

    for (const city of grp.cities) {
      // Cabeçalho da Cidade (igual à planilha enviada)
      const hRow = sheet.getRow(rowIdx);
      hRow.height = 20;
      const headers = [city.city_name, 'AGÊNCIA', 'R$', ...slotHeaders, 'TOTAL'];
      headers.forEach((h, idx) => {
        const cell = hRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.headerMid } };
        cell.alignment = { vertical: 'middle', horizontal: idx === 0 ? 'left' : 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      });
      rowIdx += 1;

      const cityStartRow = rowIdx;

      if (city.funds.length === 0) {
        sheet.mergeCells(`A${rowIdx}:${lastColLetter}${rowIdx}`);
        sheet.getCell(`A${rowIdx}`).value = 'Nenhuma nota lançada para esta cidade neste ano.';
        sheet.getCell(`A${rowIdx}`).font = { italic: true, size: 9, color: { argb: 'FF94A3B8' } };
        rowIdx += 2;
        continue;
      }

      for (const fund of city.funds) {
        // Linha 1 do Fundo: Nome do Fundo | Agência | Valor (R$) | Status (PG / EMIT.) | Total
        const rTop = sheet.getRow(rowIdx);
        rTop.getCell(1).value = fund.fund_name;
        rTop.getCell(1).font = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
        rTop.getCell(2).value = fund.agency || city.agency || '';
        rTop.getCell(2).alignment = { horizontal: 'center' };
        rTop.getCell(3).value = fund.reference_amount;
        rTop.getCell(3).numFmt = '"R$" #,##0.00';
        rTop.getCell(3).font = { bold: true };

        // Linha 2 do Fundo: DATA DE RECEB. | Conta | (vazio) | NF/DD.MM | Total Pago
        const rBot = sheet.getRow(rowIdx + 1);
        rBot.getCell(1).value = 'DATA DE RECEB.';
        rBot.getCell(1).font = { size: 8.5, color: { argb: 'FF475569' } };
        rBot.getCell(2).value = fund.bank_account || '';
        rBot.getCell(2).alignment = { horizontal: 'center' };
        rBot.getCell(2).font = { size: 8.5 };

        MATRIX_SLOTS.forEach((slot, sIdx) => {
          const colNum = 4 + sIdx;
          const entries = fund.slots[slot.key] || [];
          const topCell = rTop.getCell(colNum);
          const botCell = rBot.getCell(colNum);

          if (entries.length > 0) {
            const allPaid = entries.every((e) => e.status === 'PG');
            topCell.value = allPaid ? 'PG' : entries.map((e) => e.status).join('/');
            topCell.font = { bold: true, size: 9, color: { argb: allPaid ? 'FF0C4A6E' : 'FF78350F' } };
            topCell.alignment = { horizontal: 'center' };
            topCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: allPaid ? 'FFBAE6FD' : 'FFFEF3C7' },
            };

            botCell.value = entries.map((e) => e.display_bottom).join(' | ');
            botCell.font = { size: 8.5, color: { argb: 'FF1E293B' } };
            botCell.alignment = { horizontal: 'center' };
            botCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          } else {
            topCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.zebraFill } };
            botCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.softFill } };
          }

          const border = {
            top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
          };
          topCell.border = border;
          botCell.border = border;
        });

        rTop.getCell(totalCols).value = fund.total_amount;
        rTop.getCell(totalCols).numFmt = '"R$" #,##0.00';
        rTop.getCell(totalCols).font = { bold: true, color: { argb: pal.textDark } };
        rBot.getCell(totalCols).value = fund.total_paid;
        rBot.getCell(totalCols).numFmt = '"R$" #,##0.00';
        rBot.getCell(totalCols).font = { size: 8.5, color: { argb: 'FF047857' } };

        rowIdx += 2;
      }

      // Linha de Subtotal da Cidade
      const subRow = sheet.getRow(rowIdx);
      subRow.getCell(1).value = `TOTAL ${city.city_name.toUpperCase()}`;
      subRow.getCell(1).font = { bold: true, color: { argb: pal.textDark } };
      subRow.getCell(3).value = {
        formula: `SUM(C${cityStartRow}:C${rowIdx - 1})`,
        result: city.city_reference_total,
      };
      subRow.getCell(3).numFmt = '"R$" #,##0.00';
      subRow.getCell(3).font = { bold: true, color: { argb: pal.textDark } };
      subRow.getCell(totalCols).value = city.city_total_amount;
      subRow.getCell(totalCols).numFmt = '"R$" #,##0.00';
      subRow.getCell(totalCols).font = { bold: true, color: { argb: pal.textDark } };
      for (let c = 1; c <= totalCols; c++) {
        subRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.softFill } };
      }

      rowIdx += 2;
    }

    // Total do Grupo
    const grpTotalRow = sheet.getRow(rowIdx);
    grpTotalRow.getCell(1).value = `TOTAL GERAL – ${grp.group_label}`;
    grpTotalRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    grpTotalRow.getCell(totalCols).value = grp.group_total_amount;
    grpTotalRow.getCell(totalCols).numFmt = '"R$" #,##0.00';
    grpTotalRow.getCell(totalCols).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= totalCols; c++) {
      grpTotalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pal.headerDark } };
    }
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

invoicesRouter.use(requireAuth);

// ============================================================================
// CATÁLOGOS DE CIDADES E ÓRGÃOS/FUNDOS POR EMPRESA
// ============================================================================
invoicesRouter.get('/catalogs', requirePermission('invoices', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const [citiesRes, fundsRes] = await Promise.all([
      db.query(
        `SELECT * FROM invoice_cities
         WHERE company_code = $1 AND active = TRUE
         ORDER BY invoice_group ASC, name ASC`,
        [companyCode]
      ),
      db.query(
        `SELECT * FROM invoice_funds
         WHERE company_code = $1 AND active = TRUE
         ORDER BY display_order ASC, name ASC`,
        [companyCode]
      ),
    ]);

    res.json({
      usesGroups: companyCode === 'NAAP',
      groups: companyCode === 'NAAP' ? ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha'] : ['SEM_GRUPO'],
      cities: citiesRes.rows,
      funds: fundsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/cities', requirePermission('invoices', 'create'), async (req, res, next) => {
  try {
    const body = citySchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const group = companyCode === 'NAAP' ? body.invoice_group : 'SEM_GRUPO';
    const id = crypto.randomUUID();

    const ins = await db.query<Record<string, unknown>>(
      `INSERT INTO invoice_cities (id, company_code, name, invoice_group, agency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, companyCode, body.name, group, body.agency, req.user!.id]
    );

    await recordAudit({
      companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'INCLUSAO',
      module: 'Conferência de Notas',
      recordId: id,
      newValue: ins.rows[0],
      description: `Nova cidade "${body.name}" cadastrada em Conferência de Notas (${group}).`,
      ipAddress: req.clientIp,
    });

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

invoicesRouter.delete('/cities/:id', requirePermission('invoices', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existing = await db.query<Record<string, unknown>>(
      'SELECT * FROM invoice_cities WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    if (!existing.rows[0]) throw new HttpError(404, 'Cidade não encontrada.');

    await db.query('DELETE FROM invoice_cities WHERE id = $1 AND company_code = $2', [
      req.params.id,
      companyCode,
    ]);
    await recordAudit({
      companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'EXCLUSAO',
      module: 'Conferência de Notas',
      recordId: String(req.params.id),
      previousValue: existing.rows[0],
      description: `Cidade "${existing.rows[0].name}" removida do cadastro de Conferência de Notas.`,
      ipAddress: req.clientIp,
    });

    res.json({ message: 'Cidade removida com sucesso.' });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/funds', requirePermission('invoices', 'create'), async (req, res, next) => {
  try {
    const body = fundSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const id = crypto.randomUUID();
    const normalizedName = body.name.toUpperCase();

    const ins = await db.query<Record<string, unknown>>(
      `INSERT INTO invoice_funds (id, company_code, name, default_account, display_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, companyCode, normalizedName, body.default_account, body.display_order, req.user!.id]
    );

    await recordAudit({
      companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'INCLUSAO',
      module: 'Conferência de Notas',
      recordId: id,
      newValue: ins.rows[0],
      description: `Novo fundo/órgão "${normalizedName}" cadastrado em Conferência de Notas.`,
      ipAddress: req.clientIp,
    });

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

invoicesRouter.delete('/funds/:id', requirePermission('invoices', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;
    const existing = await db.query<Record<string, unknown>>(
      'SELECT * FROM invoice_funds WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    if (!existing.rows[0]) throw new HttpError(404, 'Fundo/Órgão não encontrado.');

    await db.query('DELETE FROM invoice_funds WHERE id = $1 AND company_code = $2', [
      req.params.id,
      companyCode,
    ]);
    await recordAudit({
      companyCode,
      userId: req.user!.id,
      userName: req.user!.name,
      operation: 'EXCLUSAO',
      module: 'Conferência de Notas',
      recordId: String(req.params.id),
      previousValue: existing.rows[0],
      description: `Fundo/Órgão "${existing.rows[0].name}" removido do cadastro.`,
      ipAddress: req.clientIp,
    });

    res.json({ message: 'Fundo/Órgão removido com sucesso.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// VISÃO MATRICIAL (PLANILHA POR GRUPOS E CIDADES)
// ============================================================================
invoicesRouter.get('/matrix', requirePermission('invoices', 'view'), async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    const group = typeof req.query.group === 'string' ? req.query.group : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;

    const matrix = await buildInvoiceMatrix(
      req.user!.companyCode,
      req.user!.companyName,
      year,
      group,
      city
    );
    res.json({
      slots: MATRIX_SLOTS,
      ...matrix,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// LISTAGEM E CRUD DE NOTAS FISCAIS
// ============================================================================
invoicesRouter.get('/', requirePermission('invoices', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const { whereClause, params } = buildFilterSql(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT i.*, u.name AS created_by_name
       FROM service_invoices i
       LEFT JOIN users u ON u.id = i.created_by
       ${whereClause}
       ORDER BY i.competence_year DESC, i.competence_month DESC, i.invoice_group ASC, i.city_name ASC, i.invoice_number DESC`,
      params
    );

    const normalized = rowsRes.rows.map((r) => ({
      ...r,
      status: String(r.status),
      invoice_group: String(r.invoice_group || 'SEM_GRUPO'),
      amount: roundMoney(Number(r.amount)),
      received_date: r.received_date ? toIsoDate(r.received_date as string | Date) : null,
      competence: `${String(r.competence_month).padStart(2, '0')}/${r.competence_year}`,
      slot_label:
        r.competence_slot === 'ORC'
          ? 'ORÇ.'
          : resolveSlot(Number(r.competence_month), String(r.competence_slot || 'MES')),
    }));

    let totalAmount = 0;
    let paidAmount = 0;
    let pendingAmount = 0;
    const byGroupMap = new Map<string, { group: string; count: number; total: number; paid: number }>();

    for (const n of normalized) {
      if (n.status !== 'CANCELADA') {
        totalAmount = roundMoney(totalAmount + n.amount);
        if (n.status === 'PG') paidAmount = roundMoney(paidAmount + n.amount);
        else pendingAmount = roundMoney(pendingAmount + n.amount);
      }
      const g = String((n as Record<string, unknown>).invoice_group || 'SEM_GRUPO');
      const e = byGroupMap.get(g) || { group: g, count: 0, total: 0, paid: 0 };
      e.count += 1;
      if (n.status !== 'CANCELADA') {
        e.total = roundMoney(e.total + n.amount);
        if (n.status === 'PG') e.paid = roundMoney(e.paid + n.amount);
      }
      byGroupMap.set(g, e);
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    res.json({
      items: normalized.slice(offset, offset + pageSize),
      total: normalized.length,
      page,
      pageSize,
      summary: {
        count: normalized.length,
        totalAmount,
        paidAmount,
        pendingAmount,
        byGroup: Array.from(byGroupMap.values()),
      },
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/', requirePermission('invoices', 'create'), async (req, res, next) => {
  try {
    const body = invoiceSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    await assertYearMonthOpen(db, companyCode, body.competence_year, body.competence_month);

    const effectiveGroup = companyCode === 'NAAP' ? body.invoice_group : 'SEM_GRUPO';
    const slot = resolveSlot(body.competence_month, body.competence_slot);
    const receivedDate =
      body.received_date && body.received_date.length === 10 ? body.received_date : null;
    const status = receivedDate && body.status === 'EMITIDA' ? 'PG' : body.status;
    const fundUpper = body.fund_name.toUpperCase();

    const id = crypto.randomUUID();
    const created = await db.transaction(async (tx) => {
      // Cadastra automaticamente a cidade e o fundo se ainda não existirem no catálogo da empresa
      await tx.query(
        `INSERT INTO invoice_cities (id, company_code, name, invoice_group, agency, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), companyCode, body.city_name, effectiveGroup, body.agency, req.user!.id]
      );
      await tx.query(
        `INSERT INTO invoice_funds (id, company_code, name, default_account, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), companyCode, fundUpper, body.bank_account, req.user!.id]
      );

      const ins = await tx.query<Record<string, unknown>>(
        `INSERT INTO service_invoices (
           id, company_code, invoice_number, amount, city_name, fund_name,
           agency, bank_account, competence_year, competence_month, competence_slot,
           invoice_group, status, received_date, notes, created_by, updated_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14::date, $15, $16, $16
         ) RETURNING *`,
        [
          id,
          companyCode,
          body.invoice_number,
          roundMoney(body.amount),
          body.city_name,
          fundUpper,
          body.agency,
          body.bank_account,
          body.competence_year,
          body.competence_month,
          slot,
          effectiveGroup,
          status,
          receivedDate,
          body.notes,
          req.user!.id,
        ]
      );
      const row = ins.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'INCLUSAO',
          module: 'Conferência de Notas',
          recordId: id,
          newValue: row,
          description: `Nota nº ${body.invoice_number} (${body.city_name} - ${fundUpper}, ${String(body.competence_month).padStart(2, '0')}/${body.competence_year}) no valor de ${formatBRL(body.amount)} lançada.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.status(201).json({
      ...created,
      amount: roundMoney(Number(created.amount)),
      received_date: created.received_date ? toIsoDate(created.received_date as string | Date) : null,
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.put('/:id', requirePermission('invoices', 'edit'), async (req, res, next) => {
  try {
    const body = invoiceSchema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM service_invoices WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Nota fiscal não encontrada.');

    if (body.version !== undefined && Number(existing.version) !== body.version) {
      throw new HttpError(409, 'Esta nota foi alterada por outro usuário.', 'CONCURRENCY_CONFLICT');
    }

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );
    await assertYearMonthOpen(db, companyCode, body.competence_year, body.competence_month);

    const effectiveGroup = companyCode === 'NAAP' ? body.invoice_group : 'SEM_GRUPO';
    const slot = resolveSlot(body.competence_month, body.competence_slot);
    const receivedDate =
      body.received_date && body.received_date.length === 10 ? body.received_date : null;
    const fundUpper = body.fund_name.toUpperCase();

    const updated = await db.transaction(async (tx) => {
      const upd = await tx.query<Record<string, unknown>>(
        `UPDATE service_invoices SET
           invoice_number = $1,
           amount = $2,
           city_name = $3,
           fund_name = $4,
           agency = $5,
           bank_account = $6,
           competence_year = $7,
           competence_month = $8,
           competence_slot = $9,
           invoice_group = $10,
           status = $11,
           received_date = $12::date,
           notes = $13,
           updated_by = $14,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $15 AND company_code = $16
         RETURNING *`,
        [
          body.invoice_number,
          roundMoney(body.amount),
          body.city_name,
          fundUpper,
          body.agency,
          body.bank_account,
          body.competence_year,
          body.competence_month,
          slot,
          effectiveGroup,
          body.status,
          receivedDate,
          body.notes,
          req.user!.id,
          req.params.id,
          companyCode,
        ]
      );
      const row = upd.rows[0];

      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Conferência de Notas',
          recordId: String(req.params.id),
          previousValue: existing,
          newValue: row,
          description: `Nota nº ${body.invoice_number} (${body.city_name} - ${fundUpper}) atualizada.`,
          ipAddress: req.clientIp,
        },
        tx
      );

      return row;
    });

    res.json({
      ...updated,
      amount: roundMoney(Number(updated.amount)),
      received_date: updated.received_date ? toIsoDate(updated.received_date as string | Date) : null,
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/:id/mark-paid', requirePermission('invoices', 'edit'), async (req, res, next) => {
  try {
    const schema = z.object({
      received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de recebimento.'),
    });
    const { received_date } = schema.parse(req.body);
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM service_invoices WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Nota fiscal não encontrada.');

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );

    const upd = await db.transaction(async (tx) => {
      const r = await tx.query<Record<string, unknown>>(
        `UPDATE service_invoices SET
           status = 'PG',
           received_date = $1::date,
           updated_by = $2,
           updated_at = NOW(),
           version = version + 1
         WHERE id = $3 AND company_code = $4
         RETURNING *`,
        [received_date, req.user!.id, req.params.id, companyCode]
      );
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EDICAO',
          module: 'Conferência de Notas',
          recordId: String(req.params.id),
          previousValue: { status: existing.status, received_date: existing.received_date },
          newValue: { status: 'PG', received_date },
          description: `Nota nº ${existing.invoice_number} (${existing.city_name} - ${existing.fund_name}) marcada como PG em ${formatDateBR(received_date)}.`,
          ipAddress: req.clientIp,
        },
        tx
      );
      return r.rows[0];
    });

    res.json({
      ...upd,
      amount: roundMoney(Number(upd.amount)),
      received_date: toIsoDate(upd.received_date as string | Date),
    });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.delete('/:id', requirePermission('invoices', 'delete'), async (req, res, next) => {
  try {
    const db = getDb();
    const companyCode = req.user!.companyCode;

    const existingRes = await db.query<Record<string, unknown>>(
      'SELECT * FROM service_invoices WHERE id = $1 AND company_code = $2',
      [req.params.id, companyCode]
    );
    const existing = existingRes.rows[0];
    if (!existing) throw new HttpError(404, 'Nota fiscal não encontrada.');

    await assertYearMonthOpen(
      db,
      companyCode,
      Number(existing.competence_year),
      Number(existing.competence_month)
    );

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM service_invoices WHERE id = $1 AND company_code = $2', [
        req.params.id,
        companyCode,
      ]);
      await recordAudit(
        {
          companyCode,
          userId: req.user!.id,
          userName: req.user!.name,
          operation: 'EXCLUSAO',
          module: 'Conferência de Notas',
          recordId: String(req.params.id),
          previousValue: existing,
          description: `Nota nº ${existing.invoice_number} (${existing.city_name} - ${existing.fund_name}) excluída.`,
          ipAddress: req.clientIp,
        },
        tx
      );
    });

    res.json({ message: 'Nota fiscal excluída com sucesso.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// EXPORTAÇÕES (EXCEL MATRICIAL POR GRUPOS + PDF + WORD)
// ============================================================================
invoicesRouter.get('/export', requirePermission('invoices', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const year = Number(req.query.year || new Date().getFullYear());
    const group = typeof req.query.group === 'string' && req.query.group !== 'ALL' ? req.query.group : undefined;
    const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim() : undefined;

    if (format === 'xlsx') {
      const matrix = await buildInvoiceMatrix(
        req.user!.companyCode,
        req.user!.companyName,
        year,
        group,
        city
      );
      const buf = await generateMatrixExcelBuffer({
        companyName: req.user!.companyName,
        theme: req.user!.companyTheme,
        generatedBy: req.user!.name,
        matrix,
      });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="financer-conferencia-notas-${year}.xlsx"`
      );
      res.send(buf);
      return;
    }

    const db = getDb();
    const { whereClause, params } = buildFilterSql(
      req.user!.companyCode,
      { ...req.query, year } as Record<string, unknown>
    );
    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM service_invoices i ${whereClause}
       ORDER BY i.invoice_group ASC, i.city_name ASC, i.fund_name ASC, i.competence_month ASC`,
      params
    );

    const byGroup = new Map<string, { group: string; count: number; total: number; paid: number }>();
    const byCity = new Map<string, { group: string; city: string; count: number; total: number; paid: number }>();
    let grandTotal = 0;
    let totalPaid = 0;

    const rows = rowsRes.rows.map((r) => {
      const amount = roundMoney(Number(r.amount));
      const g = r.invoice_group === 'SEM_GRUPO' ? '-' : String(r.invoice_group);
      const cName = String(r.city_name);
      if (r.status !== 'CANCELADA') {
        grandTotal = roundMoney(grandTotal + amount);
        if (r.status === 'PG') totalPaid = roundMoney(totalPaid + amount);
      }

      const ge = byGroup.get(g) || { group: g, count: 0, total: 0, paid: 0 };
      ge.count += 1;
      if (r.status !== 'CANCELADA') {
        ge.total = roundMoney(ge.total + amount);
        if (r.status === 'PG') ge.paid = roundMoney(ge.paid + amount);
      }
      byGroup.set(g, ge);

      const ck = `${g}|${cName}`;
      const ce = byCity.get(ck) || { group: g, city: cName, count: 0, total: 0, paid: 0 };
      ce.count += 1;
      if (r.status !== 'CANCELADA') {
        ce.total = roundMoney(ce.total + amount);
        if (r.status === 'PG') ce.paid = roundMoney(ce.paid + amount);
      }
      byCity.set(ck, ce);

      const slot = resolveSlot(Number(r.competence_month), String(r.competence_slot || 'MES'));
      return {
        invoice_group: g,
        city_name: cName,
        fund_name: String(r.fund_name),
        invoice_number: String(r.invoice_number),
        competence: `${slot === 'ORC' ? 'ORÇ.' : slot}/${r.competence_year}`,
        amount,
        status: String(r.status),
        received_date: r.received_date ? formatDateBR(r.received_date as string | Date) : '-',
      };
    });

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Conferência de Notas – ${req.user!.companyName} (${year})`,
      periodLabel: `Exercício ${year}`,
      generatedBy: req.user!.name,
      filtersSummary: [group ? `Grupo: ${group}` : '', city ? `Cidade: ${city}` : '']
        .filter(Boolean)
        .join(' | ') || 'Todos os grupos e cidades',
      landscape: true,
      columns: [
        { key: 'invoice_group', header: 'Grupo', width: 10, type: 'text' },
        { key: 'city_name', header: 'Cidade', width: 18, type: 'text' },
        { key: 'fund_name', header: 'Fundo / Órgão', width: 16, type: 'text' },
        { key: 'invoice_number', header: 'Nº Nota', width: 11, type: 'text' },
        { key: 'competence', header: 'Mês / Ref.', width: 11, type: 'text' },
        { key: 'amount', header: 'Valor (R$)', width: 13, type: 'currency' },
        { key: 'status', header: 'Situação', width: 10, type: 'text' },
        { key: 'received_date', header: 'Dt. Receb.', width: 11, type: 'date' },
      ],
      rows,
      subtotalSections: [
        {
          title: 'Subtotais Separados por Grupo',
          headers: ['Grupo', 'Qtd. Notas', 'Total Emitido', 'Total Recebido (PG)'],
          rows: Array.from(byGroup.values()).map((g) => [
            g.group,
            g.count,
            formatBRL(g.total),
            formatBRL(g.paid),
          ]),
        },
        {
          title: 'Subtotais por Cidade',
          headers: ['Grupo', 'Cidade', 'Qtd. Notas', 'Total Emitido', 'Total Recebido (PG)'],
          rows: Array.from(byCity.values()).map((c) => [
            c.group,
            c.city,
            c.count,
            formatBRL(c.total),
            formatBRL(c.paid),
          ]),
        },
      ],
      summaryItems: [
        { label: 'Total de Notas Conferidas', value: rows.length },
        { label: 'Valor Total Emitido', value: grandTotal, isCurrency: true },
        { label: 'Valor Total Recebido (PG)', value: totalPaid, isCurrency: true },
        {
          label: 'Saldo Pendente de Recebimento',
          value: roundMoney(grandTotal - totalPaid),
          isCurrency: true,
        },
      ],
    };

    if (format === 'docx') {
      const buf = await generateWordBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="financer-conferencia-notas-${year}.docx"`
      );
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="financer-conferencia-notas-${year}.pdf"`
    );
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
