import { Router } from 'express';
import { getDb } from '../db/index.js';
import { formatCompetenceBR, formatDateTimeBR } from '../domain/formatters.js';
import { HttpError } from '../domain/periodLock.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requirePermission } from '../middleware/authorize.js';
import {
  computeMonthlyClosingSummary,
  confirmMonthlyClosing,
  reopenMonthlyClosing,
} from '../services/closingService.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  generateWordBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const closingRouter = Router();

closingRouter.use(requireAuth);

closingRouter.get('/', requirePermission('closing', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const resRows = await db.query<Record<string, unknown>>(
      'SELECT * FROM monthly_closings WHERE company_code = $1 ORDER BY year DESC, month DESC',
      [req.user!.companyCode]
    );
    res.json({
      items: resRows.rows.map((r) => ({
        ...r,
        competence: formatCompetenceBR(Number(r.year), Number(r.month)),
        opening_balance: Number(r.opening_balance),
        total_personal_expenses: Number(r.total_personal_expenses),
        total_company_expenses: Number(r.total_company_expenses),
        total_trips: Number(r.total_trips),
        total_inflows: Number(r.total_inflows),
        total_outflows: Number(r.total_outflows),
        closing_balance: Number(r.closing_balance),
        pending_reminders_amount: Number(r.pending_reminders_amount),
      })),
    });
  } catch (err) {
    next(err);
  }
});

closingRouter.get('/:year/:month', requirePermission('closing', 'view'), async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new HttpError(400, 'Ano e mês inválidos para consulta de fechamento.');
    }
    const summary = await computeMonthlyClosingSummary(req.user!.companyCode, year, month);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

closingRouter.post(
  '/:year/:month/close',
  requirePermission('closing', 'close_period'),
  async (req, res, next) => {
    try {
      const year = Number(req.params.year);
      const month = Number(req.params.month);
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
      const result = await confirmMonthlyClosing({
        companyCode: req.user!.companyCode,
        year,
        month,
        notes,
        userId: req.user!.id,
        userName: req.user!.name,
        ipAddress: req.clientIp,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

closingRouter.post(
  '/:year/:month/reopen',
  requireAdmin,
  requirePermission('closing', 'reopen_period'),
  async (req, res, next) => {
    try {
      const year = Number(req.params.year);
      const month = Number(req.params.month);
      const justification = String(req.body?.justification || '');
      const result = await reopenMonthlyClosing({
        companyCode: req.user!.companyCode,
        year,
        month,
        justification,
        userId: req.user!.id,
        userName: req.user!.name,
        ipAddress: req.clientIp,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

closingRouter.get(
  '/:year/:month/export',
  requirePermission('closing', 'export'),
  async (req, res, next) => {
    try {
      const year = Number(req.params.year);
      const month = Number(req.params.month);
      const format = String(req.query.format || 'pdf').toLowerCase();
      const db = getDb();

      const summary = await computeMonthlyClosingSummary(req.user!.companyCode, year, month, db);

      const rows = [
        { item: 'Saldo Inicial Transportado', amount: summary.openingBalance, detail: 'Saldo inicial da competência' },
        { item: 'Despesas Pessoais', amount: summary.totalPersonalExpenses, detail: `${summary.expensesCount} lançamento(s) total no mês` },
        { item: 'Despesas Empresariais', amount: summary.totalCompanyExpenses, detail: 'Despesas do tipo Empresa' },
        { item: 'Despesas com Viagens', amount: summary.totalTrips, detail: `${summary.tripsCount} viagem(ns) registrada(s)` },
        { item: 'Total de Entradas no Caixa', amount: summary.totalInflows, detail: 'Entradas registradas no período' },
        { item: 'Total de Saídas no Caixa', amount: summary.totalOutflows, detail: 'Saídas registradas no período' },
        { item: 'Saldo Final do Período', amount: summary.closingBalance, detail: 'Transportado automaticamente ao mês seguinte' },
        { item: 'Contas / Lembretes Pagos', amount: summary.paidRemindersAmount, detail: `${summary.paidRemindersCount} conta(s) paga(s)` },
        { item: 'Contas / Lembretes Pendentes', amount: summary.pendingRemindersAmount, detail: `${summary.pendingRemindersCount} conta(s) pendente(s)` },
      ];

      const payload: ReportExportPayload = {
        officeName: req.user!.companyName,
        theme: req.user!.companyTheme,
        title: `Relatório de Fechamento Mensal – ${summary.competence}`,
        periodLabel: `Competência ${summary.competence} (${summary.status})`,
        generatedBy: req.user!.name,
        filtersSummary: `Empresa: ${req.user!.companyName} | Situação da Conciliação: ${summary.reconciliationStatus}`,
        columns: [
          { key: 'item', header: 'Indicador do Fechamento', width: 32, type: 'text' },
          { key: 'amount', header: 'Valor (R$)', width: 18, type: 'currency' },
          { key: 'detail', header: 'Observação / Detalhamento', width: 40, type: 'text' },
        ],
        rows,
        summaryItems: [
          { label: 'Status do Período', value: summary.status },
          { label: 'Resultado da Conciliação', value: summary.reconciliationStatus },
          { label: 'Saldo Final do Período', value: summary.closingBalance, isCurrency: true },
          {
            label: 'Fechado por',
            value: summary.record?.closed_by_name
              ? `${summary.record.closed_by_name} em ${formatDateTimeBR(summary.record.closed_at as string)}`
              : 'Período ainda não fechado',
          },
        ],
      };

      if (format === 'xlsx') {
        const buf = await generateExcelBuffer(payload);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="financer-fechamento-${year}-${String(month).padStart(2, '0')}.xlsx"`
        );
        res.send(buf);
        return;
      }

      if (format === 'docx') {
        const buf = await generateWordBuffer(payload);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="financer-fechamento-${year}-${String(month).padStart(2, '0')}.docx"`
        );
        res.send(buf);
        return;
      }

      const buf = await generatePdfBuffer(payload);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="financer-fechamento-${year}-${String(month).padStart(2, '0')}.pdf"`
      );
      res.send(buf);
    } catch (err) {
      next(err);
    }
  }
);
