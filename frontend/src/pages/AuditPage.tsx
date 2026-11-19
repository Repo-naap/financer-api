import { useCallback, useEffect, useState } from 'react';
import { Eraser, Eye, Search, ShieldCheck } from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatDateTimeBR } from '../lib/format';
import { AuditLogRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ExportMenu } from '../components/ExportMenu';

const OPERATIONS = [
  'INCLUSAO',
  'EDICAO',
  'EXCLUSAO',
  'CANCELAMENTO',
  'REABERTURA',
  'ALTERACAO_PERMISSOES',
  'ALTERACAO_USUARIOS',
  'FECHAMENTO_MENSAL',
  'BACKUP',
  'RESTAURACAO',
  'CONFIGURACAO',
];

export function AuditPage() {
  const { can, notify } = useAuth();
  const [items, setItems] = useState<AuditLogRecord[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; login: string }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    userId: 'ALL',
    operation: 'ALL',
    module: 'ALL',
    startDate: '',
    endDate: '',
    search: '',
  });
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [detail, setDetail] = useState<AuditLogRecord | null>(null);

  const filterQs = buildQueryString({
    userId: filters.userId === 'ALL' ? '' : filters.userId,
    operation: filters.operation === 'ALL' ? '' : filters.operation,
    module: filters.module === 'ALL' ? '' : filters.module,
    startDate: filters.startDate,
    endDate: filters.endDate,
    search: filters.search,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        userId: filters.userId === 'ALL' ? '' : filters.userId,
        operation: filters.operation === 'ALL' ? '' : filters.operation,
        module: filters.module === 'ALL' ? '' : filters.module,
        startDate: filters.startDate,
        endDate: filters.endDate,
        search: filters.search,
        page,
        pageSize,
      });
      const res = await apiRequest<{
        items: AuditLogRecord[];
        total: number;
        users: Array<{ id: string; name: string; login: string }>;
      }>(`/audit${qs}`);
      setItems(res.items);
      setTotal(res.total);
      setUsers(res.users);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar auditoria.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-financer-200 bg-financer-50 p-4 text-xs text-financer-950">
        <ShieldCheck className="h-5 w-5 shrink-0 text-financer-700" />
        <span>
          <strong>Histórico Protegido e Imutável:</strong> Todas as inclusões, edições, exclusões,
          fechamentos, reaberturas e alterações de usuários/permissões são registradas
          automaticamente e não podem ser apagadas ou editadas.
        </span>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Pesquisar usuário, descrição ou ID..."
              value={filters.search}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(1);
              }}
            />
          </div>
          {can('audit', 'export') && (
            <ExportMenu
              baseEndpoint="/audit/export"
              queryString={filterQs}
              formats={['pdf', 'xlsx']}
              filenamePrefix="financer-auditoria"
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select
            className="input-field"
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
          >
            <option value="ALL">Usuário: Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} (@{u.login})
              </option>
            ))}
          </select>

          <select
            className="input-field"
            value={filters.operation}
            onChange={(e) => setFilters({ ...filters, operation: e.target.value })}
          >
            <option value="ALL">Operação: Todas</option>
            {OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="input-field"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
          />
          <input
            type="date"
            className="input-field"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
          />

          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFilters({
                userId: 'ALL',
                operation: 'ALL',
                module: 'ALL',
                startDate: '',
                endDate: '',
                search: '',
              });
              setPage(1);
            }}
          >
            <Eraser className="h-4 w-4" />
            Limpar Filtros
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="px-4 py-3">Data / Hora</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Operação</th>
                <th className="px-4 py-3">Aba / Módulo</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Carregando auditoria...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                items.map((a) => (
                  <tr key={a.id} className="hover:bg-financer-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {formatDateTimeBR(a.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold">{a.user_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          a.operation === 'EXCLUSAO'
                            ? 'badge-red'
                            : a.operation === 'REABERTURA' || a.operation === 'FECHAMENTO_MENSAL'
                            ? 'badge-amber'
                            : 'badge-purple'
                        }
                      >
                        {a.operation}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.module}</td>
                    <td className="px-4 py-3 text-slate-700">{a.description}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDetail(a)}
                        className="rounded-lg p-1.5 text-financer-700 hover:bg-financer-100"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span>
            Exibindo {items.length} de {total} evento(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="Detalhamento do Registro de Auditoria"
        maxWidth="lg"
      >
        {detail && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-financer-50 p-3">
              <div>
                <strong>Usuário:</strong> {detail.user_name}
              </div>
              <div>
                <strong>Data/Hora:</strong> {formatDateTimeBR(detail.created_at)}
              </div>
              <div>
                <strong>Operação:</strong> {detail.operation}
              </div>
              <div>
                <strong>Aba:</strong> {detail.module}
              </div>
              <div>
                <strong>ID do Registro:</strong> {detail.record_id || '-'}
              </div>
              <div>
                <strong>IP:</strong> {detail.ip_address || '-'}
              </div>
            </div>
            <div>
              <strong>Descrição:</strong>
              <p className="mt-1 text-sm text-slate-800">{detail.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <h4 className="mb-1 font-bold uppercase text-rose-700">Valor Anterior</h4>
                <pre className="max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                  {detail.previous_value
                    ? JSON.stringify(detail.previous_value, null, 2)
                    : 'N/A (Inclusão)'}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 font-bold uppercase text-emerald-700">Valor Novo</h4>
                <pre className="max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                  {detail.new_value
                    ? JSON.stringify(detail.new_value, null, 2)
                    : 'N/A (Exclusão)'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
