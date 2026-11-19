import React, { useCallback, useEffect, useState } from 'react';
import {
  Edit2,
  Eraser,
  Eye,
  Filter,
  Plus,
  Search,
  Trash2,
  ArrowUpDown,
} from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, getTodayIso } from '../lib/format';
import { ExpenseRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';

const CATEGORIES = ['Alimentação', 'Farmácia', 'Gerais', 'Combustíveis', 'Outros'] as const;

interface ExpenseSummary {
  count: number;
  grossTotal: number;
  totalDiscount: number;
  totalInterest: number;
  netTotal: number;
  byCategory: Array<{ category: string; count: number; netTotal: number }>;
  byType: Array<{ type: string; count: number; netTotal: number }>;
}

const emptyForm = () => ({
  day: getTodayIso(),
  category: 'Alimentação' as ExpenseRecord['category'],
  custom_description: '',
  invoice_number: '',
  original_amount: '',
  discount: '0',
  interest: '0',
  expense_type: 'Empresa' as 'Empresa' | 'Pessoal',
  notes: '',
});

export function ExpensesPage() {
  const { can, notify } = useAuth();
  const [items, setItems] = useState<ExpenseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    category: 'ALL',
    expenseType: 'ALL',
    invoiceNumber: '',
  });
  const [sortBy, setSortBy] = useState('day');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [detailItem, setDetailItem] = useState<ExpenseRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRecord | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  const filterQs = buildQueryString({
    startDate: filters.startDate,
    endDate: filters.endDate,
    category: filters.category === 'ALL' ? '' : filters.category,
    expenseType: filters.expenseType === 'ALL' ? '' : filters.expenseType,
    invoiceNumber: filters.invoiceNumber,
    search,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        startDate: filters.startDate,
        endDate: filters.endDate,
        category: filters.category === 'ALL' ? '' : filters.category,
        expenseType: filters.expenseType === 'ALL' ? '' : filters.expenseType,
        invoiceNumber: filters.invoiceNumber,
        search,
        sortBy,
        sortDir,
        page,
        pageSize,
      });
      const res = await apiRequest<{
        items: ExpenseRecord[];
        total: number;
        summary: ExpenseSummary;
      }>(`/expenses${qs}`);
      setItems(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar despesas.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, search, sortBy, sortDir, page, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const computedFinal =
    (Number(form.original_amount) || 0) -
    (Number(form.discount) || 0) +
    (Number(form.interest) || 0);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (item: ExpenseRecord) => {
    setEditing(item);
    setForm({
      day: item.day,
      category: item.category,
      custom_description: item.custom_description || '',
      invoice_number: item.invoice_number || '',
      original_amount: String(item.original_amount),
      discount: String(item.discount),
      interest: String(item.interest),
      expense_type: item.expense_type,
      notes: item.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        original_amount: Number(form.original_amount),
        discount: Number(form.discount) || 0,
        interest: Number(form.interest) || 0,
        version: editing?.version,
      };
      if (editing) {
        await apiRequest(`/expenses/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Despesa atualizada com sucesso.', 'success');
      } else {
        await apiRequest('/expenses', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Despesa cadastrada com sucesso.', 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar despesa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/expenses/${deleteTarget.id}`, { method: 'DELETE' });
      notify('Despesa excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir despesa.', 'error');
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Totais Automáticos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Bruto</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">
            {formatBRL(summary?.grossTotal)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total de Descontos</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700">
            - {formatBRL(summary?.totalDiscount)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total de Juros</p>
          <p className="mt-1 text-2xl font-extrabold text-rose-700">
            + {formatBRL(summary?.totalInterest)}
          </p>
        </div>
        <div className="card border-financer-300 bg-financer-50/60 p-4">
          <p className="text-xs font-bold uppercase text-financer-800">Total Líquido Gasto</p>
          <p className="mt-1 text-2xl font-extrabold text-financer-950">
            {formatBRL(summary?.netTotal)}
          </p>
        </div>
      </div>

      {/* Barra de Ações e Pesquisa */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Pesquisar descrição, categoria, NF..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setReportModalOpen(true)}
          >
            <Filter className="h-4 w-4" />
            Filtros e Relatório
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFilters({
                startDate: '',
                endDate: '',
                category: 'ALL',
                expenseType: 'ALL',
                invoiceNumber: '',
              });
              setSearch('');
              setPage(1);
            }}
          >
            <Eraser className="h-4 w-4" />
            Limpar
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('expenses', 'create') && (
            <button type="button" className="btn-primary" onClick={openNew}>
              <Plus className="h-4 w-4" />
              Novo Lançamento
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="cursor-pointer px-4 py-3" onClick={() => toggleSort('day')}>
                  <span className="inline-flex items-center gap-1">
                    Dia <ArrowUpDown className="h-3 w-3" />
                  </span>
                </th>
                <th className="cursor-pointer px-4 py-3" onClick={() => toggleSort('category')}>
                  Despesa
                </th>
                <th className="px-4 py-3">Nota Fiscal</th>
                <th className="px-4 py-3 text-right">Valor Original</th>
                <th className="px-4 py-3 text-right">Desconto</th>
                <th className="px-4 py-3 text-right">Juros</th>
                <th
                  className="cursor-pointer px-4 py-3 text-right"
                  onClick={() => toggleSort('final_amount')}
                >
                  Valor Final
                </th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Carregando despesas...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma despesa encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-financer-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {formatDateBR(item.day)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-900">{item.category}</span>
                      {item.custom_description && (
                        <p className="text-xs text-slate-500">{item.custom_description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.invoice_number || '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatBRL(item.original_amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-emerald-700">
                      {formatBRL(item.discount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-rose-700">
                      {formatBRL(item.interest)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-financer-900">
                      {formatBRL(item.final_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          item.expense_type === 'Empresa' ? 'badge-purple' : 'badge-slate'
                        }
                      >
                        {item.expense_type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailItem(item)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                          title="Visualizar detalhes"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {can('expenses', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openEdit(item)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('expenses', 'delete') && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(item)}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
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

        {/* Paginação */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span>
            Exibindo {items.length} de {total} registro(s)
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

      {/* Modal de Cadastro / Edição */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Despesa Mensal' : 'Nova Despesa Mensal'}
        subtitle="Valor final = Valor original - Desconto + Juros"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Dia *</label>
              <input
                type="date"
                className="input-field"
                required
                value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Despesa (Categoria) *</label>
              <select
                className="input-field"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as ExpenseRecord['category'] })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {form.category === 'Outros' && (
              <div className="sm:col-span-2">
                <label className="label-field">Descrição da Despesa (Outros) *</label>
                <input
                  className="input-field"
                  required
                  placeholder="Informe a descrição detalhada da despesa"
                  value={form.custom_description}
                  onChange={(e) => setForm({ ...form, custom_description: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="label-field">Nota Fiscal (Somente Números)</label>
              <input
                className="input-field"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ex.: 001245"
                value={form.invoice_number}
                onChange={(e) =>
                  setForm({ ...form, invoice_number: e.target.value.replace(/\D/g, '') })
                }
              />
            </div>

            <div>
              <label className="label-field">Tipo *</label>
              <select
                className="input-field"
                value={form.expense_type}
                onChange={(e) =>
                  setForm({ ...form, expense_type: e.target.value as 'Empresa' | 'Pessoal' })
                }
              >
                <option value="Empresa">Empresa</option>
                <option value="Pessoal">Pessoal</option>
              </select>
            </div>

            <div>
              <label className="label-field">Valor Original (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                value={form.original_amount}
                onChange={(e) => setForm({ ...form, original_amount: e.target.value })}
              />
            </div>

            <div>
              <label className="label-field">Desconto (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input-field"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
              />
            </div>

            <div>
              <label className="label-field">Juros (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input-field"
                value={form.interest}
                onChange={(e) => setForm({ ...form, interest: e.target.value })}
              />
            </div>

            <div className="flex flex-col justify-end">
              <div className="rounded-xl border border-financer-200 bg-financer-50 px-4 py-2.5">
                <span className="text-[11px] font-bold uppercase text-financer-700">
                  Valor Final Calculado
                </span>
                <p className="text-lg font-extrabold text-financer-950">
                  {formatBRL(computedFinal)}
                </p>
              </div>
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

          <div className="flex flex-wrap justify-between gap-2 pt-3">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setForm(emptyForm())}
            >
              <Eraser className="h-4 w-4" />
              Limpar Campos
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setFormOpen(false)}
              >
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Salvando...' : 'Salvar Lançamento'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Tela Específica de Filtros e Relatório (Seção 3.3) */}
      <Modal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title="Filtros e Relatório de Despesas Mensais"
        subtitle="Combine múltiplos filtros ou utilize um filtro individual antes de exportar"
        maxWidth="xl"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label-field">Data Inicial</label>
              <input
                type="date"
                className="input-field"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Data Final</label>
              <input
                type="date"
                className="input-field"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Categoria</label>
              <select
                className="input-field"
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              >
                <option value="ALL">Todas as categorias</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Tipo</label>
              <select
                className="input-field"
                value={filters.expenseType}
                onChange={(e) => setFilters({ ...filters, expenseType: e.target.value })}
              >
                <option value="ALL">Todos (Empresa e Pessoal)</option>
                <option value="Empresa">Empresa</option>
                <option value="Pessoal">Pessoal</option>
              </select>
            </div>
            <div>
              <label className="label-field">Número da Nota Fiscal</label>
              <input
                className="input-field"
                placeholder="Ex.: 102030"
                value={filters.invoiceNumber}
                onChange={(e) => setFilters({ ...filters, invoiceNumber: e.target.value })}
              />
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-financer-100 bg-financer-50/50 p-4">
                <h4 className="mb-2 text-xs font-bold uppercase text-financer-900">
                  Subtotais por Categoria
                </h4>
                <div className="space-y-1 text-xs">
                  {summary.byCategory.map((c) => (
                    <div key={c.category} className="flex justify-between">
                      <span>
                        {c.category} ({c.count})
                      </span>
                      <span className="font-bold">{formatBRL(c.netTotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-financer-100 bg-financer-50/50 p-4">
                <h4 className="mb-2 text-xs font-bold uppercase text-financer-900">
                  Subtotais por Tipo
                </h4>
                <div className="space-y-1 text-xs">
                  {summary.byType.map((t) => (
                    <div key={t.type} className="flex justify-between">
                      <span>
                        {t.type} ({t.count})
                      </span>
                      <span className="font-bold">{formatBRL(t.netTotal)}</span>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between border-t border-financer-200 pt-2 text-sm font-extrabold text-financer-950">
                    <span>Total Geral Líquido</span>
                    <span>{formatBRL(summary.netTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPage(1);
                loadData();
                setReportModalOpen(false);
              }}
            >
              Aplicar Filtros na Tabela
            </button>

            {can('expenses', 'export') && (
              <ExportMenu
                baseEndpoint="/expenses/export"
                queryString={filterQs}
                formats={['pdf', 'xlsx', 'docx']}
                filenamePrefix="financer-despesas"
              />
            )}
          </div>
        </div>
      </Modal>

      {/* Visualização Detalhada */}
      <Modal
        open={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title="Detalhes da Despesa"
        maxWidth="md"
      >
        {detailItem && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Data</dt>
              <dd className="font-semibold">{formatDateBR(detailItem.day)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Tipo</dt>
              <dd className="font-semibold">{detailItem.expense_type}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Categoria</dt>
              <dd className="font-semibold">{detailItem.category}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Nota Fiscal</dt>
              <dd className="font-semibold">{detailItem.invoice_number || '-'}</dd>
            </div>
            {detailItem.custom_description && (
              <div className="col-span-2">
                <dt className="text-xs font-bold uppercase text-slate-500">Descrição (Outros)</dt>
                <dd>{detailItem.custom_description}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Valor Original</dt>
              <dd>{formatBRL(detailItem.original_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Desconto / Juros</dt>
              <dd>
                -{formatBRL(detailItem.discount)} / +{formatBRL(detailItem.interest)}
              </dd>
            </div>
            <div className="col-span-2 rounded-xl bg-financer-50 p-3">
              <dt className="text-xs font-bold uppercase text-financer-800">Valor Final Líquido</dt>
              <dd className="text-xl font-extrabold text-financer-950">
                {formatBRL(detailItem.final_amount)}
              </dd>
            </div>
            {detailItem.notes && (
              <div className="col-span-2">
                <dt className="text-xs font-bold uppercase text-slate-500">Observações</dt>
                <dd>{detailItem.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir Despesa"
        message={`Confirma a exclusão da despesa "${deleteTarget?.category}" no valor de ${formatBRL(deleteTarget?.final_amount)}? Esta ação será registrada no histórico de auditoria.`}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
