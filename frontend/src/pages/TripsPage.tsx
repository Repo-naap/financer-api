import React, { useCallback, useEffect, useState } from 'react';
import { Edit2, Eraser, Eye, Filter, Plus, Search, Trash2 } from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, getTodayIso } from '../lib/format';
import { IbgeMunicipality, TripRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';
import { MunicipalitySelect } from '../components/MunicipalitySelect';

const GROUPS = ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'ALFA'] as const;
const PAYMENT_METHODS = ['Espécie', 'PIX', 'Cartão'] as const;

interface TripSummary {
  count: number;
  totalDisbursed: number;
  totalReturned: number;
  totalSpent: number;
  totalPeople: number;
  averagePerPerson: number;
}

const emptyTrip = () => ({
  trip_group: 'GP-A' as TripRecord['trip_group'],
  collaborator: '',
  municipality_ibge_code: '' as number | '',
  municipality_label: '',
  payment_method: 'PIX' as TripRecord['payment_method'],
  departure_date: getTodayIso(),
  departure_amount: '',
  return_date: '',
  return_amount: '0',
  times_count: '1',
  people_count: '1',
  notes: '',
});

export function TripsPage() {
  const { can, notify } = useAuth();
  const [items, setItems] = useState<TripRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [states, setStates] = useState<Array<{ uf: string; state_name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    municipality: '',
    uf: 'ALL',
    startDate: '',
    endDate: '',
    group: 'ALL',
    collaborator: '',
    paymentMethod: 'ALL',
  });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripRecord | null>(null);
  const [form, setForm] = useState(emptyTrip());
  const [saving, setSaving] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<TripRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TripRecord | null>(null);

  useEffect(() => {
    apiRequest<{ states: Array<{ uf: string; state_name: string }> }>('/trips/states')
      .then((res) => setStates(res.states))
      .catch(() => {});
  }, []);

  const filterQs = buildQueryString({
    municipality: filters.municipality,
    uf: filters.uf === 'ALL' ? '' : filters.uf,
    startDate: filters.startDate,
    endDate: filters.endDate,
    group: filters.group === 'ALL' ? '' : filters.group,
    collaborator: filters.collaborator,
    paymentMethod: filters.paymentMethod === 'ALL' ? '' : filters.paymentMethod,
    search,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        municipality: filters.municipality,
        uf: filters.uf === 'ALL' ? '' : filters.uf,
        startDate: filters.startDate,
        endDate: filters.endDate,
        group: filters.group === 'ALL' ? '' : filters.group,
        collaborator: filters.collaborator,
        paymentMethod: filters.paymentMethod === 'ALL' ? '' : filters.paymentMethod,
        search,
        page,
        pageSize,
      });
      const res = await apiRequest<{
        items: TripRecord[];
        total: number;
        summary: TripSummary;
      }>(`/trips${qs}`);
      setItems(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar viagens.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, search, page, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const spentCalc = (Number(form.departure_amount) || 0) - (Number(form.return_amount) || 0);
  const peopleNum = Number(form.people_count) || 0;
  const vppCalc = peopleNum > 0 ? spentCalc / peopleNum : 0;

  const openNew = () => {
    setEditing(null);
    setForm(emptyTrip());
    setFormOpen(true);
  };

  const openEdit = (t: TripRecord) => {
    setEditing(t);
    setForm({
      trip_group: t.trip_group,
      collaborator: t.collaborator,
      municipality_ibge_code: t.municipality_ibge_code,
      municipality_label: `${t.state_uf} – ${t.municipality_name}`,
      payment_method: t.payment_method,
      departure_date: t.departure_date,
      departure_amount: String(t.departure_amount),
      return_date: t.return_date || '',
      return_amount: String(t.return_amount),
      times_count: String(t.times_count),
      people_count: String(t.people_count),
      notes: t.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.municipality_ibge_code) {
      notify('Selecione um município brasileiro da base do IBGE.', 'error');
      return;
    }
    if (Number(form.people_count) <= 0) {
      notify('Quantidade de pessoas deve ser maior que zero.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        trip_group: form.trip_group,
        collaborator: form.collaborator,
        municipality_ibge_code: Number(form.municipality_ibge_code),
        payment_method: form.payment_method,
        departure_date: form.departure_date,
        departure_amount: Number(form.departure_amount),
        return_date: form.return_date || null,
        return_amount: Number(form.return_amount) || 0,
        times_count: Number(form.times_count) || 1,
        people_count: Number(form.people_count),
        notes: form.notes,
        version: editing?.version,
      };
      if (editing) {
        await apiRequest(`/trips/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        notify('Viagem atualizada com sucesso.', 'success');
      } else {
        await apiRequest('/trips', { method: 'POST', body: JSON.stringify(payload) });
        notify('Viagem cadastrada com sucesso.', 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar viagem.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/trips/${deleteTarget.id}`, { method: 'DELETE' });
      notify('Viagem excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir viagem.', 'error');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Totais Filtrados */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Disponibilizado</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">
            {formatBRL(summary?.totalDisbursed)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Devolvido</p>
          <p className="mt-1 text-xl font-extrabold text-emerald-700">
            {formatBRL(summary?.totalReturned)}
          </p>
        </div>
        <div className="card border-financer-300 bg-financer-50/60 p-4">
          <p className="text-xs font-bold uppercase text-financer-800">Total Efetivamente Gasto</p>
          <p className="mt-1 text-xl font-extrabold text-financer-950">
            {formatBRL(summary?.totalSpent)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total de Pessoas</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">{summary?.totalPeople ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Valor Médio / Pessoa</p>
          <p className="mt-1 text-xl font-extrabold text-financer-700">
            {formatBRL(summary?.averagePerPerson)}
          </p>
        </div>
      </div>

      {/* Ações e Pesquisa */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Pesquisar colaborador, município, grupo..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={() => setReportModalOpen(true)}>
            <Filter className="h-4 w-4" />
            Filtros e Relatório
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setFilters({
                municipality: '',
                uf: 'ALL',
                startDate: '',
                endDate: '',
                group: 'ALL',
                collaborator: '',
                paymentMethod: 'ALL',
              });
              setSearch('');
              setPage(1);
            }}
          >
            <Eraser className="h-4 w-4" />
            Limpar
          </button>
        </div>
        {can('trips', 'create') && (
          <button type="button" className="btn-primary" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nova Viagem
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                <th className="px-3 py-3">Grupo</th>
                <th className="px-3 py-3">Colaborador</th>
                <th className="px-3 py-3">Município/UF</th>
                <th className="px-3 py-3">Forma</th>
                <th className="px-3 py-3">Saída</th>
                <th className="px-3 py-3 text-right">Val. Saída</th>
                <th className="px-3 py-3 text-right">Devolução</th>
                <th className="px-3 py-3 text-center">Vezes / Pess.</th>
                <th className="px-3 py-3 text-right">Valor Gasto</th>
                <th className="px-3 py-3 text-right">VPP</th>
                <th className="px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    Carregando viagens...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma viagem encontrada.
                  </td>
                </tr>
              ) : (
                items.map((t) => (
                  <tr key={t.id} className="hover:bg-financer-50/40">
                    <td className="px-3 py-3">
                      <span className="badge-purple">{t.trip_group}</span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{t.collaborator}</td>
                    <td className="px-3 py-3">
                      {t.municipality_name}/{t.state_uf}
                    </td>
                    <td className="px-3 py-3">{t.payment_method}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatDateBR(t.departure_date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      {formatBRL(t.departure_amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-emerald-700">
                      {formatBRL(t.return_amount)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {t.times_count}x · {t.people_count}p
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-financer-900">
                      {formatBRL(t.spent_amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-financer-700">
                      {formatBRL(t.vpp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailItem(t)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {can('trips', 'edit') && (
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {can('trips', 'delete') && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(t)}
                            className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
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
            Exibindo {items.length} de {total} viagem(ns)
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

      {/* Modal Cadastro / Edição */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Viagem' : 'Nova Viagem'}
        subtitle="Valor gasto = Valor de saída - Valor de devolução | VPP = Valor gasto ÷ Pessoas"
        maxWidth="xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label-field">Grupo *</label>
              <select
                className="input-field"
                value={form.trip_group}
                onChange={(e) =>
                  setForm({ ...form, trip_group: e.target.value as TripRecord['trip_group'] })
                }
              >
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label-field">Colaborador *</label>
              <input
                className="input-field"
                required
                placeholder="Nome completo do colaborador"
                value={form.collaborator}
                onChange={(e) => setForm({ ...form, collaborator: e.target.value })}
              />
            </div>

            <div className="sm:col-span-3">
              <label className="label-field">Município de Destino (IBGE) *</label>
              <MunicipalitySelect
                value={form.municipality_ibge_code}
                selectedLabel={form.municipality_label}
                onChange={(mun: IbgeMunicipality | null) =>
                  setForm({
                    ...form,
                    municipality_ibge_code: mun ? mun.ibge_code : '',
                    municipality_label: mun ? `${mun.uf} – ${mun.name}` : '',
                  })
                }
              />
            </div>

            <div>
              <label className="label-field">Forma de Pagamento *</label>
              <select
                className="input-field"
                value={form.payment_method}
                onChange={(e) =>
                  setForm({
                    ...form,
                    payment_method: e.target.value as TripRecord['payment_method'],
                  })
                }
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Data de Saída *</label>
              <input
                type="date"
                className="input-field"
                required
                value={form.departure_date}
                onChange={(e) => setForm({ ...form, departure_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Valor de Saída (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                className="input-field"
                value={form.departure_amount}
                onChange={(e) => setForm({ ...form, departure_amount: e.target.value })}
              />
            </div>

            <div>
              <label className="label-field">Data de Devolução</label>
              <input
                type="date"
                className="input-field"
                value={form.return_date}
                onChange={(e) => setForm({ ...form, return_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Valor de Devolução (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input-field"
                value={form.return_amount}
                onChange={(e) => setForm({ ...form, return_amount: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-field">Vezes *</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="input-field"
                  value={form.times_count}
                  onChange={(e) => setForm({ ...form, times_count: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Pessoas *</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="input-field"
                  value={form.people_count}
                  onChange={(e) => setForm({ ...form, people_count: e.target.value })}
                />
              </div>
            </div>

            <div className="sm:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-financer-200 bg-financer-50 p-3">
                <span className="text-[11px] font-bold uppercase text-financer-700">
                  Valor Efetivamente Gasto
                </span>
                <p className="text-xl font-extrabold text-financer-950">{formatBRL(spentCalc)}</p>
              </div>
              <div className="rounded-xl border border-financer-200 bg-financer-50 p-3">
                <span className="text-[11px] font-bold uppercase text-financer-700">
                  VPP – Valor Proporcional por Pessoa
                </span>
                <p className="text-xl font-extrabold text-financer-800">{formatBRL(vppCalc)}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-2 pt-3">
            <button type="button" className="btn-ghost" onClick={() => setForm(emptyTrip())}>
              <Eraser className="h-4 w-4" />
              Limpar Campos
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Salvando...' : 'Salvar Viagem'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal de Filtros e Relatório de Viagens */}
      <Modal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title="Filtros e Relatório de Viagens"
        subtitle="Selecione múltiplos filtros simultaneamente; os totais refletirão exclusivamente o filtro"
        maxWidth="xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label-field">Estado (UF)</label>
              <select
                className="input-field"
                value={filters.uf}
                onChange={(e) => setFilters({ ...filters, uf: e.target.value })}
              >
                <option value="ALL">Todos os Estados</option>
                {states.map((s) => (
                  <option key={s.uf} value={s.uf}>
                    {s.uf} – {s.state_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Município</label>
              <input
                className="input-field"
                placeholder="Nome do município"
                value={filters.municipality}
                onChange={(e) => setFilters({ ...filters, municipality: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Grupo</label>
              <select
                className="input-field"
                value={filters.group}
                onChange={(e) => setFilters({ ...filters, group: e.target.value })}
              >
                <option value="ALL">Todos os Grupos</option>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Colaborador</label>
              <input
                className="input-field"
                placeholder="Nome do colaborador"
                value={filters.collaborator}
                onChange={(e) => setFilters({ ...filters, collaborator: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Forma de Pagamento</label>
              <select
                className="input-field"
                value={filters.paymentMethod}
                onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}
              >
                <option value="ALL">Todas</option>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-field">Saída Inicial</label>
                <input
                  type="date"
                  className="input-field"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Saída Final</label>
                <input
                  type="date"
                  className="input-field"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>

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
            {can('trips', 'export') && (
              <ExportMenu
                baseEndpoint="/trips/export"
                queryString={filterQs}
                formats={['pdf', 'xlsx']}
                filenamePrefix="financer-viagens"
              />
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title="Detalhes da Viagem"
        maxWidth="md"
      >
        {detailItem && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Grupo</dt>
              <dd className="font-bold">{detailItem.trip_group}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Colaborador</dt>
              <dd className="font-bold">{detailItem.collaborator}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Município/UF</dt>
              <dd>
                {detailItem.municipality_name}/{detailItem.state_uf}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Forma de Pagamento</dt>
              <dd>{detailItem.payment_method}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Saída</dt>
              <dd>
                {formatDateBR(detailItem.departure_date)} · {formatBRL(detailItem.departure_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Devolução</dt>
              <dd>
                {formatDateBR(detailItem.return_date)} · {formatBRL(detailItem.return_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">Valor Gasto</dt>
              <dd className="text-lg font-extrabold text-financer-950">
                {formatBRL(detailItem.spent_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-slate-500">VPP ({detailItem.people_count} pessoas)</dt>
              <dd className="text-lg font-extrabold text-financer-700">
                {formatBRL(detailItem.vpp)}
              </dd>
            </div>
          </dl>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir Viagem"
        message={`Confirma a exclusão da viagem de ${deleteTarget?.collaborator} para ${deleteTarget?.municipality_name}/${deleteTarget?.state_uf}?`}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
