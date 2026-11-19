import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Edit2,
  Eraser,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, getTodayIso } from '../lib/format';
import { ReminderRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';

interface ReminderSummary {
  count: number;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
  overdueCount: number;
  dueSoonCount: number;
  byDescription: Array<{
    description: string;
    account: string;
    digit: string;
    count: number;
    totalAmount: number;
  }>;
}

const emptyCreate = (companyAccount: ReminderRecord['account']) => ({
  start_date: getTodayIso(),
  end_date: `${new Date().getFullYear()}-12-15`,
  description: '',
  amount: '',
  account: companyAccount,
  digit: '09' as '09' | '10' | 'PF',
  notes: '',
});

export function RemindersPage() {
  const { can, notify, company } = useAuth();
  const companyAccount = (company?.name || 'NAAP') as ReminderRecord['account'];
  const [items, setItems] = useState<ReminderRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReminderSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    description: '',
    account: 'ALL',
    digit: 'ALL',
    status: 'ALL',
  });
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate(companyAccount));
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<ReminderRecord | null>(null);
  const [editForm, setEditForm] = useState({
    due_date: '',
    description: '',
    amount: '',
    account: companyAccount,
    digit: '09' as '09' | '10' | 'PF',
    notes: '',
    scope: 'SINGLE' as 'SINGLE' | 'FUTURE',
  });

  const [payTarget, setPayTarget] = useState<ReminderRecord | null>(null);
  const [payDate, setPayDate] = useState(getTodayIso());
  const [payNotes, setPayNotes] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ item: ReminderRecord; scope: 'SINGLE' | 'SERIES' } | null>(null);

  const filterQs = buildQueryString({
    startDate: filters.startDate,
    endDate: filters.endDate,
    description: filters.description,
    account: filters.account === 'ALL' ? '' : filters.account,
    digit: filters.digit === 'ALL' ? '' : filters.digit,
    status: filters.status === 'ALL' ? '' : filters.status,
    search,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        startDate: filters.startDate,
        endDate: filters.endDate,
        description: filters.description,
        account: filters.account === 'ALL' ? '' : filters.account,
        digit: filters.digit === 'ALL' ? '' : filters.digit,
        status: filters.status === 'ALL' ? '' : filters.status,
        search,
        page,
        pageSize,
      });
      const res = await apiRequest<{
        items: ReminderRecord[];
        total: number;
        summary: ReminderSummary;
      }>(`/reminders${qs}`);
      setItems(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar lembretes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, search, page, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ createdCount: number }>('/reminders', {
        method: 'POST',
        body: JSON.stringify({
          ...createForm,
          amount: Number(createForm.amount),
        }),
      });
      notify(
        `Obrigação recorrente criada com ${res.createdCount} compromisso(s) mensal(is) automático(s).`,
        'success'
      );
      setCreateOpen(false);
      setCreateForm(emptyCreate(companyAccount));
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao gerar lembretes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (item: ReminderRecord) => {
    setEditTarget(item);
    setEditForm({
      due_date: item.due_date,
      description: item.description,
      amount: String(item.amount),
      account: item.account,
      digit: item.digit,
      notes: item.notes || '',
      scope: 'SINGLE',
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/reminders/${editTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editForm,
          amount: Number(editForm.amount),
          version: editTarget.version,
        }),
      });
      notify('Obrigação atualizada com sucesso.', 'success');
      setEditTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar lembrete.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    try {
      await apiRequest(`/reminders/${payTarget.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ paid_date: payDate, notes: payNotes }),
      });
      notify('Conta marcada como PAGA com sucesso.', 'success');
      setPayTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar pagamento.', 'error');
    }
  };

  const handleUnpay = async (item: ReminderRecord) => {
    try {
      await apiRequest(`/reminders/${item.id}/unpay`, { method: 'POST' });
      notify('Conta estornada para PENDENTE.', 'info');
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao estornar pagamento.', 'error');
    }
  };

  const handleToggleSuspend = async (item: ReminderRecord) => {
    const reactivate = item.status === 'SUSPENSA';
    try {
      await apiRequest(`/reminders/${item.id}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ scope: 'FUTURE', reactivate }),
      });
      notify(
        reactivate ? 'Recorrência reativada com sucesso.' : 'Recorrência futura suspensa.',
        'success'
      );
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao alterar recorrência.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/reminders/${deleteTarget.item.id}?scope=${deleteTarget.scope}`, {
        method: 'DELETE',
      });
      notify('Obrigação excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir obrigação.', 'error');
    }
  };

  const alertBadge = (s: ReminderRecord['alert_status']) => {
    switch (s) {
      case 'PAGA':
        return <span className="badge-green">Paga</span>;
      case 'VENCIDA':
        return <span className="badge-red">Vencida</span>;
      case 'PROXIMO_VENCIMENTO':
        return <span className="badge-amber">Próx. Vencimento</span>;
      case 'SUSPENSA':
        return <span className="badge-slate">Suspensa</span>;
      default:
        return <span className="badge-purple">Pendente</span>;
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Resumo Colorido */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Obrigações</p>
          <p className="mt-1 text-xl font-extrabold text-financer-950">
            {formatBRL(summary?.totalAmount)}
          </p>
        </div>
        <div className="card border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-xs font-bold uppercase text-emerald-700">Contas Pagas</p>
          <p className="mt-1 text-xl font-extrabold text-emerald-900">
            {formatBRL(summary?.totalPaid)}
          </p>
        </div>
        <div className="card border-amber-200 bg-amber-50/50 p-4">
          <p className="text-xs font-bold uppercase text-amber-700">Contas Pendentes</p>
          <p className="mt-1 text-xl font-extrabold text-amber-900">
            {formatBRL(summary?.totalPending)}
          </p>
        </div>
        <div className="card border-rose-200 bg-rose-50/50 p-4">
          <p className="text-xs font-bold uppercase text-rose-700">Alertas (Vencidas / Próximas)</p>
          <p className="mt-1 text-xl font-extrabold text-rose-900">
            {summary?.overdueCount ?? 0} vencida(s) · {summary?.dueSoonCount ?? 0} próxima(s)
          </p>
        </div>
      </div>

      {/* Filtros + Ações */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Pesquisar descrição, conta ou dígito..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {can('reminders', 'export') && (
              <ExportMenu
                baseEndpoint="/reminders/export"
                queryString={filterQs}
                formats={['pdf', 'xlsx', 'docx']}
                filenamePrefix="financer-lembretes"
              />
            )}
            {can('reminders', 'create') && (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Nova Obrigação Recorrente
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
          <select
            className="input-field"
            value={filters.account}
            onChange={(e) => setFilters({ ...filters, account: e.target.value })}
          >
            <option value="ALL">Conta: Todas</option>
            <option value="PESSOAS">PESSOAS</option>
            <option value={companyAccount}>{companyAccount}</option>
          </select>
          <select
            className="input-field"
            value={filters.digit}
            onChange={(e) => setFilters({ ...filters, digit: e.target.value })}
          >
            <option value="ALL">Dígito: Todos</option>
            <option value="09">09</option>
            <option value="10">10</option>
            <option value="PF">PF</option>
          </select>
          <select
            className="input-field"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="ALL">Situação: Todas</option>
            <option value="PENDENTE">Pendente</option>
            <option value="PAGA">Paga</option>
            <option value="SUSPENSA">Suspensa</option>
          </select>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFilters({
                startDate: '',
                endDate: '',
                description: '',
                account: 'ALL',
                digit: 'ALL',
                status: 'ALL',
              });
              setSearch('');
            }}
          >
            <Eraser className="h-4 w-4" />
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Dígito</th>
                <th className="px-4 py-3">Competência</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Pagamento</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Carregando lembretes...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma obrigação cadastrada para os filtros informados.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr
                    key={r.id}
                    className={
                      r.alert_status === 'VENCIDA'
                        ? 'bg-rose-50/40 hover:bg-rose-50'
                        : r.alert_status === 'PROXIMO_VENCIMENTO'
                        ? 'bg-amber-50/40 hover:bg-amber-50'
                        : 'hover:bg-financer-50/40'
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{r.description}</p>
                      {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge-purple">{r.account}</span>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-700">{r.digit}</td>
                    <td className="px-4 py-3 font-medium">{r.competence}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateBR(r.due_date)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-financer-950">
                      {formatBRL(r.amount)}
                    </td>
                    <td className="px-4 py-3">{alertBadge(r.alert_status)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {r.paid_date ? formatDateBR(r.paid_date) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {can('reminders', 'edit') && r.status !== 'PAGA' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayTarget(r);
                              setPayDate(getTodayIso());
                              setPayNotes(r.notes || '');
                            }}
                            className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                            title="Marcar como paga"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('reminders', 'edit') && r.status === 'PAGA' && (
                          <button
                            type="button"
                            onClick={() => handleUnpay(r)}
                            className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                            title="Estornar pagamento"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        {can('reminders', 'edit') && r.status !== 'PAGA' && (
                          <button
                            type="button"
                            onClick={() => handleToggleSuspend(r)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                            title={
                              r.status === 'SUSPENSA'
                                ? 'Reativar recorrência'
                                : 'Suspender recorrência futura'
                            }
                          >
                            {r.status === 'SUSPENSA' ? (
                              <PlayCircle className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <PauseCircle className="h-4 w-4" />
                            )}
                          </button>
                        )}
                        {can('reminders', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                            title="Editar ocorrência / futuras"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('reminders', 'delete') && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ item: r, scope: 'SINGLE' })}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span>
            Exibindo {items.length} de {total} obrigação(ões)
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

      {/* Modal Criar Recorrência */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nova Obrigação / Lembrete Recorrente"
        subtitle="Gera automaticamente todos os compromissos mensais entre a data inicial e final, sem duplicidade"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Data Inicial *</label>
              <input
                type="date"
                className="input-field"
                required
                value={createForm.start_date}
                onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Data Final *</label>
              <input
                type="date"
                className="input-field"
                required
                value={createForm.end_date}
                onChange={(e) => setCreateForm({ ...createForm, end_date: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Descrição da Obrigação *</label>
              <input
                className="input-field"
                required
                placeholder="Ex.: Conta mensal de serviço / Aluguel / Honorário"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Valor Mensal (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                value={createForm.amount}
                onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-field">Conta *</label>
                <select
                  className="input-field"
                  value={createForm.account}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      account: e.target.value as ReminderRecord['account'],
                    })
                  }
                >
                  <option value="PESSOAS">PESSOAS</option>
                  <option value={companyAccount}>{companyAccount}</option>
                </select>
              </div>
              <div>
                <label className="label-field">Dígito *</label>
                <select
                  className="input-field"
                  value={createForm.digit}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      digit: e.target.value as '09' | '10' | 'PF',
                    })
                  }
                >
                  <option value="09">09</option>
                  <option value="10">10</option>
                  <option value="PF">PF</option>
                </select>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Observações</label>
              <textarea
                rows={2}
                className="input-field"
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Gerando...' : 'Gerar Lembretes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Editar Ocorrência Única ou Futuras */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="Editar Obrigação"
        subtitle="Escolha se deseja alterar apenas esta competência ou todas as ocorrências futuras"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="rounded-xl border border-financer-200 bg-financer-50 p-3">
            <label className="label-field">Escopo da Alteração</label>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={editForm.scope === 'SINGLE'}
                  onChange={() => setEditForm({ ...editForm, scope: 'SINGLE' })}
                />
                Apenas esta ocorrência ({editTarget?.competence})
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={editForm.scope === 'FUTURE'}
                  onChange={() => setEditForm({ ...editForm, scope: 'FUTURE' })}
                />
                Esta e todas as ocorrências futuras não pagas
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label-field">Descrição</label>
              <input
                className="input-field"
                required
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            {editForm.scope === 'SINGLE' && (
              <div>
                <label className="label-field">Vencimento</label>
                <input
                  type="date"
                  className="input-field"
                  required
                  value={editForm.due_date}
                  onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="label-field">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                value={editForm.amount}
                onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Conta</label>
              <select
                className="input-field"
                value={editForm.account}
                onChange={(e) =>
                  setEditForm({ ...editForm, account: e.target.value as ReminderRecord['account'] })
                }
              >
                <option value="PESSOAS">PESSOAS</option>
                <option value={companyAccount}>{companyAccount}</option>
              </select>
            </div>
            <div>
              <label className="label-field">Dígito</label>
              <select
                className="input-field"
                value={editForm.digit}
                onChange={(e) =>
                  setEditForm({ ...editForm, digit: e.target.value as '09' | '10' | 'PF' })
                }
              >
                <option value="09">09</option>
                <option value="10">10</option>
                <option value="PF">PF</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Observações</label>
              <textarea
                rows={2}
                className="input-field"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            {editTarget && can('reminders', 'delete') && (
              <button
                type="button"
                className="btn-danger text-xs"
                onClick={() => {
                  const target = editTarget;
                  setEditTarget(null);
                  setDeleteTarget({ item: target, scope: 'SERIES' });
                }}
              >
                Excluir Toda a Série
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal Pagamento */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title="Registrar Pagamento de Conta"
        maxWidth="sm"
      >
        <form onSubmit={handleMarkPaid} className="space-y-4">
          <p className="text-sm text-slate-700">
            Conta: <strong>{payTarget?.description}</strong> ({payTarget?.competence}) –{' '}
            <strong>{formatBRL(payTarget?.amount)}</strong>
          </p>
          <div>
            <label className="label-field">Data Efetiva do Pagamento *</label>
            <input
              type="date"
              className="input-field"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label-field">Observações do Pagamento</label>
            <textarea
              rows={2}
              className="input-field"
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary">
              Confirmar Pagamento
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.scope === 'SERIES' ? 'Excluir Toda a Série' : 'Excluir Ocorrência'}
        message={
          deleteTarget?.scope === 'SERIES'
            ? `Deseja excluir TODAS as ocorrências da obrigação "${deleteTarget.item.description}"?`
            : `Deseja excluir a ocorrência "${deleteTarget?.item.description}" (${deleteTarget?.item.competence})?`
        }
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
