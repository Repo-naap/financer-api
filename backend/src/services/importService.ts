import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import {
  calculateExpenseFinalAmount,
  calculateTripValues,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  roundMoney,
  TRIP_GROUPS,
} from '../domain/calculations.js';

const require = createRequire(import.meta.url);
// Importação direta do núcleo evita o bug do pdf-parse@1.1.1 em ESM
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  dataBuffer: Buffer
) => Promise<{ text: string; numpages: number }>;

export type ImportTargetModule = 'expenses' | 'trips' | 'reminders' | 'cash' | 'invoices';

export interface AnalyzedImportRow {
  rowIndex: number;
  sourceSheet: string;
  valid: boolean;
  warnings: string[];
  data: Record<string, unknown>;
}

export interface AnalyzeImportResult {
  filename: string;
  fileType: 'xlsx' | 'csv' | 'pdf';
  detectedModule: ImportTargetModule;
  detectedModuleLabel: string;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA';
  detectionReason: string;
  sheetsAnalyzed: string[];
  totalRowsFound: number;
  validCount: number;
  invalidCount: number;
  estimatedTotalAmount: number;
  rows: AnalyzedImportRow[];
}

export const MODULE_LABELS_PT: Record<ImportTargetModule, string> = {
  expenses: 'Despesas Mensais',
  trips: 'Viagens',
  reminders: 'Lembretes e Obrigações',
  cash: 'Caixa (Entradas e Saídas)',
  invoices: 'Conferência de Notas',
};

const MATRIX_MONTH_SLOTS: Record<string, { slot: string; month: number }> = {
  jan: { slot: 'JAN', month: 1 },
  janeiro: { slot: 'JAN', month: 1 },
  fev: { slot: 'FEV', month: 2 },
  fevereiro: { slot: 'FEV', month: 2 },
  mar: { slot: 'MAR', month: 3 },
  marco: { slot: 'MAR', month: 3 },
  pc: { slot: 'PC', month: 3 },
  abr: { slot: 'ABR', month: 4 },
  abril: { slot: 'ABR', month: 4 },
  mai: { slot: 'MAI', month: 5 },
  maio: { slot: 'MAI', month: 5 },
  jun: { slot: 'JUN', month: 6 },
  junho: { slot: 'JUN', month: 6 },
  jul: { slot: 'JUL', month: 7 },
  julho: { slot: 'JUL', month: 7 },
  ago: { slot: 'AGO', month: 8 },
  agosto: { slot: 'AGO', month: 8 },
  set: { slot: 'SET', month: 9 },
  setembro: { slot: 'SET', month: 9 },
  orc: { slot: 'ORC', month: 9 },
  'orc.': { slot: 'ORC', month: 9 },
  orcamento: { slot: 'ORC', month: 9 },
  out: { slot: 'OUT', month: 10 },
  outubro: { slot: 'OUT', month: 10 },
  nov: { slot: 'NOV', month: 11 },
  novembro: { slot: 'NOV', month: 11 },
  dez: { slot: 'DEZ', month: 12 },
  dezembro: { slot: 'DEZ', month: 12 },
};

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCellString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('result' in obj && obj.result !== undefined && obj.result !== null) {
      return extractCellString(obj.result);
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((r: { text?: string }) => r.text || '').join('');
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text;
    }
  }
  return String(val).trim();
}

export function parseBrMoney(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return roundMoney(val);
  const str = extractCellString(val);
  if (!str || str === '-' || str === '—') return 0;

  let clean = str.replace(/R\$/gi, '').replace(/\s+/g, '');
  let negative = false;
  if (clean.startsWith('(') && clean.endsWith(')')) {
    negative = true;
    clean = clean.slice(1, -1);
  }
  if (clean.startsWith('-')) {
    negative = true;
    clean = clean.slice(1);
  }

  // Detecta formato BR (1.250,50) vs US (1250.50)
  if (clean.includes(',') && clean.includes('.')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }

  const num = Number(clean);
  if (!Number.isFinite(num)) return 0;
  return roundMoney(negative ? -num : num);
}

export function parseBrDate(val: unknown, fallbackYear = new Date().getFullYear()): string | null {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Excel serial date
  if (typeof val === 'number' && val > 25000 && val < 75000) {
    const utcDays = Math.floor(val - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const s = extractCellString(val);
  if (!s) return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD/MM/YYYY ou DD.MM.YYYY ou DD-MM-YYYY
  m = /^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // DD.MM ou DD/MM (usando ano de referência)
  m = /^(\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${fallbackYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseCompetenceMonthYear(
  val: unknown,
  fallbackYear: number
): { year: number; month: number; slot: string } | null {
  const s = extractCellString(val);
  if (!s) return null;
  const n = normalizeText(s);

  // MM/AAAA ou AAAA-MM
  let m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month >= 1 && month <= 12) return { year, month, slot: 'MES' };
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year, month, slot: 'MES' };
  }

  // JAN/2026 ou PC/2026 ou ORÇ./2026
  m = /^([a-zç.]+)\/(\d{2,4})$/i.exec(n);
  if (m) {
    const slotInfo = MATRIX_MONTH_SLOTS[m[1].replace(/\.$/, '')] || MATRIX_MONTH_SLOTS[m[1]];
    let year = Number(m[2]);
    if (year < 100) year += 2000;
    if (slotInfo) return { year, month: slotInfo.month, slot: slotInfo.slot };
  }

  // Apenas mês nomeado (ex: Janeiro, JAN, PC, ORÇ.)
  const slotOnly = MATRIX_MONTH_SLOTS[n.replace(/\.$/, '')] || MATRIX_MONTH_SLOTS[n];
  if (slotOnly) return { year: fallbackYear, month: slotOnly.month, slot: slotOnly.slot };

  // Data completa -> extrai mês/ano
  const iso = parseBrDate(val, fallbackYear);
  if (iso) {
    const [y, mo] = iso.split('-').map(Number);
    return { year: y, month: mo, slot: 'MES' };
  }

  return null;
}

interface RawSheet {
  name: string;
  rows: unknown[][];
}

function parseCsvToSheet(buffer: Buffer, filename: string): RawSheet[] {
  let text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) {
    text = buffer.toString('latin1');
  }
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [{ name: filename, rows: [] }];

  // Detecta delimitador (; padrão Excel BR ou ,)
  const semiCount = (lines[0].match(/;/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  const delim = semiCount >= commaCount ? ';' : ',';

  const rows = lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  return [{ name: filename, rows }];
}

async function parseXlsxToSheets(buffer: Buffer): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const nameNorm = normalizeText(ws.name);
    if (nameNorm === 'subtotais') return;
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const arr: unknown[] = [];
      for (let c = 1; c <= row.cellCount; c++) {
        arr.push(row.getCell(c).value);
      }
      if (arr.some((v) => extractCellString(v) !== '')) {
        rows.push(arr);
      }
    });
    if (rows.length > 0) {
      sheets.push({ name: ws.name, rows });
    }
  });
  return sheets;
}

function isInvoiceMatrixSheet(rows: unknown[][]): boolean {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const norms = rows[i].map((c) => normalizeText(extractCellString(c)));
    const monthHits = norms.filter((n) => n in MATRIX_MONTH_SLOTS).length;
    if (monthHits >= 4) return true;
  }
  return false;
}

function parseInvoiceMatrixSheet(
  sheet: RawSheet,
  defaultYear: number,
  usesGroups: boolean,
  cityGroupLookup: Map<string, string>
): AnalyzedImportRow[] {
  const results: AnalyzedImportRow[] = [];
  let currentCity = '';
  let currentGroup = 'SEM_GRUPO';
  let currentSlotCols: Array<{ colIdx: number; slot: string; month: number }> = [];
  let agencyCol = -1;
  let valueCol = -1;

  // Tenta extrair o ano do título da aba ou da primeira linha
  let sheetYear = defaultYear;
  for (let i = 0; i < Math.min(sheet.rows.length, 3); i++) {
    const joined = sheet.rows[i].map(extractCellString).join(' ');
    const ym = /\b(20\d{2})\b/.exec(joined);
    if (ym) {
      sheetYear = Number(ym[1]);
      break;
    }
  }

  // Detecta grupo pelo nome da aba (ex: GP-A, GP-B, GP-C, GP-D, RH-Folha)
  const sheetNameNorm = normalizeText(sheet.name);
  let sheetDefaultGroup = 'SEM_GRUPO';
  if (usesGroups) {
    if (sheetNameNorm.includes('gp-a') || sheetNameNorm.includes('grupo a')) sheetDefaultGroup = 'GP-A';
    else if (sheetNameNorm.includes('gp-b') || sheetNameNorm.includes('grupo b')) sheetDefaultGroup = 'GP-B';
    else if (sheetNameNorm.includes('gp-c') || sheetNameNorm.includes('grupo c')) sheetDefaultGroup = 'GP-C';
    else if (sheetNameNorm.includes('gp-d') || sheetNameNorm.includes('grupo d')) sheetDefaultGroup = 'GP-D';
    else if (sheetNameNorm.includes('rh') || sheetNameNorm.includes('folha')) sheetDefaultGroup = 'RH-Folha';
  }

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const strs = row.map(extractCellString);
    const norms = strs.map(normalizeText);

    // Verifica se é uma linha de cabeçalho de Cidade (contém JAN, FEV, MAR...)
    const slotCols: Array<{ colIdx: number; slot: string; month: number }> = [];
    norms.forEach((n, idx) => {
      const found = MATRIX_MONTH_SLOTS[n.replace(/\.$/, '')] || MATRIX_MONTH_SLOTS[n];
      if (found) slotCols.push({ colIdx: idx, ...found });
    });

    if (slotCols.length >= 4) {
      currentSlotCols = slotCols;
      currentCity = strs[0] || sheet.name;
      agencyCol = norms.findIndex((n) => n.includes('agenc'));
      valueCol = norms.findIndex((n) => n === 'r$' || n.includes('valor'));
      if (agencyCol < 0) agencyCol = 1;
      if (valueCol < 0) valueCol = 2;

      const lookupGroup = cityGroupLookup.get(normalizeText(currentCity));
      currentGroup = usesGroups ? lookupGroup || sheetDefaultGroup || 'GP-A' : 'SEM_GRUPO';
      continue;
    }

    if (!currentCity || currentSlotCols.length === 0) continue;

    const firstCell = strs[0];
    const firstNorm = normalizeText(firstCell);
    if (
      !firstCell ||
      firstNorm.startsWith('total') ||
      firstNorm.includes('data de receb') ||
      firstNorm.startsWith('nenhuma nota')
    ) {
      continue;
    }

    // Linha de Fundo / Órgão (ex: PREFEITURA, SAÚDE, FMAS, FMDCA, EDUCAÇÃO)
    const fundName = firstCell.toUpperCase();
    const agency = agencyCol >= 0 ? strs[agencyCol] || '' : '';
    const refAmount = valueCol >= 0 ? parseBrMoney(row[valueCol]) : 0;

    // Verifica se a próxima linha é "DATA DE RECEB."
    const nextRow = sheet.rows[r + 1];
    const nextStrs = nextRow ? nextRow.map(extractCellString) : [];
    const hasReceiptRow = nextStrs[0] && normalizeText(nextStrs[0]).includes('data de receb');
    const bankAccount = hasReceiptRow && agencyCol >= 0 ? nextStrs[agencyCol] || '' : '';

    for (const sc of currentSlotCols) {
      const topVal = strs[sc.colIdx] || '';
      const botVal = hasReceiptRow ? nextStrs[sc.colIdx] || '' : '';
      if (!topVal && !botVal) continue;

      // Extrai "3013/27.02" ou "3013 / 27/02" ou apenas "3013"
      const combined = botVal || topVal;
      const nfMatch = /(\d{2,})/.exec(combined);
      const invoiceNumber = nfMatch ? nfMatch[1] : '';
      if (!invoiceNumber) continue;

      let receivedDate: string | null = null;
      const dateMatch = /\/\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/.exec(combined);
      if (dateMatch) {
        const d = Number(dateMatch[1]);
        const mo = Number(dateMatch[2]);
        let y = dateMatch[3] ? Number(dateMatch[3]) : sheetYear;
        if (y < 100) y += 2000;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          receivedDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
      }

      const topNorm = normalizeText(topVal);
      const status =
        topNorm.includes('pg') || topNorm.includes('pag') || receivedDate
          ? 'PG'
          : topNorm.includes('canc')
          ? 'CANCELADA'
          : 'EMITIDA';

      const warnings: string[] = [];
      if (refAmount <= 0) warnings.push('Valor zerado na coluna R$');

      results.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: refAmount > 0 && Boolean(invoiceNumber),
        warnings,
        data: {
          invoice_number: invoiceNumber,
          amount: refAmount,
          city_name: currentCity,
          fund_name: fundName,
          agency,
          bank_account: bankAccount,
          competence_year: sheetYear,
          competence_month: sc.month,
          competence_slot: sc.slot,
          invoice_group: currentGroup,
          status,
          received_date: receivedDate,
          notes: '',
        },
      });
    }

    if (hasReceiptRow) r += 1;
  }

  return results;
}

function findHeaderRow(rows: unknown[][]): { index: number; headers: string[] } {
  let bestIdx = 0;
  let bestScore = -1;
  const keywords = [
    'data',
    'dia',
    'valor',
    'despesa',
    'categoria',
    'nota',
    'colaborador',
    'municipio',
    'cidade',
    'fundo',
    'orgao',
    'grupo',
    'destino',
    'finalidade',
    'entrada',
    'saida',
    'vencimento',
    'conta',
    'digito',
    'descricao',
    'situacao',
    'tipo',
  ];

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const norms = rows[i].map((c) => normalizeText(extractCellString(c)));
    let score = 0;
    for (const cell of norms) {
      if (!cell) continue;
      if (keywords.some((k) => cell.includes(k))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return {
    index: bestIdx,
    headers: rows[bestIdx]?.map((c) => normalizeText(extractCellString(c))) || [],
  };
}

function detectTabularModule(
  headers: string[],
  sheetNames: string[],
  filename: string
): { module: ImportTargetModule; confidence: 'ALTA' | 'MEDIA' | 'BAIXA'; reason: string } {
  const joinedHeaders = headers.join(' | ');
  const context = normalizeText(`${filename} ${sheetNames.join(' ')}`);

  const scores: Record<ImportTargetModule, { score: number; hits: string[] }> = {
    expenses: { score: 0, hits: [] },
    trips: { score: 0, hits: [] },
    reminders: { score: 0, hits: [] },
    cash: { score: 0, hits: [] },
    invoices: { score: 0, hits: [] },
  };

  const add = (mod: ImportTargetModule, pts: number, label: string) => {
    scores[mod].score += pts;
    scores[mod].hits.push(label);
  };

  // Sinais de Despesas Mensais
  if (headers.some((h) => h.includes('despesa') || h.includes('categoria'))) add('expenses', 4, 'Despesa/Categoria');
  if (headers.some((h) => h.includes('desconto'))) add('expenses', 4, 'Desconto');
  if (headers.some((h) => h.includes('juros'))) add('expenses', 4, 'Juros');
  if (headers.some((h) => h.includes('valor original') || h.includes('valor final'))) add('expenses', 4, 'Valor Original/Final');
  if (headers.some((h) => h === 'tipo' || h.includes('tipo da despesa'))) add('expenses', 3, 'Tipo (Empresa/Pessoal)');
  if (context.includes('despesa')) add('expenses', 3, 'Nome do arquivo/aba');

  // Sinais de Viagens
  if (headers.some((h) => h.includes('colaborador'))) add('trips', 5, 'Colaborador');
  if (headers.some((h) => h.includes('vpp'))) add('trips', 5, 'VPP');
  if (headers.some((h) => h.includes('devol'))) add('trips', 4, 'Devolução');
  if (headers.some((h) => h.includes('pessoas'))) add('trips', 4, 'Pessoas');
  if (headers.some((h) => h.includes('municipio'))) add('trips', 3, 'Município');
  if (headers.some((h) => h.includes('forma'))) add('trips', 2, 'Forma de pagamento');
  if (context.includes('viag')) add('trips', 3, 'Nome do arquivo/aba');

  // Sinais de Lembretes
  if (headers.some((h) => h.includes('digito'))) add('reminders', 5, 'Dígito');
  if (headers.some((h) => h === 'conta' || h.includes('conta'))) add('reminders', 3, 'Conta');
  if (headers.some((h) => h.includes('vencimento'))) add('reminders', 5, 'Vencimento');
  if (headers.some((h) => h.includes('competencia'))) add('reminders', 3, 'Competência');
  if (context.includes('lembret') || context.includes('obrigac')) add('reminders', 4, 'Nome do arquivo/aba');

  // Sinais de Caixa
  if (headers.some((h) => h.includes('destino'))) add('cash', 5, 'Destino');
  if (headers.some((h) => h.includes('finalidade'))) add('cash', 5, 'Finalidade');
  if (headers.some((h) => h.includes('entrada'))) add('cash', 4, 'Entrada');
  if (headers.some((h) => h.includes('saida') && !h.includes('data de saida') && !h.includes('val. saida')))
    add('cash', 4, 'Saída');
  if (headers.some((h) => h.includes('saldo acumulado'))) add('cash', 4, 'Saldo Acumulado');
  if (context.includes('caixa')) add('cash', 3, 'Nome do arquivo/aba');

  // Sinais de Conferência de Notas
  if (headers.some((h) => h.includes('fundo') || h.includes('orgao') || h.includes('entidade')))
    add('invoices', 6, 'Fundo/Órgão');
  if (headers.some((h) => h.includes('cidade'))) add('invoices', 4, 'Cidade');
  if (headers.some((h) => h.includes('nº nota') || h.includes('numero da nota') || h === 'nota'))
    add('invoices', 5, 'Número da Nota');
  if (headers.some((h) => h.includes('mes') || h.includes('competencia'))) add('invoices', 2, 'Mês/Competência');
  if (headers.some((h) => h.includes('grupo'))) add('invoices', 2, 'Grupo');
  if (context.includes('conferencia') || context.includes('notas')) add('invoices', 4, 'Nome do arquivo/aba');

  const ranked = (Object.entries(scores) as Array<[ImportTargetModule, { score: number; hits: string[] }]>)
    .sort((a, b) => b[1].score - a[1].score);

  const top = ranked[0];
  if (top[1].score >= 8) {
    return {
      module: top[0],
      confidence: 'ALTA',
      reason: `Colunas identificadas: ${top[1].hits.join(', ')}.`,
    };
  }
  if (top[1].score >= 4) {
    return {
      module: top[0],
      confidence: 'MEDIA',
      reason: `Sinais detectados: ${top[1].hits.join(', ')} (${joinedHeaders.slice(0, 80)}).`,
    };
  }
  return {
    module: top[1].score > 0 ? top[0] : 'expenses',
    confidence: 'BAIXA',
    reason: 'Cabeçalhos genéricos — confira ou selecione manualmente o módulo de destino abaixo.',
  };
}

function colIndex(headers: string[], patterns: string[]): number {
  for (const pat of patterns) {
    const idx = headers.findIndex((h) => h === pat || h.includes(pat));
    if (idx >= 0) return idx;
  }
  return -1;
}

function mapTabularRowsToModule(
  sheet: RawSheet,
  headerIdx: number,
  headers: string[],
  targetModule: ImportTargetModule,
  defaultYear: number,
  companyName: string,
  usesGroups: boolean,
  cityGroupLookup: Map<string, string>
): AnalyzedImportRow[] {
  const rows: AnalyzedImportRow[] = [];

  for (let r = headerIdx + 1; r < sheet.rows.length; r++) {
    const raw = sheet.rows[r];
    const strs = raw.map(extractCellString);
    const firstNorm = normalizeText(strs[0] || '');
    if (
      strs.every((s) => !s) ||
      firstNorm === 'totais' ||
      firstNorm.startsWith('total ') ||
      firstNorm.startsWith('resumo')
    ) {
      continue;
    }

    const warnings: string[] = [];

    if (targetModule === 'expenses') {
      const dayIdx = colIndex(headers, ['dia', 'data']);
      const catIdx = colIndex(headers, ['despesa', 'categoria', 'descricao']);
      const nfIdx = colIndex(headers, ['nota fiscal', 'nf', 'nota']);
      const origIdx = colIndex(headers, ['valor original', 'valor bruto', 'valor']);
      const discIdx = colIndex(headers, ['desconto']);
      const intrIdx = colIndex(headers, ['juros']);
      const typeIdx = colIndex(headers, ['tipo']);
      const notesIdx = colIndex(headers, ['observac', 'obs']);

      const day = parseBrDate(dayIdx >= 0 ? raw[dayIdx] : strs[0], defaultYear);
      const rawCat = catIdx >= 0 ? strs[catIdx] : strs[1] || 'Gerais';
      let category: (typeof EXPENSE_CATEGORIES)[number] = 'Outros';
      let customDesc: string | null = null;

      const normCat = normalizeText(rawCat);
      if (normCat.startsWith('aliment')) category = 'Alimentação';
      else if (normCat.startsWith('farmac')) category = 'Farmácia';
      else if (normCat.startsWith('gerais') || normCat === 'geral') category = 'Gerais';
      else if (normCat.startsWith('combust')) category = 'Combustíveis';
      else {
        category = 'Outros';
        customDesc = rawCat.replace(/^outros\s*[-–:]\s*/i, '').trim() || 'Despesa importada';
      }

      const originalAmount = parseBrMoney(origIdx >= 0 ? raw[origIdx] : 0);
      const discount = discIdx >= 0 ? Math.max(0, parseBrMoney(raw[discIdx])) : 0;
      const interest = intrIdx >= 0 ? Math.max(0, parseBrMoney(raw[intrIdx])) : 0;
      const invoiceNumber = (nfIdx >= 0 ? strs[nfIdx] : '').replace(/\D/g, '');
      const rawType = normalizeText(typeIdx >= 0 ? strs[typeIdx] : 'empresa');
      const expenseType = rawType.includes('pesso') ? 'Pessoal' : 'Empresa';

      if (!day) warnings.push('Data inválida ou ausente');
      if (originalAmount <= 0) warnings.push('Valor original deve ser maior que zero');

      const finalAmount =
        originalAmount > 0 ? calculateExpenseFinalAmount(originalAmount, discount, interest) : 0;

      rows.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: Boolean(day && originalAmount > 0),
        warnings,
        data: {
          day: day || '',
          category,
          custom_description: customDesc,
          invoice_number: invoiceNumber,
          original_amount: originalAmount,
          discount,
          interest,
          final_amount: finalAmount,
          expense_type: expenseType,
          notes: notesIdx >= 0 ? strs[notesIdx] : '',
        },
      });
    } else if (targetModule === 'trips') {
      const grpIdx = colIndex(headers, ['grupo']);
      const colabIdx = colIndex(headers, ['colaborador', 'nome']);
      const munIdx = colIndex(headers, ['municipio', 'cidade']);
      const ufIdx = colIndex(headers, ['uf', 'estado']);
      const formIdx = colIndex(headers, ['forma', 'pagamento']);
      const depDateIdx = colIndex(headers, ['data de saida', 'dt. saida', 'saida']);
      const depValIdx = colIndex(headers, ['valor de saida', 'val. saida', 'disponibilizado']);
      const retDateIdx = colIndex(headers, ['data de devol', 'dt. devol']);
      const retValIdx = colIndex(headers, ['valor de devol', 'val. devol', 'devolvido']);
      const timesIdx = colIndex(headers, ['vezes']);
      const peopleIdx = colIndex(headers, ['pessoas']);

      const rawGroup = (grpIdx >= 0 ? strs[grpIdx] : 'GP-A').toUpperCase();
      const tripGroup = TRIP_GROUPS.includes(rawGroup as never) ? rawGroup : 'GP-A';
      const collaborator = colabIdx >= 0 ? strs[colabIdx] : '';
      let munRaw = munIdx >= 0 ? strs[munIdx] : '';
      let uf = ufIdx >= 0 ? strs[ufIdx].toUpperCase().slice(0, 2) : '';
      if (munRaw.includes('/')) {
        const parts = munRaw.split('/');
        munRaw = parts[0].trim();
        if (!uf && parts[1]) uf = parts[1].trim().toUpperCase().slice(0, 2);
      }

      const rawPm = normalizeText(formIdx >= 0 ? strs[formIdx] : 'pix');
      const paymentMethod = rawPm.includes('espec')
        ? 'Espécie'
        : rawPm.includes('cart')
        ? 'Cartão'
        : PAYMENT_METHODS[1];

      const departureDate = parseBrDate(depDateIdx >= 0 ? raw[depDateIdx] : null, defaultYear);
      const departureAmount = Math.max(0, parseBrMoney(depValIdx >= 0 ? raw[depValIdx] : 0));
      const returnDate = parseBrDate(retDateIdx >= 0 ? raw[retDateIdx] : null, defaultYear);
      const returnAmount = Math.max(0, parseBrMoney(retValIdx >= 0 ? raw[retValIdx] : 0));
      const timesCount = Math.max(1, Math.trunc(Number(timesIdx >= 0 ? raw[timesIdx] : 1) || 1));
      const peopleCount = Math.trunc(Number(peopleIdx >= 0 ? raw[peopleIdx] : 1) || 1);

      if (!collaborator) warnings.push('Colaborador ausente');
      if (!munRaw) warnings.push('Município ausente');
      if (!departureDate) warnings.push('Data de saída inválida');
      if (peopleCount <= 0) warnings.push('Quantidade de pessoas deve ser maior que zero');

      const calc =
        peopleCount > 0
          ? calculateTripValues(departureAmount, returnAmount, peopleCount)
          : { spentAmount: 0, vpp: 0 };

      rows.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: Boolean(collaborator && munRaw && departureDate && peopleCount > 0),
        warnings,
        data: {
          trip_group: tripGroup,
          collaborator,
          municipality_name: munRaw,
          state_uf: uf,
          payment_method: paymentMethod,
          departure_date: departureDate || '',
          departure_amount: departureAmount,
          return_date: returnDate,
          return_amount: returnAmount,
          times_count: timesCount,
          people_count: peopleCount,
          spent_amount: calc.spentAmount,
          vpp: calc.vpp,
        },
      });
    } else if (targetModule === 'reminders') {
      const descIdx = colIndex(headers, ['descricao', 'conta/desc', 'obrigacao']);
      const valIdx = colIndex(headers, ['valor']);
      const accIdx = colIndex(headers, ['conta']);
      const digIdx = colIndex(headers, ['digito']);
      const dueIdx = colIndex(headers, ['vencimento', 'data']);
      const compIdx = colIndex(headers, ['competencia']);
      const sitIdx = colIndex(headers, ['situacao', 'status']);
      const paidIdx = colIndex(headers, ['dt. pagamento', 'data pagamento', 'pagamento']);

      const description = descIdx >= 0 ? strs[descIdx] : '';
      const amount = parseBrMoney(valIdx >= 0 ? raw[valIdx] : 0);
      const rawAcc = normalizeText(accIdx >= 0 ? strs[accIdx] : '');
      const account = rawAcc.includes('pesso') ? 'PESSOAS' : companyName;

      const rawDig = (digIdx >= 0 ? strs[digIdx] : '09').toUpperCase().trim();
      const digit = rawDig === '10' || rawDig === 'PF' ? rawDig : '09';

      let dueDate = parseBrDate(dueIdx >= 0 ? raw[dueIdx] : null, defaultYear);
      const comp = parseCompetenceMonthYear(compIdx >= 0 ? raw[compIdx] : dueDate, defaultYear);
      if (!dueDate && comp) {
        dueDate = `${comp.year}-${String(comp.month).padStart(2, '0')}-15`;
      }

      const rawSit = normalizeText(sitIdx >= 0 ? strs[sitIdx] : '');
      const paidDate = parseBrDate(paidIdx >= 0 ? raw[paidIdx] : null, defaultYear);
      const status =
        rawSit.includes('pag') || paidDate
          ? 'PAGA'
          : rawSit.includes('susp')
          ? 'SUSPENSA'
          : 'PENDENTE';

      if (!description) warnings.push('Descrição ausente');
      if (amount <= 0) warnings.push('Valor deve ser maior que zero');
      if (!dueDate) warnings.push('Data de vencimento inválida');

      rows.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: Boolean(description && amount > 0 && dueDate),
        warnings,
        data: {
          description,
          amount,
          account,
          digit,
          due_date: dueDate || '',
          competence_year: comp?.year || (dueDate ? Number(dueDate.slice(0, 4)) : defaultYear),
          competence_month: comp?.month || (dueDate ? Number(dueDate.slice(5, 7)) : 1),
          status,
          paid_date: status === 'PAGA' ? paidDate || dueDate : null,
        },
      });
    } else if (targetModule === 'cash') {
      const dateIdx = colIndex(headers, ['data', 'dia']);
      const destIdx = colIndex(headers, ['destino', 'responsavel']);
      const purpIdx = colIndex(headers, ['finalidade', 'historico', 'descricao', 'motivo']);
      const inIdx = colIndex(headers, ['entrada']);
      const outIdx = colIndex(headers, ['saida']);
      const valIdx = colIndex(headers, ['valor']);

      const entryDate = parseBrDate(dateIdx >= 0 ? raw[dateIdx] : null, defaultYear);
      const destination = destIdx >= 0 ? strs[destIdx] : '';
      const purpose = purpIdx >= 0 ? strs[purpIdx] : '';

      let inflow = inIdx >= 0 ? Math.abs(parseBrMoney(raw[inIdx])) : 0;
      let outflow = outIdx >= 0 ? Math.abs(parseBrMoney(raw[outIdx])) : 0;
      if (inIdx < 0 && outIdx < 0 && valIdx >= 0) {
        const signed = parseBrMoney(raw[valIdx]);
        if (signed >= 0) inflow = signed;
        else outflow = Math.abs(signed);
      }

      if (!entryDate) warnings.push('Data inválida');
      if (!destination) warnings.push('Destino ausente');
      if (!purpose) warnings.push('Finalidade ausente');
      if (inflow > 0 && outflow > 0) warnings.push('Entrada e saída simultâneas não permitidas');
      if (inflow === 0 && outflow === 0) warnings.push('Informe valor de entrada ou saída');

      rows.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: Boolean(
          entryDate &&
            destination &&
            purpose &&
            ((inflow > 0 && outflow === 0) || (outflow > 0 && inflow === 0))
        ),
        warnings,
        data: {
          entry_date: entryDate || '',
          destination,
          purpose,
          inflow,
          outflow,
          entry_type: inflow > 0 ? 'ENTRADA' : 'SAIDA',
        },
      });
    } else if (targetModule === 'invoices') {
      const numIdx = colIndex(headers, ['numero da nota', 'nº nota', 'numero', 'nf', 'nota']);
      const valIdx = colIndex(headers, ['valor', 'r$']);
      const cityIdx = colIndex(headers, ['cidade', 'municipio']);
      const fundIdx = colIndex(headers, ['fundo', 'orgao', 'entidade']);
      const monthIdx = colIndex(headers, ['mes', 'competencia', 'ref']);
      const yearIdx = colIndex(headers, ['ano']);
      const grpIdx = colIndex(headers, ['grupo']);
      const sitIdx = colIndex(headers, ['situacao', 'status']);
      const recIdx = colIndex(headers, ['receb', 'pagamento']);
      const agIdx = colIndex(headers, ['agencia']);

      const invoiceNumber = (numIdx >= 0 ? strs[numIdx] : '').replace(/\D/g, '');
      const amount = parseBrMoney(valIdx >= 0 ? raw[valIdx] : 0);
      const cityName = cityIdx >= 0 ? strs[cityIdx] : '';
      const fundName = (fundIdx >= 0 ? strs[fundIdx] : 'PREFEITURA').toUpperCase();

      const explicitYear = yearIdx >= 0 ? Number(strs[yearIdx]) : 0;
      const comp = parseCompetenceMonthYear(
        monthIdx >= 0 ? raw[monthIdx] : null,
        explicitYear >= 2000 ? explicitYear : defaultYear
      );

      let invoiceGroup = 'SEM_GRUPO';
      if (usesGroups) {
        const gRaw = normalizeText(grpIdx >= 0 ? strs[grpIdx] : '');
        if (gRaw.includes('gp-a') || gRaw === 'a') invoiceGroup = 'GP-A';
        else if (gRaw.includes('gp-b') || gRaw === 'b') invoiceGroup = 'GP-B';
        else if (gRaw.includes('gp-c') || gRaw === 'c') invoiceGroup = 'GP-C';
        else if (gRaw.includes('gp-d') || gRaw === 'd') invoiceGroup = 'GP-D';
        else if (gRaw.includes('rh') || gRaw.includes('folha')) invoiceGroup = 'RH-Folha';
        else invoiceGroup = cityGroupLookup.get(normalizeText(cityName)) || 'GP-A';
      }

      const recDate = parseBrDate(recIdx >= 0 ? raw[recIdx] : null, comp?.year || defaultYear);
      const sitNorm = normalizeText(sitIdx >= 0 ? strs[sitIdx] : '');
      const status =
        sitNorm.includes('pg') || sitNorm.includes('pag') || recDate
          ? 'PG'
          : sitNorm.includes('canc')
          ? 'CANCELADA'
          : sitNorm.includes('pend')
          ? 'PENDENTE'
          : 'EMITIDA';

      if (!invoiceNumber) warnings.push('Número da nota ausente ou não numérico');
      if (amount <= 0) warnings.push('Valor deve ser maior que zero');
      if (!cityName) warnings.push('Cidade ausente');
      if (!comp) warnings.push('Mês/Ano inválido');

      rows.push({
        rowIndex: r + 1,
        sourceSheet: sheet.name,
        valid: Boolean(invoiceNumber && amount > 0 && cityName && comp),
        warnings,
        data: {
          invoice_number: invoiceNumber,
          amount,
          city_name: cityName,
          fund_name: fundName,
          agency: agIdx >= 0 ? strs[agIdx] : '',
          bank_account: '',
          competence_year: comp?.year || defaultYear,
          competence_month: comp?.month || 1,
          competence_slot: comp?.slot || 'MES',
          invoice_group: invoiceGroup,
          status,
          received_date: recDate,
          notes: '',
        },
      });
    }
  }

  return rows;
}

async function analyzePdfBuffer(
  buffer: Buffer,
  filename: string,
  overrideModule: ImportTargetModule | undefined,
  defaultYear: number,
  companyName: string,
  usesGroups: boolean,
  cityGroupLookup: Map<string, string>
): Promise<AnalyzeImportResult> {
  const parsed = await pdfParse(buffer);
  const fullText = parsed.text || '';
  const normFull = normalizeText(fullText);
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Detecta automaticamente o módulo pelo conteúdo textual do PDF
  let detectedModule: ImportTargetModule = overrideModule || 'expenses';
  let confidence: 'ALTA' | 'MEDIA' | 'BAIXA' = 'MEDIA';
  let detectionReason = 'Analisado a partir do texto extraído do PDF.';

  if (!overrideModule) {
    if (normFull.includes('conferencia de notas') || (normFull.includes('fundo') && normFull.includes('prefeitura'))) {
      detectedModule = 'invoices';
      confidence = 'ALTA';
      detectionReason = 'PDF identificado como relatório de Conferência de Notas.';
    } else if (normFull.includes('relatorio de viagens') || normFull.includes('vpp')) {
      detectedModule = 'trips';
      confidence = 'ALTA';
      detectionReason = 'PDF identificado como relatório de Viagens.';
    } else if (normFull.includes('lembretes') || normFull.includes('obrigacoes recorrentes') || normFull.includes('digito')) {
      detectedModule = 'reminders';
      confidence = 'ALTA';
      detectionReason = 'PDF identificado como relatório de Lembretes / Obrigações.';
    } else if (normFull.includes('movimentacao do caixa') || (normFull.includes('entrada') && normFull.includes('saida') && normFull.includes('saldo acumulado'))) {
      detectedModule = 'cash';
      confidence = 'ALTA';
      detectionReason = 'PDF identificado como relatório de Movimentação do Caixa.';
    } else if (normFull.includes('despesas mensais') || normFull.includes('nota fiscal') || normFull.includes('alimentacao')) {
      detectedModule = 'expenses';
      confidence = 'ALTA';
      detectionReason = 'PDF identificado como relatório de Despesas Mensais.';
    } else {
      confidence = 'BAIXA';
      detectionReason = 'PDF genérico — revise o módulo de destino e os registros identificados abaixo.';
    }
  } else {
    detectionReason = `Módulo definido manualmente pelo usuário: ${MODULE_LABELS_PT[overrideModule]}.`;
  }

  const rows: AnalyzedImportRow[] = [];
  const moneyRegex = /-?R\$\s*[\d.]+,\d{2}/g;
  const bareMoneyRegex = /(?<!\d)-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
  const dateRegex = /(?<!\d)(\d{2}\/\d{2}\/\d{4})(?!\d)/;

  const isSkippableMetaLine = (nLine: string) =>
    nLine.startsWith('financer') ||
    nLine.startsWith('periodo:') ||
    nLine.startsWith('emitido em:') ||
    nLine.startsWith('responsavel:') ||
    nLine.startsWith('total') ||
    nLine.startsWith('subtotal') ||
    nLine.startsWith('resumo') ||
    nLine.startsWith('pagina ');

  // Verifica se o PDF já vem com registros em linha única (data + valor na mesma linha)
  // ou se o pdf-parse quebrou cada célula da tabela em linhas separadas (comum em tabelas PDFKit/Excel->PDF)
  const singleLineHits = lines.filter((l) => {
    const n = normalizeText(l);
    if (isSkippableMetaLine(n)) return false;
    return Boolean((l.match(moneyRegex) || l.match(bareMoneyRegex)) && (dateRegex.test(l) || detectedModule === 'invoices'));
  }).length;

  let logicalLines: string[] = lines;
  if (singleLineHits === 0) {
    const grouped: string[] = [];
    let currentGroup: string[] = [];

    const flushGroup = () => {
      if (currentGroup.length > 0) {
        grouped.push(currentGroup.join('  '));
        currentGroup = [];
      }
    };

    for (const line of lines) {
      const nLine = normalizeText(line);
      if (isSkippableMetaLine(nLine)) {
        flushGroup();
        continue;
      }

      const startsDateRow = /^\d{2}\/\d{2}\/\d{4}/.test(line);
      const startsInvoiceRow =
        detectedModule === 'invoices' &&
        (/^\d{2,6}$/.test(line) || /^(GP-[ABCD]|RH-Folha|SEM_GRUPO)\b/i.test(line));
      const startsTripRow =
        detectedModule === 'trips' && /^(GP-[ABCD]|ALFA)\b/i.test(line);

      if (startsDateRow || startsInvoiceRow || startsTripRow) {
        flushGroup();
        currentGroup.push(line);
      } else if (currentGroup.length > 0) {
        currentGroup.push(line);
        if (currentGroup.length >= 12) {
          flushGroup();
        }
      }
    }
    flushGroup();
    if (grouped.length > 0) {
      logicalLines = grouped;
    }
  }

  logicalLines.forEach((line, idx) => {
    const nLine = normalizeText(line);
    if (isSkippableMetaLine(nLine)) {
      return;
    }

    const moneys = line.match(moneyRegex) || line.match(bareMoneyRegex) || [];
    const dateMatch = dateRegex.exec(line);
    if (moneys.length === 0) return;

    const firstVal = parseBrMoney(moneys[0]);
    if (firstVal === 0 && moneys.length === 1) return;

    if (detectedModule === 'expenses') {
      if (!dateMatch) return;
      const day = parseBrDate(dateMatch[1], defaultYear);
      const orig = parseBrMoney(moneys[0]);
      const disc = moneys.length >= 3 ? Math.max(0, parseBrMoney(moneys[1])) : 0;
      const intr = moneys.length >= 4 ? Math.max(0, parseBrMoney(moneys[2])) : 0;
      const fin = orig > 0 ? calculateExpenseFinalAmount(orig, disc, intr) : 0;
      const expType = nLine.includes('pessoal') ? 'Pessoal' : 'Empresa';

      let category: (typeof EXPENSE_CATEGORIES)[number] = 'Outros';
      let customDesc: string | null = null;
      if (nLine.includes('alimentac')) category = 'Alimentação';
      else if (nLine.includes('farmac')) category = 'Farmácia';
      else if (nLine.includes('gerais')) category = 'Gerais';
      else if (nLine.includes('combust')) category = 'Combustíveis';
      else {
        const cleaned = line
          .replace(dateRegex, '')
          .replace(moneyRegex, '')
          .replace(/Empresa|Pessoal/gi, '')
          .trim();
        customDesc = cleaned.slice(0, 120) || 'Despesa importada via PDF';
      }

      const nfMatch = /(?<!\d)(\d{3,})(?!\d)/.exec(
        line.replace(dateRegex, ' ').replace(moneyRegex, ' ')
      );
      rows.push({
        rowIndex: idx + 1,
        sourceSheet: 'PDF',
        valid: Boolean(day && orig > 0),
        warnings: !day ? ['Data não reconhecida'] : [],
        data: {
          day: day || '',
          category,
          custom_description: customDesc,
          invoice_number: nfMatch ? nfMatch[1] : '',
          original_amount: orig,
          discount: disc,
          interest: intr,
          final_amount: fin,
          expense_type: expType,
          notes: 'Importado via PDF',
        },
      });
    } else if (detectedModule === 'cash') {
      if (!dateMatch) return;
      const entryDate = parseBrDate(dateMatch[1], defaultYear);
      const textOnly = line
        .replace(dateRegex, '')
        .replace(moneyRegex, '')
        .trim();
      const inflow = moneys.length >= 2 ? Math.max(0, parseBrMoney(moneys[0])) : Math.max(0, firstVal);
      const outflow = moneys.length >= 2 ? Math.max(0, parseBrMoney(moneys[1])) : firstVal < 0 ? Math.abs(firstVal) : 0;
      const parts = textOnly.split(/\s{2,}|[-|]/).filter(Boolean);
      const destination = parts[0] || textOnly.slice(0, 80) || 'Movimentação PDF';
      const purpose = parts.slice(1).join(' ') || textOnly.slice(0, 140) || 'Importado via PDF';
      const valid = Boolean(
        entryDate && ((inflow > 0 && outflow === 0) || (outflow > 0 && inflow === 0))
      );
      rows.push({
        rowIndex: idx + 1,
        sourceSheet: 'PDF',
        valid,
        warnings: valid ? [] : ['Verifique valores de entrada/saída'],
        data: {
          entry_date: entryDate || '',
          destination,
          purpose,
          inflow,
          outflow,
          entry_type: inflow > 0 ? 'ENTRADA' : 'SAIDA',
        },
      });
    } else if (detectedModule === 'reminders') {
      if (!dateMatch) return;
      const dueDate = parseBrDate(dateMatch[1], defaultYear);
      const amount = Math.abs(firstVal);
      const account = nLine.includes('pessoas') ? 'PESSOAS' : companyName;
      const digit = nLine.includes(' 10 ') ? '10' : nLine.includes(' pf ') ? 'PF' : '09';
      const status = nLine.includes('paga') ? 'PAGA' : 'PENDENTE';
      const desc = line
        .replace(dateRegex, '')
        .replace(moneyRegex, '')
        .replace(/PESSOAS|NAAP|INFOR MANAGER|CONTABILITÁ|PAGA|PENDENTE|09|10|PF/gi, '')
        .trim()
        .slice(0, 180);
      rows.push({
        rowIndex: idx + 1,
        sourceSheet: 'PDF',
        valid: Boolean(dueDate && amount > 0 && desc),
        warnings: !desc ? ['Descrição não identificada'] : [],
        data: {
          description: desc || 'Obrigação importada PDF',
          amount,
          account,
          digit,
          due_date: dueDate || '',
          competence_year: dueDate ? Number(dueDate.slice(0, 4)) : defaultYear,
          competence_month: dueDate ? Number(dueDate.slice(5, 7)) : 1,
          status,
          paid_date: status === 'PAGA' ? dueDate : null,
        },
      });
    } else if (detectedModule === 'invoices') {
      const amount = Math.abs(firstVal);
      const nfMatch = /(?<!\d)(\d{2,})(?!\d)/.exec(
        line.replace(dateRegex, ' ').replace(moneyRegex, ' ')
      );
      const compMatch = /(?<!\d)(\d{2}\/\d{4}|(?:JAN|FEV|MAR|PC|ABR|MAI|JUN|JUL|AGO|SET|ORÇ\.?|ORC\.?|OUT|NOV|DEZ)\/\d{4})/i.exec(line);
      const comp = parseCompetenceMonthYear(compMatch?.[1] || null, defaultYear) || {
        year: defaultYear,
        month: 1,
        slot: 'MES',
      };
      const cleaned = line
        .replace(moneyRegex, '')
        .replace(dateRegex, '')
        .trim();
      const cityCandidate =
        Array.from(cityGroupLookup.keys()).find((c) => nLine.includes(c)) || '';
      const fundCandidate =
        ['PREFEITURA', 'SAÚDE', 'FMAS', 'FMDCA', 'EDUCAÇÃO', 'PM-FOLHA', 'CÂMARA'].find((f) =>
          nLine.includes(normalizeText(f))
        ) || 'PREFEITURA';
      const invoiceGroup = usesGroups
        ? cityGroupLookup.get(cityCandidate) || 'GP-A'
        : 'SEM_GRUPO';

      rows.push({
        rowIndex: idx + 1,
        sourceSheet: 'PDF',
        valid: Boolean(nfMatch?.[1] && amount > 0 && (cityCandidate || cleaned)),
        warnings: !cityCandidate ? ['Cidade extraída do texto — confira antes de importar'] : [],
        data: {
          invoice_number: nfMatch?.[1] || '',
          amount,
          city_name: cityCandidate
            ? cityCandidate.replace(/\b\w/g, (l) => l.toUpperCase())
            : cleaned.slice(0, 40),
          fund_name: fundCandidate,
          agency: '',
          bank_account: '',
          competence_year: comp.year,
          competence_month: comp.month,
          competence_slot: comp.slot,
          invoice_group: invoiceGroup,
          status: nLine.includes('pg') || dateMatch ? 'PG' : 'EMITIDA',
          received_date: dateMatch ? parseBrDate(dateMatch[1], comp.year) : null,
          notes: 'Importado via PDF',
        },
      });
    } else if (detectedModule === 'trips') {
      if (!dateMatch) return;
      const depDate = parseBrDate(dateMatch[1], defaultYear);
      const depVal = Math.abs(parseBrMoney(moneys[0]));
      const retVal = moneys.length >= 2 ? Math.abs(parseBrMoney(moneys[1])) : 0;
      const grpMatch = /\b(GP-A|GP-B|GP-C|GP-D|ALFA)\b/i.exec(line);
      const ufMatch = /\/([A-Z]{2})\b/.exec(line);
      const textClean = line.replace(dateRegex, '').replace(moneyRegex, '').trim();
      const calc = calculateTripValues(depVal, retVal, 1);

      rows.push({
        rowIndex: idx + 1,
        sourceSheet: 'PDF',
        valid: Boolean(depDate && depVal > 0 && textClean),
        warnings: ['Confira município e quantidade de pessoas extraídos do PDF'],
        data: {
          trip_group: grpMatch ? grpMatch[1].toUpperCase() : 'GP-A',
          collaborator: textClean.slice(0, 60) || 'Colaborador PDF',
          municipality_name: 'Recife',
          state_uf: ufMatch ? ufMatch[1] : 'PE',
          payment_method: nLine.includes('cartao') ? 'Cartão' : nLine.includes('especie') ? 'Espécie' : 'PIX',
          departure_date: depDate || '',
          departure_amount: depVal,
          return_date: null,
          return_amount: retVal,
          times_count: 1,
          people_count: 1,
          spent_amount: calc.spentAmount,
          vpp: calc.vpp,
        },
      });
    }
  });

  const validRows = rows.filter((r) => r.valid);
  const estimatedTotalAmount = roundMoney(
    validRows.reduce((s, r) => {
      const d = r.data;
      return s + Number(d.final_amount ?? d.spent_amount ?? d.amount ?? d.inflow ?? d.outflow ?? 0);
    }, 0)
  );

  return {
    filename,
    fileType: 'pdf',
    detectedModule,
    detectedModuleLabel: MODULE_LABELS_PT[detectedModule],
    confidence,
    detectionReason,
    sheetsAnalyzed: [`PDF (${parsed.numpages} pág.)`],
    totalRowsFound: rows.length,
    validCount: validRows.length,
    invalidCount: rows.length - validRows.length,
    estimatedTotalAmount,
    rows,
  };
}

export async function analyzeUploadedFile(params: {
  buffer: Buffer;
  filename: string;
  overrideModule?: ImportTargetModule;
  referenceYear?: number;
  companyName: string;
  usesGroups: boolean;
  cityGroupLookup: Map<string, string>;
}): Promise<AnalyzeImportResult> {
  const ext = params.filename.toLowerCase().split('.').pop() || '';
  const defaultYear = params.referenceYear || new Date().getFullYear();

  if (ext === 'pdf') {
    return analyzePdfBuffer(
      params.buffer,
      params.filename,
      params.overrideModule,
      defaultYear,
      params.companyName,
      params.usesGroups,
      params.cityGroupLookup
    );
  }

  const fileType: 'xlsx' | 'csv' = ext === 'csv' || ext === 'txt' ? 'csv' : 'xlsx';
  const sheets =
    fileType === 'csv'
      ? parseCsvToSheet(params.buffer, params.filename)
      : await parseXlsxToSheets(params.buffer);

  if (sheets.length === 0) {
    throw new Error('A planilha enviada está vazia ou não possui abas legíveis.');
  }

  // 1. Verifica se é planilha matricial de Conferência de Notas (estilo Tacaratu JAN..DEZ + PG + DATA DE RECEB.)
  const matrixSheets = sheets.filter((s) => isInvoiceMatrixSheet(s.rows));
  if (
    matrixSheets.length > 0 &&
    (!params.overrideModule || params.overrideModule === 'invoices')
  ) {
    const allMatrixRows = matrixSheets.flatMap((s) =>
      parseInvoiceMatrixSheet(s, defaultYear, params.usesGroups, params.cityGroupLookup)
    );
    const validRows = allMatrixRows.filter((r) => r.valid);
    const estimatedTotalAmount = roundMoney(
      validRows.reduce((s, r) => s + Number(r.data.amount || 0), 0)
    );
    return {
      filename: params.filename,
      fileType,
      detectedModule: 'invoices',
      detectedModuleLabel: MODULE_LABELS_PT.invoices,
      confidence: 'ALTA',
      detectionReason: `Planilha matricial anual detectada (${matrixSheets.length} aba(s) com colunas JAN..DEZ / PG / DATA DE RECEB.).`,
      sheetsAnalyzed: matrixSheets.map((s) => s.name),
      totalRowsFound: allMatrixRows.length,
      validCount: validRows.length,
      invalidCount: allMatrixRows.length - validRows.length,
      estimatedTotalAmount,
      rows: allMatrixRows,
    };
  }

  // 2. Planilha tabular padrão: detecta módulo pelos cabeçalhos da primeira aba principal
  const firstSheet = sheets[0];
  const { index: headerIdx, headers } = findHeaderRow(firstSheet.rows);
  const auto = detectTabularModule(
    headers,
    sheets.map((s) => s.name),
    params.filename
  );
  const targetModule = params.overrideModule || auto.module;

  const allRows: AnalyzedImportRow[] = [];
  for (const s of sheets) {
    const h = findHeaderRow(s.rows);
    const mapped = mapTabularRowsToModule(
      s,
      h.index,
      h.headers,
      targetModule,
      defaultYear,
      params.companyName,
      params.usesGroups,
      params.cityGroupLookup
    );
    allRows.push(...mapped);
  }

  const validRows = allRows.filter((r) => r.valid);
  const estimatedTotalAmount = roundMoney(
    validRows.reduce((s, r) => {
      const d = r.data;
      return s + Number(d.final_amount ?? d.spent_amount ?? d.amount ?? d.inflow ?? d.outflow ?? 0);
    }, 0)
  );

  return {
    filename: params.filename,
    fileType,
    detectedModule: targetModule,
    detectedModuleLabel: MODULE_LABELS_PT[targetModule],
    confidence: params.overrideModule ? 'ALTA' : auto.confidence,
    detectionReason: params.overrideModule
      ? `Destino selecionado manualmente: ${MODULE_LABELS_PT[params.overrideModule]}.`
      : auto.reason,
    sheetsAnalyzed: sheets.map((s) => s.name),
    totalRowsFound: allRows.length,
    validCount: validRows.length,
    invalidCount: allRows.length - validRows.length,
    estimatedTotalAmount,
    rows: allRows,
  };
}
