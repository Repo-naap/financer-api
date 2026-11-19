import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { formatBRL, formatDateTimeBR } from '../domain/formatters.js';

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'currency' | 'number' | 'date';
  align?: 'left' | 'right' | 'center';
}

export interface ReportSubtotalSection {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

export interface ReportSummaryItem {
  label: string;
  value: string | number;
  isCurrency?: boolean;
  excelFormula?: string;
}

export interface ReportExportPayload {
  officeName: string;
  theme?: 'purple' | 'navy' | 'burgundy';
  title: string;
  periodLabel: string;
  generatedBy: string;
  generatedAt?: Date;
  filtersSummary?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  excelRowFormulas?: (rowNumber: number) => Record<string, string>;
  summaryItems: ReportSummaryItem[];
  subtotalSections?: ReportSubtotalSection[];
  landscape?: boolean;
}

function getThemePalette(theme: 'purple' | 'navy' | 'burgundy' = 'purple') {
  if (theme === 'navy') {
    return {
      dark: '#003566',
      primary: '#0074C4',
      darkHex: '003566',
      primaryHex: '0074C4',
      lightHex: 'D6EFFF',
      softBg: '#EDF8FF',
      zebraBg: '#F4FAFF',
      zebraHex: 'F4FAFF',
      subtitleColor: '#73C9FF',
      borderColor: '#00B4D8',
    };
  }
  if (theme === 'burgundy') {
    return {
      dark: '#5C1127',
      primary: '#881337',
      darkHex: '5C1127',
      primaryHex: '881337',
      lightHex: 'FFE4E6',
      softBg: '#FFF1F2',
      zebraBg: '#FFF5F6',
      zebraHex: 'FFF5F6',
      subtitleColor: '#FECDD3',
      borderColor: '#FDA4AF',
    };
  }
  return {
    dark: '#5C1241',
    primary: '#A82979',
    darkHex: '751853',
    primaryHex: 'A82979',
    lightHex: 'FAE3F2',
    softBg: '#FDF2F9',
    zebraBg: '#FEF7FB',
    zebraHex: 'FEF7FB',
    subtitleColor: '#FDE68A',
    borderColor: '#EB99CE',
  };
}

function formatCellText(value: unknown, col: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '-';
  if (col.type === 'currency') return formatBRL(Number(value));
  return String(value);
}

// ============================================================================
// 1. EXPORTAÇÃO PDF PROFISSIONAL (NÃO EDITÁVEL, PAGINAÇÃO, IDENTIFICAÇÃO)
// ============================================================================
export async function generatePdfBuffer(payload: ReportExportPayload): Promise<Buffer> {
  const pal = getThemePalette(payload.theme);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: payload.landscape ? 'landscape' : 'portrait',
      margin: 36,
      bufferPages: true,
      info: {
        Title: `FINANCER - ${payload.title}`,
        Author: payload.officeName,
        Creator: 'FINANCER – Gestão Financeira',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const generatedAtStr = formatDateTimeBR(payload.generatedAt || new Date());

    // Cabeçalho Institucional na cor da empresa ativa
    doc.rect(doc.page.margins.left, 28, pageWidth, 62).fill(pal.dark);
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('FINANCER – Gestão Financeira', doc.page.margins.left + 14, 38);
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(pal.subtitleColor)
      .text(payload.officeName, doc.page.margins.left + 14, 57);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#FFFFFF')
      .text(payload.title, doc.page.margins.left + 14, 71);

    // Metadados do Relatório
    let y = 100;
    doc.rect(doc.page.margins.left, y, pageWidth, 34).fill(pal.softBg);
    doc.fillColor('#334155').font('Helvetica').fontSize(8.5);
    doc.text(`Período: ${payload.periodLabel}`, doc.page.margins.left + 10, y + 6, {
      width: pageWidth * 0.5,
    });
    doc.text(`Emitido em: ${generatedAtStr}`, doc.page.margins.left + pageWidth * 0.5, y + 6, {
      width: pageWidth * 0.48,
      align: 'right',
    });
    doc.text(
      `Responsável: ${payload.generatedBy}${payload.filtersSummary ? `  |  Filtros: ${payload.filtersSummary}` : ''}`,
      doc.page.margins.left + 10,
      y + 19,
      { width: pageWidth - 20 }
    );

    y += 44;

    // Largura proporcional das colunas
    const totalWeight = payload.columns.reduce((acc, c) => acc + (c.width || 12), 0);
    const colWidths = payload.columns.map((c) => ((c.width || 12) / totalWeight) * pageWidth);

    const drawTableHeader = (startY: number): number => {
      doc.rect(doc.page.margins.left, startY, pageWidth, 20).fill(pal.primary);
      let x = doc.page.margins.left;
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
      payload.columns.forEach((col, i) => {
        doc.text(col.header, x + 3, startY + 6, {
          width: colWidths[i] - 6,
          align: col.align || (col.type === 'currency' || col.type === 'number' ? 'right' : 'left'),
          ellipsis: true,
          lineBreak: false,
        });
        x += colWidths[i];
      });
      return startY + 20;
    };

    y = drawTableHeader(y);

    if (payload.rows.length === 0) {
      doc
        .fillColor('#64748B')
        .font('Helvetica-Oblique')
        .fontSize(9)
        .text('Nenhum registro encontrado para os filtros selecionados.', doc.page.margins.left, y + 10);
      y += 30;
    } else {
      payload.rows.forEach((row, rowIdx) => {
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = drawTableHeader(36);
        }
        const rowHeight = 18;
        if (rowIdx % 2 === 1) {
          doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill(pal.zebraBg);
        }
        doc
          .strokeColor('#E2E8F0')
          .lineWidth(0.5)
          .moveTo(doc.page.margins.left, y + rowHeight)
          .lineTo(doc.page.margins.left + pageWidth, y + rowHeight)
          .stroke();

        let x = doc.page.margins.left;
        doc.fillColor('#1E293B').font('Helvetica').fontSize(7.5);
        payload.columns.forEach((col, i) => {
          const text = formatCellText(row[col.key], col);
          doc.text(text, x + 3, y + 5, {
            width: colWidths[i] - 6,
            align:
              col.align || (col.type === 'currency' || col.type === 'number' ? 'right' : 'left'),
            ellipsis: true,
            lineBreak: false,
          });
          x += colWidths[i];
        });
        y += rowHeight;
      });
    }

    // Subtotais (se houver)
    if (payload.subtotalSections && payload.subtotalSections.length > 0) {
      for (const sec of payload.subtotalSections) {
        if (sec.rows.length === 0) continue;
        if (y > doc.page.height - 110) {
          doc.addPage();
          y = 36;
        }
        y += 12;
        doc.fillColor(pal.dark).font('Helvetica-Bold').fontSize(9.5).text(sec.title, doc.page.margins.left, y);
        y += 14;

        const w = pageWidth / sec.headers.length;
        doc.rect(doc.page.margins.left, y, pageWidth, 16).fill(`#${pal.lightHex}`);
        doc.fillColor(pal.dark).font('Helvetica-Bold').fontSize(7.5);
        sec.headers.forEach((h, i) => {
          doc.text(h, doc.page.margins.left + i * w + 4, y + 4, { width: w - 8, ellipsis: true });
        });
        y += 16;

        doc.font('Helvetica').fillColor('#1E293B').fontSize(7.5);
        for (const r of sec.rows) {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = 36;
          }
          r.forEach((cell, i) => {
            doc.text(String(cell), doc.page.margins.left + i * w + 4, y + 4, {
              width: w - 8,
              ellipsis: true,
            });
          });
          y += 15;
        }
      }
    }

    // Resumo / Totais Gerais
    if (payload.summaryItems.length > 0) {
      const boxHeight = Math.ceil(payload.summaryItems.length / 2) * 20 + 28;
      if (y + boxHeight > doc.page.height - 50) {
        doc.addPage();
        y = 36;
      }
      y += 14;
      doc
        .rect(doc.page.margins.left, y, pageWidth, boxHeight)
        .fillAndStroke(pal.softBg, pal.borderColor);
      doc
        .fillColor(pal.dark)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('RESUMO E TOTAIS DO RELATÓRIO', doc.page.margins.left + 10, y + 8);

      const colHalf = (pageWidth - 24) / 2;
      payload.summaryItems.forEach((item, idx) => {
        const colIdx = idx % 2;
        const rowIdx = Math.floor(idx / 2);
        const ix = doc.page.margins.left + 10 + colIdx * colHalf;
        const iy = y + 24 + rowIdx * 18;
        const valText = item.isCurrency ? formatBRL(Number(item.value)) : String(item.value);
        doc.fillColor('#475569').font('Helvetica').fontSize(8.5).text(`${item.label}:`, ix, iy, {
          continued: true,
        });
        doc.fillColor(pal.dark).font('Helvetica-Bold').text(` ${valText}`);
      });
    }

    // Numeração de páginas em todas as folhas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 28;
      doc
        .strokeColor(pal.borderColor)
        .lineWidth(0.5)
        .moveTo(doc.page.margins.left, footerY - 4)
        .lineTo(doc.page.width - doc.page.margins.right, footerY - 4)
        .stroke();
      doc
        .fillColor('#64748B')
        .font('Helvetica')
        .fontSize(7.5)
        .text(
          `FINANCER – Gestão Financeira | ${payload.officeName} | Documento não editável`,
          doc.page.margins.left,
          footerY,
          { width: pageWidth * 0.72 }
        );
      doc.text(`Página ${i + 1} de ${range.count}`, doc.page.margins.left + pageWidth * 0.72, footerY, {
        width: pageWidth * 0.28,
        align: 'right',
      });
    }

    doc.end();
  });
}

// ============================================================================
// 2. EXPORTAÇÃO EXCEL (.XLSX EDITÁVEL, FÓRMULAS, MOEDA BR, FILTROS)
// ============================================================================
export async function generateExcelBuffer(payload: ReportExportPayload): Promise<Buffer> {
  const pal = getThemePalette(payload.theme);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FINANCER – Gestão Financeira';
  wb.created = payload.generatedAt || new Date();

  const sheet = wb.addWorksheet('Relatório', {
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  const colCount = Math.max(payload.columns.length, 4);
  const lastColLetter = sheet.getColumn(colCount).letter;

  // Cabeçalho institucional
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = `FINANCER – Gestão Financeira | ${payload.title}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pal.darkHex}` } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(`A2:${lastColLetter}2`);
  sheet.getCell('A2').value = `Empresa: ${payload.officeName}`;
  sheet.getCell('A2').font = { bold: true, size: 10, color: { argb: `FF${pal.darkHex}` } };

  sheet.mergeCells(`A3:${lastColLetter}3`);
  sheet.getCell('A3').value = `Período: ${payload.periodLabel}   |   Emitido em: ${formatDateTimeBR(
    payload.generatedAt || new Date()
  )}   |   Responsável: ${payload.generatedBy}`;
  sheet.getCell('A3').font = { size: 9, color: { argb: 'FF475569' } };

  if (payload.filtersSummary) {
    sheet.mergeCells(`A4:${lastColLetter}4`);
    sheet.getCell('A4').value = `Filtros aplicados: ${payload.filtersSummary}`;
    sheet.getCell('A4').font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  }

  // Cabeçalho da Tabela (linha 6)
  const headerRowIdx = 6;
  const headerRow = sheet.getRow(headerRowIdx);
  headerRow.height = 22;
  payload.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pal.primaryHex}` } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col.type === 'currency' || col.type === 'number' ? 'right' : 'left',
    };
    sheet.getColumn(i + 1).width = Math.max(col.width || 16, col.header.length + 4);
  });

  // Dados com suporte a fórmulas Excel
  const firstDataRow = headerRowIdx + 1;
  payload.rows.forEach((row, idx) => {
    const excelRowNumber = firstDataRow + idx;
    const xlRow = sheet.getRow(excelRowNumber);
    const formulas = payload.excelRowFormulas ? payload.excelRowFormulas(excelRowNumber) : {};

    payload.columns.forEach((col, cIdx) => {
      const cell = xlRow.getCell(cIdx + 1);
      const rawVal = row[col.key];
      if (formulas[col.key]) {
        cell.value = { formula: formulas[col.key], result: Number(rawVal ?? 0) };
      } else if (col.type === 'currency' || col.type === 'number') {
        cell.value = Number(rawVal ?? 0);
      } else {
        cell.value = rawVal === null || rawVal === undefined ? '' : String(rawVal);
      }

      if (col.type === 'currency') {
        cell.numFmt = '"R$" #,##0.00;-"R$" #,##0.00;"R$" 0.00';
      } else if (col.type === 'number') {
        cell.numFmt = '#,##0';
      }

      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pal.zebraHex}` } };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  const lastDataRow = Math.max(firstDataRow, firstDataRow + payload.rows.length - 1);

  // Linha automática de totais com fórmula =SUM(...) para colunas monetárias/numéricas
  let nextRowIdx = lastDataRow + 2;
  if (payload.rows.length > 0) {
    const totalRow = sheet.getRow(lastDataRow + 1);
    totalRow.getCell(1).value = 'TOTAIS';
    totalRow.getCell(1).font = { bold: true, color: { argb: `FF${pal.darkHex}` } };

    payload.columns.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pal.lightHex}` } };
      cell.font = { bold: true, color: { argb: `FF${pal.darkHex}` } };
      if (col.type === 'currency' && col.key !== 'running_balance' && col.key !== 'vpp') {
        const letter = sheet.getColumn(i + 1).letter;
        const sumVal = payload.rows.reduce((s, r) => s + Number(r[col.key] || 0), 0);
        cell.value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`, result: sumVal };
        cell.numFmt = '"R$" #,##0.00;-"R$" #,##0.00;"R$" 0.00';
      }
    });
    nextRowIdx = lastDataRow + 3;
  }

  // Ativar autofiltro na tabela principal
  sheet.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: payload.columns.length },
  };

  // Resumo e totais detalhados
  if (payload.summaryItems.length > 0) {
    const sumHeader = sheet.getRow(nextRowIdx);
    sumHeader.getCell(1).value = 'RESUMO CONSOLIDADO';
    sumHeader.getCell(1).font = { bold: true, size: 11, color: { argb: `FF${pal.darkHex}` } };
    nextRowIdx += 1;

    for (const item of payload.summaryItems) {
      const r = sheet.getRow(nextRowIdx);
      r.getCell(1).value = item.label;
      r.getCell(1).font = { bold: true };
      const valCell = r.getCell(2);
      if (item.excelFormula) {
        valCell.value = { formula: item.excelFormula, result: Number(item.value) };
      } else if (item.isCurrency) {
        valCell.value = Number(item.value);
      } else {
        valCell.value = item.value;
      }
      if (item.isCurrency) {
        valCell.numFmt = '"R$" #,##0.00;-"R$" #,##0.00;"R$" 0.00';
      }
      valCell.font = { bold: true, color: { argb: `FF${pal.darkHex}` } };
      nextRowIdx += 1;
    }
  }

  // Subtotais em aba separada se existirem
  if (payload.subtotalSections && payload.subtotalSections.length > 0) {
    const subSheet = wb.addWorksheet('Subtotais');
    let sr = 1;
    for (const sec of payload.subtotalSections) {
      if (sec.rows.length === 0) continue;
      subSheet.getCell(sr, 1).value = sec.title;
      subSheet.getCell(sr, 1).font = { bold: true, size: 12, color: { argb: `FF${pal.darkHex}` } };
      sr += 1;

      const hRow = subSheet.getRow(sr);
      sec.headers.forEach((h, i) => {
        const c = hRow.getCell(i + 1);
        c.value = h;
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pal.primaryHex}` } };
        subSheet.getColumn(i + 1).width = 22;
      });
      sr += 1;

      for (const row of sec.rows) {
        const dRow = subSheet.getRow(sr);
        row.forEach((v, i) => {
          dRow.getCell(i + 1).value = v;
        });
        sr += 1;
      }
      sr += 2;
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================================
// 3. EXPORTAÇÃO WORD (.DOCX EDITÁVEL, TABELAS ORGANIZADAS, IDENTIFICAÇÃO)
// ============================================================================
export async function generateWordBuffer(payload: ReportExportPayload): Promise<Buffer> {
  const pal = getThemePalette(payload.theme);
  const generatedAtStr = formatDateTimeBR(payload.generatedAt || new Date());

  const headerRow = new TableRow({
    tableHeader: true,
    children: payload.columns.map(
      (col) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: pal.darkHex },
          children: [
            new Paragraph({
              alignment:
                col.type === 'currency' || col.type === 'number'
                  ? AlignmentType.RIGHT
                  : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: col.header,
                  bold: true,
                  size: 17,
                  color: 'FFFFFF',
                }),
              ],
            }),
          ],
        })
    ),
  });

  const dataRows = payload.rows.map(
    (row, idx) =>
      new TableRow({
        children: payload.columns.map(
          (col) =>
            new TableCell({
              shading:
                idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: pal.zebraHex } : undefined,
              children: [
                new Paragraph({
                  alignment:
                    col.type === 'currency' || col.type === 'number'
                      ? AlignmentType.RIGHT
                      : AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: formatCellText(row[col.key], col),
                      size: 16,
                    }),
                  ],
                }),
              ],
            })
        ),
      })
  );

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: pal.primaryHex },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: pal.primaryHex },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
    rows: [headerRow, ...dataRows],
  });

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: 'FINANCER – Gestão Financeira',
          bold: true,
          color: pal.darkHex,
          size: 32,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: payload.officeName, bold: true, size: 22, color: '334155' }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [
        new TextRun({ text: payload.title, bold: true, size: 26, color: pal.primaryHex }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `Período: ${payload.periodLabel}  |  `, size: 18 }),
        new TextRun({ text: `Emitido em: ${generatedAtStr}  |  `, size: 18 }),
        new TextRun({ text: `Responsável: ${payload.generatedBy}`, size: 18 }),
      ],
    }),
  ];

  if (payload.filtersSummary) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: `Filtros aplicados: ${payload.filtersSummary}`,
            italics: true,
            size: 18,
            color: '475569',
          }),
        ],
      })
    );
  }

  if (payload.rows.length > 0) {
    children.push(mainTable);
  } else {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Nenhum registro encontrado para os filtros selecionados.',
            italics: true,
          }),
        ],
      })
    );
  }

  if (payload.subtotalSections) {
    for (const sec of payload.subtotalSections) {
      if (sec.rows.length === 0) continue;
      children.push(
        new Paragraph({
          spacing: { before: 240, after: 80 },
          children: [new TextRun({ text: sec.title, bold: true, size: 22, color: pal.darkHex })],
        })
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: sec.headers.map(
                (h) =>
                  new TableCell({
                    shading: { type: ShadingType.CLEAR, fill: pal.lightHex },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 17 })] })],
                  })
              ),
            }),
            ...sec.rows.map(
              (r) =>
                new TableRow({
                  children: r.map(
                    (c) =>
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: String(c), size: 16 })] })],
                      })
                  ),
                })
            ),
          ],
        })
      );
    }
  }

  if (payload.summaryItems.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 280, after: 100 },
        children: [
          new TextRun({
            text: 'Resumo e Totais Gerais',
            bold: true,
            size: 22,
            color: pal.darkHex,
          }),
        ],
      })
    );

    const summaryTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: payload.summaryItems.map(
        (item) =>
          new TableRow({
            children: [
              new TableCell({
                shading: { type: ShadingType.CLEAR, fill: pal.lightHex },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: item.label, bold: true, size: 18 })],
                  }),
                ],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: item.isCurrency ? formatBRL(Number(item.value)) : String(item.value),
                        bold: true,
                        size: 18,
                        color: pal.darkHex,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
      ),
    });
    children.push(summaryTable);
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: payload.landscape ? 'landscape' : 'portrait',
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
