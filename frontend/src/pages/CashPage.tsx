import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Edit2, Eraser, Plus, Search, Trash2 } from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, getTodayIso, MONTHS_PT } from '../lib/format';
import { CashEntryRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';

interface CashSummary {
  count: number;
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  closingBalance: number;
}

const emptyCashForm = () => ({
  entry_date: getTodayIso(),
  destination: '',
  purpose: '',
  movementKind: 'ENTRADA' as 'ENTRADA' | 'SAIDA',
  amount: '',
  notes: '',
});

export function CashPage() {
  const { can, notify } = useAuth();
  const now = new Date();

  const [reportMode, setReportMode] = useState<'MENSAL' | 'ANUAL' | 'PERSONALIZADO'>('MENSAL');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [entryType, setEntryType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const [items, setItems] = useState<CashEntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CashEntryRecord | null>(null);
  const [form, setForm] = useState(emptyCashForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CashEntryRecord | null>(null);

  const filterQs = buildQueryString({
    reportMode,
    year,
    month: reportMode === 'MENSAL' ? month : undefined,
    startDate: reportMode === 'PERSONALIZADO' ? startDate : undefined,
    endDate: reportMode === 'PERSONALIZADO' ? endDate : undefined,
    destination,
    purpose,
    entryType: entryType === 'ALL' ? '' : entryType,
    search,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        reportMode,
        year,
        month: reportMode === 'MENSAL' ? month : undefined,
        startDate: reportMode === 'PERSONALIZADO' ? startDate : undefined,
        endDate: reportMode === 'PERSONALIZADO' ? endDate : undefined,
        destination,
        purpose,
        entryType: entryType === 'ALL' ? '' : entryType,
        search,
        page,
        pageSize,
      });
      const res = await apiRequest<{
        items: CashEntryRecord[];
        total: number;
        summary: CashSummary;
      }>(`/cash${qs}`);
      setItems(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar caixa.', 'error');
    } finally {
      setLoading(false);
    }
  }, [reportMode, year, month, startDate, endDate, destination, purpose, entryType, search, page, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openNew = (kind: 'ENTRADA' | 'SAIDA' = 'ENTRADA') => {
    setEditing(null);
    setForm({ ...emptyCashForm(), movementKind: kind });
    setFormOpen(true);
  };

  const openEdit = (c: CashEntryRecord) => {
    setEditing(c);
    setForm({
      entry_date: c.entry_date,
      destination: c.destination,
      purpose: c.purpose,
      movementKind: c.entry_type,
      amount: String(c.entry_type === 'ENTRADA' ? c.inflow : c.outflow),
      notes: c.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      notify('Informe um valor maior que zero.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        entry_date: form.entry_date,
        destination: form.destination,
        purpose: form.purpose,
        inflow: form.movementKind === 'ENTRADA' ? amt : 0,
        outflow: form.movementKind === 'SAIDA' ? amt : 0,
        notes: form.notes,
        version: editing?.version,
      };
      if (editing) {
        await apiRequest(`/cash/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Movimentação atualizada com sucesso.', 'success');
      } else {
        await apiRequest('/cash', { method: 'POST', body: JSON.stringify(payload) });
        notify('Movimentação registrada no caixa com sucesso.', 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar movimentação.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/cash/${deleteTarget.id}`, { method: 'DELETE' });
      notify('Movimentação excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir movimentação.', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Indicadores do Caixa */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Saldo Inicial do Período</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">
            {formatBRL(summary?.openingBalance)}
          </p>
        </div>
        <div className="card border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-xs font-bold uppercase text-emerald-700">Total de Entradas (+)</p>
          <p className="mt-1 text-xl font-extrabold text-emerald-900">
            {formatBRL(summary?.totalInflows)}
          </p>
        </div>
        <div className="card border-rose-200 bg-rose-50/50 p-4">
          <p className="text-xs font-bold uppercase text-rose-700">Total de Saídas (-)</p>
          <p className="mt-1 text-xl font-extrabold text-rose-900">
            {formatBRL(summary?.totalOutflows)}
          </p>
        </div>
        <div className="card border-financer-300 bg-financer-50/70 p-4">
          <p className="text-xs font-bold uppercase text-financer-800">Saldo Final Acumulado</p>
          <p className="mt-1 text-xl font-extrabold text-financer-950">
            {formatBRL(summary?.closingBalance)}
          </p>
        </div>
      </div>

      {/* Filtros de Período e Ações */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['MENSAL', 'ANUAL', 'PERSONALIZADO'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setReportMode(m);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  reportMode === m
                    ? 'bg-financer-700 text-white'
                    : 'bg-financer-50 text-financer-800 hover:bg-financer-100'
                }`}
              >
                {m === 'MENSAL' ? 'Mensal' : m === 'ANUAL' ? 'Anual' : 'Período Livre'}
              </button>
            ))}

            {reportMode === 'MENSAL' && (
              <select
                className="input-field w-36"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTHS_PT.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}

            {(reportMode === 'MENSAL' || reportMode === 'ANUAL') && (
              <select
                className="input-field w-24"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {[year - 2, year - 1, year, year + 1, year + 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}

            {reportMode === 'PERSONALIZADO' && (
              <>
                <input
                  type="date"
                  className="input-field w-40"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <input
                  type="date"
                  className="input-field w-40"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {can('cash', 'export') && (
              <ExportMenu
                baseEndpoint="/cash/export"
                queryString={filterQs}
                formats={['pdf', 'xlsx', 'docx']}
                filenamePrefix="financer-caixa"
              />
            )}
            {can('cash', 'create') && (
              <button type="button" className="btn-primary" onClick={() => openNew('ENTRADA')}>
                <Plus className="h-4 w-4" />
                Nova Movimentação
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Pesquisar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <input
            className="input-field"
            placeholder="Filtrar por Destino"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="Filtrar por Finalidade"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="input-field"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
            >
              <option value="ALL">Tipo: Todos</option>
              <option value="ENTRADA">Somente Entradas</option>
              <option value="SAIDA">Somente Saídas</option>
            </select>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setDestination('');
                setPurpose('');
                setEntryType('ALL');
                setSearch('');
              }}
            >
              <Eraser className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabela de Movimentações */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Destino / Responsável</th>
                <th className="px-4 py-3">Finalidade</th>
                <th className="px-4 py-3 text-right">Entrada (+)</th>
                <th className="px-4 py-3 text-right">Saída (-)</th>
                <th className="px-4 py-3 text-right">Saldo Acumulado</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Carregando movimentações do caixa...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma movimentação registrada neste período.
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="hover:bg-financer-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {formatDateBR(c.entry_date)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{c.destination}</td>
                    <td className="px-4 py-3 text-slate-700">{c.purpose}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-emerald-700">
                      {c.inflow > 0 ? formatBRL(c.inflow) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-rose-700">
                      {c.outflow > 0 ? formatBRL(c.outflow) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-extrabold text-financer-950">
                      {formatBRL(c.running_balance)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {can('cash', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('cash', 'delete') && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
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

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span>
            Exibindo {items.length} de {total} movimentação(ões)
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

      {/* Modal Nova / Editar Movimentação */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Movimentação de Caixa' : 'Nova Movimentação de Caixa'}
        subtitle="Um lançamento deve ser exclusivamente de Entrada (+) ou de Saída (-)"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, movementKind: 'ENTRADA' })}
              className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-bold transition ${
                form.movementKind === 'ENTRADA'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ArrowUpCircle className="h-5 w-5" />
              Entrada (+)
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, movementKind: 'SAIDA' })}
              className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-bold transition ${
                form.movementKind === 'SAIDA'
                  ? 'border-rose-500 bg-rose-50 text-rose-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ArrowDownCircle className="h-5 w-5" />
              Saída (-)
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Data *</label>
              <input
                type="date"
                className="input-field"
                required
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">
                {form.movementKind === 'ENTRADA' ? 'Valor de Entrada (R$) *' : 'Valor de Saída (R$) *'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Destino / Responsável *</label>
              <input
                className="input-field"
                required
                placeholder="Nome do cliente, fornecedor ou responsável"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Finalidade *</label>
              <input
                className="input-field"
                required
                placeholder="Motivo da movimentação"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Observações</label>
              <textarea
                rows={2}
                className="input-field"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Salvando...' : 'Salvar Movimentação'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir Movimentação do Caixa"
        message={`Confirma a exclusão da movimentação "${deleteTarget?.destination} – ${deleteTarget?.purpose}"?`}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
