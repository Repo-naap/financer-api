import { Router } from 'express';
import { getDb } from '../db/index.js';
import { formatDateBR, formatDateTimeBR } from '../domain/formatters.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import {
  generateExcelBuffer,
  generatePdfBuffer,
  ReportExportPayload,
} from '../services/exportService.js';

export const auditRouter = Router();

auditRouter.use(requireAuth);

function buildAuditFilterSql(companyCode: string, query: Record<string, unknown>) {
  const conditions: string[] = ['a.company_code = $1'];
  const params: unknown[] = [companyCode];

  const userId = typeof query.userId === 'string' && query.userId && query.userId !== 'ALL' ? query.userId : '';
  const operation =
    typeof query.operation === 'string' && query.operation && query.operation !== 'ALL'
      ? query.operation
      : '';
  const moduleName =
    typeof query.module === 'string' && query.module && query.module !== 'ALL'
      ? query.module
      : '';
  const startDate = typeof query.startDate === 'string' && query.startDate ? query.startDate : '';
  const endDate = typeof query.endDate === 'string' && query.endDate ? query.endDate : '';
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : '';

  if (userId) {
    params.push(userId);
    conditions.push(`a.user_id = $${params.length}`);
  }
  if (operation) {
    params.push(operation);
    conditions.push(`a.operation = $${params.length}`);
  }
  if (moduleName) {
    params.push(moduleName);
    conditions.push(`a.module = $${params.length}`);
  }
  if (startDate) {
    params.push(`${startDate}T00:00:00.000Z`);
    conditions.push(`a.created_at >= $${params.length}::timestamptz`);
  }
  if (endDate) {
    params.push(`${endDate}T23:59:59.999Z`);
    conditions.push(`a.created_at <= $${params.length}::timestamptz`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(a.user_name ILIKE $${params.length} OR a.description ILIKE $${params.length} OR a.module ILIKE $${params.length} OR COALESCE(a.record_id, '') ILIKE $${params.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
    startDate,
    endDate,
    operation,
    moduleName,
  };
}

auditRouter.get('/', requirePermission('audit', 'view'), async (req, res, next) => {
  try {
    const db = getDb();
    const { whereClause, params } = buildAuditFilterSql(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    const countRes = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM audit_logs a ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.cnt || 0);

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM audit_logs a
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    const usersRes = await db.query<{ id: string; name: string; login: string }>(
      'SELECT id, name, login FROM users ORDER BY name ASC'
    );

    res.json({
      items: rowsRes.rows,
      total,
      page,
      pageSize,
      users: usersRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

auditRouter.get('/export', requirePermission('audit', 'export'), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    const db = getDb();
    const { whereClause, params, startDate, endDate, operation, moduleName } = buildAuditFilterSql(
      req.user!.companyCode,
      req.query as Record<string, unknown>
    );

    const rowsRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM audit_logs a ${whereClause} ORDER BY a.created_at DESC LIMIT 2000`,
      params
    );

    const rows = rowsRes.rows.map((r) => ({
      created_at: formatDateTimeBR(r.created_at as string),
      user_name: String(r.user_name),
      operation: String(r.operation),
      module: String(r.module),
      record_id: String(r.record_id || '-'),
      description: String(r.description),
    }));

    const filters: string[] = [];
    if (operation) filters.push(`Operação: ${operation}`);
    if (moduleName) filters.push(`Aba: ${moduleName}`);

    const payload: ReportExportPayload = {
      officeName: req.user!.companyName,
      theme: req.user!.companyTheme,
      title: `Relatório de Auditoria – ${req.user!.companyName}`,
      periodLabel:
        startDate || endDate
          ? `${startDate ? formatDateBR(startDate) : 'Início'} a ${endDate ? formatDateBR(endDate) : 'Atual'}`
          : 'Histórico completo',
      generatedBy: req.user!.name,
      filtersSummary: filters.join(' | ') || 'Todas as operações',
      landscape: true,
      columns: [
        { key: 'created_at', header: 'Data/Hora', width: 15, type: 'text' },
        { key: 'user_name', header: 'Usuário', width: 14, type: 'text' },
        { key: 'operation', header: 'Operação', width: 13, type: 'text' },
        { key: 'module', header: 'Aba / Módulo', width: 14, type: 'text' },
        { key: 'record_id', header: 'ID Registro', width: 12, type: 'text' },
        { key: 'description', header: 'Descrição da Alteração', width: 32, type: 'text' },
      ],
      rows,
      summaryItems: [{ label: 'Total de Eventos Auditados', value: rows.length }],
    };

    if (format === 'xlsx') {
      const buf = await generateExcelBuffer(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financer-auditoria.xlsx"');
      res.send(buf);
      return;
    }

    const buf = await generatePdfBuffer(payload);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financer-auditoria.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});
