import React, { useCallback, useEffect, useState } from 'react';
import { Calculator, Edit2, Plus, Trash2 } from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, formatDateTimeBR, getTodayIso } from '../lib/format';
import { ReconciliationRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';

const firstOfMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

export function ReconciliationPage() {
  const { can, notify } = useAuth();
  const [items, setItems] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReconciliationRecord | null>(null);
  const [form, setForm] = useState({
    period_start: firstOfMonth(),
    period_end: getTodayIso(),
    checked_balance: '',
    concluded: false,
    justification: '',
    notes: '',
  });
  const [preview, setPreview] = useState<{
    openingBalance: number;
    totalInflows: number;
    totalOutflows: number;
    calculatedBalance: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReconciliationRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({ status: statusFilter === 'ALL' ? '' : statusFilter });
      const res = await apiRequest<{ items: ReconciliationRecord[] }>(`/reconciliation${qs}`);
      setItems(res.items);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar conciliações.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadPreview = useCallback(async (start: string, end: string) => {
    if (!start || !end || end < start) return;
    try {
      const res = await apiRequest<{
        openingBalance: number;
        totalInflows: number;
        totalOutflows: number;
        calculatedBalance: number;
      }>(`/reconciliation/preview?periodStart=${start}&periodEnd=${end}`);
      setPreview(res);
    } catch {
      setPreview(null);
    }
  }, []);

  useEffect(() => {
    if (formOpen) {
      loadPreview(form.period_start, form.period_end);
    }
  }, [formOpen, form.period_start, form.period_end, loadPreview]);

  const openNew = () => {
    setEditing(null);
    setForm({
      period_start: firstOfMonth(),
      period_end: getTodayIso(),
      checked_balance: '',
      concluded: false,
      justification: '',
      notes: '',
    });
    setFormOpen(true);
  };

  const openEdit = (r: ReconciliationRecord) => {
    setEditing(r);
    setForm({
      period_start: r.period_start,
      period_end: r.period_end,
      checked_balance: r.checked_balance !== null ? String(r.checked_balance) : '',
      concluded: r.concluded,
      justification: r.justification || '',
      notes: r.notes || '',
    });
    setFormOpen(true);
  };

  const checkedNum = form.checked_balance.trim() === '' ? null : Number(form.checked_balance);
  const diffCalc =
    preview && checkedNum !== null && Number.isFinite(checkedNum)
      ? Math.round((checkedNum - preview.calculatedBalance) * 100) / 100
      : null;
  const computedStatus =
    diffCalc === null ? 'PENDENTE' : diffCalc === 0 ? 'CONCILIADO' : 'DIVERGENTE';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        period_start: form.period_start,
        period_end: form.period_end,
        checked_balance: checkedNum,
        concluded: form.concluded,
        justification: form.justification,
        notes: form.notes,
        version: editing?.version,
      };
      if (editing) {
        await apiRequest(`/reconciliation/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Conciliação atualizada com sucesso.', 'success');
      } else {
        await apiRequest('/reconciliation', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Conciliação registrada com sucesso.', 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar conciliação.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/reconciliation/${deleteTarget.id}`, { method: 'DELETE' });
      notify('Conciliação excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir conciliação.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <select
            className="input-field w-48"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Situação: Todas</option>
            <option value="CONCILIADO">Conciliado</option>
            <option value="DIVERGENTE">Divergente</option>
            <option value="PENDENTE">Pendente</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('reconciliation', 'export') && (
            <ExportMenu
              baseEndpoint="/reconciliation/export"
              formats={['pdf', 'xlsx']}
              filenamePrefix="financer-conciliacao"
            />
          )}
          {can('reconciliation', 'create') && (
            <button type="button" className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" />
              Nova Conferência / Conciliação
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="px-4 py-3">Período</th>
                <th className="px-4 py-3 text-right">Saldo Inicial</th>
                <th className="px-4 py-3 text-right">Entradas</th>
                <th className="px-4 py-3 text-right">Saídas</th>
                <th className="px-4 py-3 text-right">Saldo Sistema</th>
                <th className="px-4 py-3 text-right">Saldo Conferido</th>
                <th className="px-4 py-3 text-right">Diferença</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Responsável / Data</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Carregando conciliações...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma conciliação registrada ainda.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-financer-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      {formatDateBR(r.period_start)} a {formatDateBR(r.period_end)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatBRL(r.opening_balance)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-emerald-700">
                      {formatBRL(r.total_inflows)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-rose-700">
                      {formatBRL(r.total_outflows)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold">
                      {formatBRL(r.calculated_balance)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-financer-900">
                      {r.checked_balance !== null ? formatBRL(r.checked_balance) : '-'}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-extrabold ${
                        r.difference === 0
                          ? 'text-emerald-700'
                          : r.difference !== null
                          ? 'text-rose-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {r.difference !== null ? formatBRL(r.difference) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          r.status === 'CONCILIADO'
                            ? 'badge-green'
                            : r.status === 'DIVERGENTE'
                            ? 'badge-red'
                            : 'badge-amber'
                        }
                      >
                        {r.status} {r.concluded ? '✓' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800">{r.responsible_name || '-'}</p>
                      <p>{r.checked_at ? formatDateTimeBR(r.checked_at) : '-'}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {can('reconciliation', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('reconciliation', 'delete') && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(r)}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
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
      </div>

      {/* Modal Conferência */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Conciliação Financeira' : 'Nova Conciliação Financeira'}
        subtitle="Diferença = Saldo conferido - Saldo calculado pelo sistema"
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Período Inicial *</label>
              <input
                type="date"
                className="input-field"
                required
                value={form.period_start}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Período Final *</label>
              <input
                type="date"
                className="input-field"
                required
                value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })}
              />
            </div>
          </div>

          {preview && (
            <div className="rounded-xl border border-financer-200 bg-financer-50/70 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase text-financer-900">
                <Calculator className="h-4 w-4" />
                Valores Registrados no FINANCER no Período
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <span className="text-xs text-slate-500">Saldo Inicial</span>
                  <p className="font-bold">{formatBRL(preview.openingBalance)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Entradas</span>
                  <p className="font-bold text-emerald-700">{formatBRL(preview.totalInflows)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Saídas</span>
                  <p className="font-bold text-rose-700">{formatBRL(preview.totalOutflows)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Saldo Calculado</span>
                  <p className="font-extrabold text-financer-950">
                    {formatBRL(preview.calculatedBalance)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Saldo Efetivamente Conferido (R$)</label>
              <input
                type="number"
                step="0.01"
                className="input-field"
                placeholder="Informe o saldo real conferido"
                value={form.checked_balance}
                onChange={(e) => setForm({ ...form, checked_balance: e.target.value })}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="text-[11px] font-bold uppercase text-slate-500">
                Diferença & Situação Automática
              </span>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-lg font-extrabold">
                  {diffCalc !== null ? formatBRL(diffCalc) : 'Pendente'}
                </span>
                <span
                  className={
                    computedStatus === 'CONCILIADO'
                      ? 'badge-green'
                      : computedStatus === 'DIVERGENTE'
                      ? 'badge-red'
                      : 'badge-amber'
                  }
                >
                  {computedStatus}
                </span>
              </div>
            </div>
          </div>

          {computedStatus === 'DIVERGENTE' && (
            <div>
              <label className="label-field text-rose-700">
                Justificativa da Divergência (Obrigatória para Concluir) *
              </label>
              <textarea
                rows={2}
                className="input-field border-rose-300"
                placeholder="Explique detalhadamente o motivo da diferença encontrada..."
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="label-field">Observações Gerais</label>
            <textarea
              rows={2}
              className="input-field"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-financer-200 bg-financer-50/50 p-3 text-sm font-semibold text-financer-950">
            <input
              type="checkbox"
              checked={form.concluded}
              onChange={(e) => setForm({ ...form, concluded: e.target.checked })}
            />
            Marcar conciliação como CONCLUÍDA
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Salvando...' : 'Salvar Conciliação'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir Conciliação"
        message="Confirma a exclusão deste registro de conciliação financeira?"
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
