import React, { useCallback, useEffect, useState } from 'react';
import {
  Building,
  CheckCircle2,
  Edit2,
  Eraser,
  Grid3X3,
  List,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, getTodayIso } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExportMenu } from '../components/ExportMenu';

interface InvoiceCity {
  id: string;
  name: string;
  invoice_group: string;
  agency?: string;
}

interface InvoiceFund {
  id: string;
  name: string;
  default_account?: string;
  display_order: number;
}

interface ServiceInvoice {
  id: string;
  invoice_number: string;
  amount: number;
  city_name: string;
  fund_name: string;
  agency?: string;
  bank_account?: string;
  competence_year: number;
  competence_month: number;
  competence: string;
  competence_slot: string;
  slot_label: string;
  invoice_group: string;
  status: 'PENDENTE' | 'EMITIDA' | 'PG' | 'CANCELADA';
  received_date?: string | null;
  notes?: string;
  version: number;
}

interface MatrixCell {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  received_date: string | null;
  display_bottom: string;
}

interface MatrixFundRow {
  fund_name: string;
  agency: string;
  bank_account: string;
  reference_amount: number;
  slots: Record<string, MatrixCell[]>;
  total_amount: number;
  total_paid: number;
}

interface MatrixCityBlock {
  city_name: string;
  agency: string;
  invoice_group: string;
  funds: MatrixFundRow[];
  city_reference_total: number;
  city_total_amount: number;
  city_total_paid: number;
}

interface MatrixGroupBlock {
  group_code: string;
  group_label: string;
  cities: MatrixCityBlock[];
  group_total_amount: number;
  group_total_paid: number;
}

interface MatrixResponse {
  year: number;
  usesGroups: boolean;
  slots: Array<{ key: string; label: string; month: number }>;
  groups: MatrixGroupBlock[];
  grandTotalAmount: number;
  grandTotalPaid: number;
}

const NAAP_GROUPS = ['GP-A', 'GP-B', 'GP-C', 'GP-D', 'RH-Folha'] as const;

export function InvoicesPage() {
  const { can, notify, company } = useAuth();
  const now = new Date();
  const usesGroups = company?.code === 'NAAP';

  const [view, setView] = useState<'matrix' | 'list' | 'catalogs'>('matrix');
  const [year, setYear] = useState<number>(now.getFullYear());
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [cityFilter, setCityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  const [cities, setCities] = useState<InvoiceCity[]>([]);
  const [funds, setFunds] = useState<InvoiceFund[]>([]);
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [listItems, setListItems] = useState<ServiceInvoice[]>([]);
  const [listTotal, setListTotal] = useState<number>(0);
  const [listSummary, setListSummary] = useState<{
    count: number;
    totalAmount: number;
    paidAmount: number;
    pendingAmount: number;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Form Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceInvoice | null>(null);
  const [form, setForm] = useState({
    invoice_number: '',
    amount: '',
    city_name: '',
    fund_name: '',
    agency: '',
    bank_account: '',
    month_year: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    competence_slot: 'MES',
    invoice_group: usesGroups ? 'GP-A' : 'SEM_GRUPO',
    status: 'EMITIDA' as ServiceInvoice['status'],
    received_date: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Pay modal & Delete confirm
  const [payTarget, setPayTarget] = useState<ServiceInvoice | null>(null);
  const [payDate, setPayDate] = useState(getTodayIso());
  const [deleteTarget, setDeleteTarget] = useState<ServiceInvoice | null>(null);

  // Catalog forms
  const [newCity, setNewCity] = useState({
    name: '',
    invoice_group: usesGroups ? 'GP-A' : 'SEM_GRUPO',
    agency: '',
  });
  const [newFund, setNewFund] = useState({
    name: '',
    default_account: '',
  });

  const exportQs = buildQueryString({
    year,
    group: groupFilter === 'ALL' ? '' : groupFilter,
    city: cityFilter,
    status: statusFilter === 'ALL' ? '' : statusFilter,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const matQs = buildQueryString({
        year,
        group: groupFilter === 'ALL' ? '' : groupFilter,
        city: cityFilter,
      });
      const listQs = buildQueryString({
        year,
        group: groupFilter === 'ALL' ? '' : groupFilter,
        city: cityFilter,
        status: statusFilter === 'ALL' ? '' : statusFilter,
        search,
        pageSize: 200,
      });

      const [catRes, matRes, listRes] = await Promise.all([
        apiRequest<{ cities: InvoiceCity[]; funds: InvoiceFund[] }>('/invoices/catalogs'),
        apiRequest<MatrixResponse>(`/invoices/matrix${matQs}`),
        apiRequest<{
          items: ServiceInvoice[];
          total: number;
          summary: { count: number; totalAmount: number; paidAmount: number; pendingAmount: number };
        }>(`/invoices${listQs}`),
      ]);

      setCities(catRes.cities);
      setFunds(catRes.funds);
      setMatrix(matRes);
      setListItems(listRes.items);
      setListTotal(listRes.total);
      setListSummary(listRes.summary);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar Conferência de Notas.', 'error');
    } finally {
      setLoading(false);
    }
  }, [year, groupFilter, cityFilter, statusFilter, search, notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openNewInvoice = (prefill?: {
    city_name?: string;
    fund_name?: string;
    invoice_group?: string;
    agency?: string;
    month?: number;
    slot?: string;
  }) => {
    setEditing(null);
    const m = prefill?.month || now.getMonth() + 1;
    setForm({
      invoice_number: '',
      amount: '',
      city_name: prefill?.city_name || '',
      fund_name: prefill?.fund_name || '',
      agency: prefill?.agency || '',
      bank_account: '',
      month_year: `${year}-${String(m).padStart(2, '0')}`,
      competence_slot: prefill?.slot === 'PC' || prefill?.slot === 'ORC' ? prefill.slot : 'MES',
      invoice_group: usesGroups
        ? prefill?.invoice_group || (groupFilter !== 'ALL' ? groupFilter : 'GP-A')
        : 'SEM_GRUPO',
      status: 'EMITIDA',
      received_date: '',
      notes: '',
    });
    setFormOpen(true);
  };

  const openEditInvoice = (inv: ServiceInvoice) => {
    setEditing(inv);
    setForm({
      invoice_number: inv.invoice_number,
      amount: String(inv.amount),
      city_name: inv.city_name,
      fund_name: inv.fund_name,
      agency: inv.agency || '',
      bank_account: inv.bank_account || '',
      month_year: `${inv.competence_year}-${String(inv.competence_month).padStart(2, '0')}`,
      competence_slot:
        inv.competence_slot === 'PC' || inv.competence_slot === 'ORC' ? inv.competence_slot : 'MES',
      invoice_group: usesGroups ? inv.invoice_group : 'SEM_GRUPO',
      status: inv.status,
      received_date: inv.received_date || '',
      notes: inv.notes || '',
    });
    setFormOpen(true);
  };

  const handleCityInputChange = (val: string) => {
    const matched = cities.find((c) => c.name.toLowerCase() === val.trim().toLowerCase());
    setForm((prev) => ({
      ...prev,
      city_name: val,
      invoice_group:
        usesGroups && matched && matched.invoice_group !== 'SEM_GRUPO'
          ? matched.invoice_group
          : prev.invoice_group,
      agency: matched?.agency ? matched.agency : prev.agency,
    }));
  };

  const handleSaveInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const [yStr, mStr] = form.month_year.split('-');
    const competence_year = Number(yStr);
    const competence_month = Number(mStr);

    if (!competence_year || !competence_month) {
      notify('Selecione o mês e o ano de competência.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        invoice_number: form.invoice_number.replace(/\D/g, ''),
        amount: Number(form.amount),
        city_name: form.city_name,
        fund_name: form.fund_name,
        agency: form.agency,
        bank_account: form.bank_account,
        competence_year,
        competence_month,
        competence_slot: form.competence_slot,
        invoice_group: usesGroups ? form.invoice_group : 'SEM_GRUPO',
        status: form.status,
        received_date: form.received_date || null,
        notes: form.notes,
        version: editing?.version,
      };
      if (editing) {
        await apiRequest(`/invoices/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Nota fiscal atualizada com sucesso.', 'success');
      } else {
        await apiRequest('/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Nota fiscal lançada com sucesso.', 'success');
      }
      setFormOpen(false);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar nota fiscal.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    try {
      await apiRequest(`/invoices/${payTarget.id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ received_date: payDate }),
      });
      notify(`Nota nº ${payTarget.invoice_number} marcada como PG.`, 'success');
      setPayTarget(null);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao confirmar recebimento.', 'error');
    }
  };

  const handleDeleteInvoice = async () => {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/invoices/${deleteTarget.id}`, { method: 'DELETE' });
      notify('Nota fiscal excluída com sucesso.', 'success');
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir nota.', 'error');
    }
  };

  const handleAddCity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/invoices/cities', {
        method: 'POST',
        body: JSON.stringify({
          name: newCity.name,
          invoice_group: usesGroups ? newCity.invoice_group : 'SEM_GRUPO',
          agency: newCity.agency,
        }),
      });
      notify(`Cidade "${newCity.name}" cadastrada com sucesso.`, 'success');
      setNewCity({ name: '', invoice_group: usesGroups ? 'GP-A' : 'SEM_GRUPO', agency: '' });
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao cadastrar cidade.', 'error');
    }
  };

  const handleDeleteCity = async (id: string) => {
    try {
      await apiRequest(`/invoices/cities/${id}`, { method: 'DELETE' });
      notify('Cidade removida do catálogo.', 'info');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao remover cidade.', 'error');
    }
  };

  const handleAddFund = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/invoices/funds', {
        method: 'POST',
        body: JSON.stringify({
          name: newFund.name,
          default_account: newFund.default_account,
        }),
      });
      notify(`Fundo/Órgão "${newFund.name.toUpperCase()}" cadastrado com sucesso.`, 'success');
      setNewFund({ name: '', default_account: '' });
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao cadastrar fundo/órgão.', 'error');
    }
  };

  const handleDeleteFund = async (id: string) => {
    try {
      await apiRequest(`/invoices/funds/${id}`, { method: 'DELETE' });
      notify('Fundo/Órgão removido do catálogo.', 'info');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao remover fundo/órgão.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Indicadores de Resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Notas Conferidas ({year})</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{listSummary?.count ?? 0}</p>
        </div>
        <div className="card border-finacer-300 border-financer-300 bg-financer-50/60 p-4">
          <p className="text-xs font-bold uppercase text-financer-800">Total Emitido ({year})</p>
          <p className="mt-1 text-2xl font-extrabold text-financer-950">
            {formatBRL(listSummary?.totalAmount)}
          </p>
        </div>
        <div className="card border-sky-200 bg-sky-50/60 p-4">
          <p className="text-xs font-bold uppercase text-sky-800">Total Recebido (PG)</p>
          <p className="mt-1 text-2xl font-extrabold text-sky-950">
            {formatBRL(listSummary?.paidAmount)}
          </p>
        </div>
        <div className="card border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs font-bold uppercase text-amber-800">Pendente / A Receber</p>
          <p className="mt-1 text-2xl font-extrabold text-amber-950">
            {formatBRL(listSummary?.pendingAmount)}
          </p>
        </div>
      </div>

      {/* Barra Principal de Sub-abas, Filtros e Ações */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setView('matrix')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                view === 'matrix'
                  ? 'bg-financer-700 text-white shadow-sm'
                  : 'bg-financer-50 text-financer-800 hover:bg-financer-100'
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
              Planilha de Conferência ({year})
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                view === 'list'
                  ? 'bg-financer-700 text-white shadow-sm'
                  : 'bg-financer-50 text-financer-800 hover:bg-financer-100'
              }`}
            >
              <List className="h-4 w-4" />
              Lançamentos ({listTotal})
            </button>
            <button
              type="button"
              onClick={() => setView('catalogs')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                view === 'catalogs'
                  ? 'bg-financer-700 text-white shadow-sm'
                  : 'bg-financer-50 text-financer-800 hover:bg-financer-100'
              }`}
            >
              <Building className="h-4 w-4" />
              Cadastrar Cidades e Órgãos ({cities.length} / {funds.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {can('invoices', 'export') && (
              <ExportMenu
                baseEndpoint="/invoices/export"
                queryString={exportQs}
                formats={['xlsx', 'pdf', 'docx']}
                filenamePrefix={`financer-conferencia-notas-${year}`}
              />
            )}
            {can('invoices', 'create') && (
              <button type="button" className="btn-primary" onClick={() => openNewInvoice()}>
                <Plus className="h-4 w-4" />
                Lançar Nota
              </button>
            )}
          </div>
        </div>

        {view !== 'catalogs' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select
              className="input-field"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(
                (y) => (
                  <option key={y} value={y}>
                    Ano: {y}
                  </option>
                )
              )}
            </select>

            {usesGroups && (
              <select
                className="input-field"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="ALL">Grupo: Todos (GP-A a RH-Folha)</option>
                {NAAP_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}

            <input
              className="input-field"
              placeholder="Filtrar por Cidade..."
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
            />

            {view === 'list' && (
              <>
                <select
                  className="input-field"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">Situação: Todas</option>
                  <option value="PG">PG (Recebida)</option>
                  <option value="EMITIDA">Emitida</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="input-field pl-9"
                    placeholder="Buscar nº nota, fundo..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </>
            )}

            {view === 'matrix' && (
              <button
                type="button"
                className="btn-ghost justify-start"
                onClick={() => {
                  setGroupFilter('ALL');
                  setCityFilter('');
                }}
              >
                <Eraser className="h-4 w-4" />
                Limpar Filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* ====================================================================
          VISÃO 1: PLANILHA DE CONFERÊNCIA ANUAL (ESTILO PLANILHA POR GRUPOS)
         ==================================================================== */}
      {view === 'matrix' && (
        <div className="space-y-6">
          {loading || !matrix ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              Carregando planilha de conferência...
            </div>
          ) : matrix.groups.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              Nenhuma cidade ou nota encontrada para os filtros selecionados.
            </div>
          ) : (
            matrix.groups.map((grp) => (
              <div key={grp.group_code} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-financer-900 to-financer-700 px-5 py-3 text-white shadow-sm">
                  <h3 className="text-sm font-extrabold tracking-wide">{grp.group_label}</h3>
                  <div className="flex items-center gap-4 text-xs">
                    <span>
                      Emitido: <strong>{formatBRL(grp.group_total_amount)}</strong>
                    </span>
                    <span>
                      Recebido (PG): <strong>{formatBRL(grp.group_total_paid)}</strong>
                    </span>
                  </div>
                </div>

                {grp.cities.map((city) => (
                  <div key={`${grp.group_code}-${city.city_name}`} className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-financer-700 text-white">
                            <th className="min-w-[140px] border border-financer-600 px-2.5 py-2 text-left text-xs font-extrabold">
                              <div className="flex items-center justify-between gap-1">
                                <span>{city.city_name}</span>
                                {can('invoices', 'create') && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openNewInvoice({
                                        city_name: city.city_name,
                                        invoice_group: city.invoice_group,
                                        agency: city.agency,
                                      })
                                    }
                                    className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] hover:bg-white/30"
                                    title={`Lançar nota para ${city.city_name}`}
                                  >
                                    + Nota
                                  </button>
                                )}
                              </div>
                            </th>
                            <th className="border border-financer-600 px-2 py-2 text-center font-bold">
                              AGÊNCIA
                            </th>
                            <th className="border border-financer-600 px-2 py-2 text-right font-bold">
                              R$
                            </th>
                            {matrix.slots.map((s) => (
                              <th
                                key={s.key}
                                className="min-w-[78px] border border-financer-600 px-1.5 py-2 text-center font-bold"
                              >
                                {s.label}
                              </th>
                            ))}
                            <th className="min-w-[95px] border border-financer-600 px-2 py-2 text-right font-bold">
                              TOTAL
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {city.funds.length === 0 ? (
                            <tr>
                              <td
                                colSpan={matrix.slots.length + 4}
                                className="px-4 py-4 text-center text-xs italic text-slate-400"
                              >
                                Nenhuma nota lançada para {city.city_name} em {year}. Clique em{' '}
                                <strong>+ Nota</strong> para iniciar a conferência.
                              </td>
                            </tr>
                          ) : (
                            city.funds.map((fund) => (
                              <React.Fragment key={fund.fund_name}>
                                {/* Linha 1: Nome do Fundo + Status PG */}
                                <tr className="border-t border-slate-200 bg-white">
                                  <td className="border border-slate-200 px-2.5 py-1.5 font-extrabold text-slate-900">
                                    {fund.fund_name}
                                  </td>
                                  <td className="border border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-700">
                                    {fund.agency || city.agency || '-'}
                                  </td>
                                  <td className="whitespace-nowrap border border-slate-200 px-2 py-1.5 text-right font-bold text-slate-900">
                                    {formatBRL(fund.reference_amount)}
                                  </td>
                                  {matrix.slots.map((s) => {
                                    const entries = fund.slots[s.key] || [];
                                    const hasEntries = entries.length > 0;
                                    const allPaid = hasEntries && entries.every((e) => e.status === 'PG');
                                    return (
                                      <td
                                        key={s.key}
                                        onClick={() => {
                                          if (hasEntries) {
                                            const full = listItems.find((i) => i.id === entries[0].id);
                                            if (full && can('invoices', 'edit')) openEditInvoice(full);
                                          } else if (can('invoices', 'create')) {
                                            openNewInvoice({
                                              city_name: city.city_name,
                                              fund_name: fund.fund_name,
                                              invoice_group: city.invoice_group,
                                              agency: fund.agency || city.agency,
                                              month: s.month,
                                              slot: s.key,
                                            });
                                          }
                                        }}
                                        className={`cursor-pointer border border-slate-200 px-1 py-1 text-center font-extrabold transition ${
                                          hasEntries
                                            ? allPaid
                                              ? 'bg-sky-200/80 text-sky-950 hover:bg-sky-300/80'
                                              : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                                            : 'bg-financer-50/40 text-slate-300 hover:bg-financer-100/60'
                                        }`}
                                        title={
                                          hasEntries
                                            ? 'Clique para editar esta nota'
                                            : `Clique para lançar nota em ${s.label}/${year}`
                                        }
                                      >
                                        {hasEntries
                                          ? allPaid
                                            ? 'PG'
                                            : entries.map((e) => e.status).join('/')
                                          : '—'}
                                      </td>
                                    );
                                  })}
                                  <td className="whitespace-nowrap border border-slate-200 bg-financer-50 px-2 py-1.5 text-right font-extrabold text-financer-950">
                                    {formatBRL(fund.total_amount)}
                                  </td>
                                </tr>

                                {/* Linha 2: DATA DE RECEB. + Conta + NF/DD.MM */}
                                <tr className="bg-slate-50/80">
                                  <td className="border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                                    DATA DE RECEB.
                                  </td>
                                  <td className="border border-slate-200 px-2 py-1 text-center font-mono text-[10px] text-slate-600">
                                    {fund.bank_account || ''}
                                  </td>
                                  <td className="border border-slate-200 px-2 py-1" />
                                  {matrix.slots.map((s) => {
                                    const entries = fund.slots[s.key] || [];
                                    return (
                                      <td
                                        key={s.key}
                                        className={`border border-slate-200 px-1 py-1 text-center font-mono text-[10px] ${
                                          entries.length > 0
                                            ? 'bg-white font-semibold text-slate-800'
                                            : 'bg-financer-100/30 text-slate-300'
                                        }`}
                                      >
                                        {entries.length > 0
                                          ? entries.map((e) => e.display_bottom).join(' | ')
                                          : ''}
                                      </td>
                                    );
                                  })}
                                  <td className="whitespace-nowrap border border-slate-200 px-2 py-1 text-right text-[10px] font-bold text-emerald-700">
                                    PG: {formatBRL(fund.total_paid)}
                                  </td>
                                </tr>
                              </React.Fragment>
                            ))
                          )}

                          {/* Rodapé de Subtotal da Cidade */}
                          {city.funds.length > 0 && (
                            <tr className="bg-financer-100/70 font-extrabold text-financer-950">
                              <td className="border border-financer-200 px-2.5 py-1.5" colSpan={2}>
                                TOTAL {city.city_name.toUpperCase()}
                              </td>
                              <td className="whitespace-nowrap border border-financer-200 px-2 py-1.5 text-right">
                                {formatBRL(city.city_reference_total)}
                              </td>
                              <td
                                colSpan={matrix.slots.length}
                                className="border border-financer-200 px-2 py-1.5 text-right text-[10px] text-financer-800"
                              >
                                Recebido (PG): {formatBRL(city.city_total_paid)}
                              </td>
                              <td className="whitespace-nowrap border border-financer-200 px-2 py-1.5 text-right">
                                {formatBRL(city.city_total_amount)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ====================================================================
          VISÃO 2: TABELA DE LANÇAMENTOS
         ==================================================================== */}
      {view === 'list' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                  <th className="px-4 py-3">Nº Nota</th>
                  {usesGroups && <th className="px-4 py-3">Grupo</th>}
                  <th className="px-4 py-3">Cidade</th>
                  <th className="px-4 py-3">Fundo / Órgão</th>
                  <th className="px-4 py-3">Mês/Ano</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3">Recebimento</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={usesGroups ? 9 : 8} className="px-4 py-8 text-center text-slate-500">
                      Carregando notas...
                    </td>
                  </tr>
                ) : listItems.length === 0 ? (
                  <tr>
                    <td colSpan={usesGroups ? 9 : 8} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma nota fiscal lançada para os filtros informados.
                    </td>
                  </tr>
                ) : (
                  listItems.map((inv) => (
                    <tr key={inv.id} className="hover:bg-finacer-50/40 hover:bg-financer-50/40">
                      <td className="px-4 py-3 font-mono font-bold text-financer-900">
                        {inv.invoice_number}
                      </td>
                      {usesGroups && (
                        <td className="px-4 py-3">
                          <span className="badge-purple">{inv.invoice_group}</span>
                        </td>
                      )}
                      <td className="px-4 py-3 font-semibold text-slate-900">{inv.city_name}</td>
                      <td className="px-4 py-3">{inv.fund_name}</td>
                      <td className="px-4 py-3 font-medium">
                        {inv.competence}{' '}
                        {(inv.competence_slot === 'PC' || inv.competence_slot === 'ORC') && (
                          <span className="ml-1 badge-slate">{inv.slot_label}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-900">
                        {formatBRL(inv.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            inv.status === 'PG'
                              ? 'badge-green'
                              : inv.status === 'CANCELADA'
                              ? 'badge-red'
                              : 'badge-amber'
                          }
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {inv.received_date ? formatDateBR(inv.received_date) : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {can('invoices', 'edit') && inv.status !== 'PG' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayTarget(inv);
                                setPayDate(getTodayIso());
                              }}
                              className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                              title="Marcar como PG (Recebida)"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          {can('invoices', 'edit') && (
                            <button
                              type="button"
                              onClick={() => openEditInvoice(inv)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-financer-100 hover:text-financer-800"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}
                          {can('invoices', 'delete') && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(inv)}
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
        </div>
      )}

      {/* ====================================================================
          VISÃO 3: CADASTRO DE NOVAS CIDADES E ÓRGÃOS / FUNDOS DAS ENTIDADES
         ==================================================================== */}
      {view === 'catalogs' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Cidades */}
          <div className="card space-y-4 p-5">
            <h3 className="text-base font-bold text-financer-950">
              Cidades Atendidas – {company?.name}
            </h3>
            {can('invoices', 'create') && (
              <form onSubmit={handleAddCity} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  className="input-field sm:col-span-2"
                  required
                  placeholder="Nome da nova cidade ou câmara..."
                  value={newCity.name}
                  onChange={(e) => setNewCity({ ...newCity, name: e.target.value })}
                />
                {usesGroups ? (
                  <select
                    className="input-field"
                    value={newCity.invoice_group}
                    onChange={(e) => setNewCity({ ...newCity, invoice_group: e.target.value })}
                  >
                    {NAAP_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input-field"
                    placeholder="Agência (opc.)"
                    value={newCity.agency}
                    onChange={(e) => setNewCity({ ...newCity, agency: e.target.value })}
                  />
                )}
                {usesGroups && (
                  <input
                    className="input-field sm:col-span-2"
                    placeholder="Agência padrão (opcional, ex.: 2702)"
                    value={newCity.agency}
                    onChange={(e) => setNewCity({ ...newCity, agency: e.target.value })}
                  />
                )}
                <button
                  type="submit"
                  className={`btn-primary ${usesGroups ? '' : 'sm:col-span-3'}`}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar Cidade
                </button>
              </form>
            )}

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
              {cities.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-financer-50/40"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    {usesGroups && <span className="ml-2 badge-purple">{c.invoice_group}</span>}
                    {c.agency && (
                      <span className="ml-2 text-xs text-slate-500">Ag. {c.agency}</span>
                    )}
                  </div>
                  {can('invoices', 'delete') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCity(c.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50"
                      title="Remover cidade"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Órgãos / Fundos */}
          <div className="card space-y-4 p-5">
            <h3 className="text-base font-bold text-financer-950">
              Órgãos / Fundos das Entidades – {company?.name}
            </h3>
            {can('invoices', 'create') && (
              <form onSubmit={handleAddFund} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  className="input-field sm:col-span-2"
                  required
                  placeholder="Ex.: PREFEITURA, SAÚDE, FMAS, FUNDEB, IPREV..."
                  value={newFund.name}
                  onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
                />
                <input
                  className="input-field"
                  placeholder="Conta (opc.)"
                  value={newFund.default_account}
                  onChange={(e) => setNewFund({ ...newFund, default_account: e.target.value })}
                />
                <button type="submit" className="btn-primary sm:col-span-3">
                  <Plus className="h-4 w-4" />
                  Adicionar Órgão / Fundo
                </button>
              </form>
            )}

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
              {funds.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-financer-50/40"
                >
                  <div>
                    <span className="font-bold text-slate-900">{f.name}</span>
                    {f.default_account && (
                      <span className="ml-2 font-mono text-xs text-slate-500">
                        Conta {f.default_account}
                      </span>
                    )}
                  </div>
                  {can('invoices', 'delete') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteFund(f.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50"
                      title="Remover órgão/fundo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo / Editar Lançamento de Nota */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Nota Fiscal' : 'Lançar Nota para Conferência'}
        subtitle={`Empresa ativa: ${company?.name} – Prestação de Serviço Contábil`}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveInvoice} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Número da Nota (Somente Números) *</label>
              <input
                className="input-field"
                required
                inputMode="numeric"
                pattern="[0-9]+"
                placeholder="Ex.: 3013"
                value={form.invoice_number}
                onChange={(e) =>
                  setForm({ ...form, invoice_number: e.target.value.replace(/\D/g, '') })
                }
              />
            </div>

            <div>
              <label className="label-field">Valor (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                placeholder="Ex.: 9968.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div>
              <label className="label-field">Cidade (Escrita ou Seleção) *</label>
              <input
                className="input-field"
                required
                list="financer-invoice-cities"
                placeholder="Digite ou selecione a cidade..."
                value={form.city_name}
                onChange={(e) => handleCityInputChange(e.target.value)}
              />
              <datalist id="financer-invoice-cities">
                {cities.map((c) => (
                  <option key={c.id} value={c.name}>
                    {usesGroups ? `${c.name} (${c.invoice_group})` : c.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <label className="label-field">Fundo / Órgão da Entidade *</label>
              <input
                className="input-field"
                required
                list="financer-invoice-funds"
                placeholder="Ex.: PREFEITURA, SAÚDE, FMAS, PM-FOLHA..."
                value={form.fund_name}
                onChange={(e) => setForm({ ...form, fund_name: e.target.value })}
              />
              <datalist id="financer-invoice-funds">
                {funds.map((f) => (
                  <option key={f.id} value={f.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="label-field">Mês e Ano de Competência *</label>
              <input
                type="month"
                required
                className="input-field"
                value={form.month_year}
                onChange={(e) => setForm({ ...form, month_year: e.target.value })}
              />
            </div>

            {usesGroups ? (
              <div>
                <label className="label-field">Grupo (NAAP) *</label>
                <select
                  className="input-field"
                  value={form.invoice_group}
                  onChange={(e) => setForm({ ...form, invoice_group: e.target.value })}
                >
                  {NAAP_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="label-field">Coluna Especial na Planilha</label>
                <select
                  className="input-field"
                  value={form.competence_slot}
                  onChange={(e) => setForm({ ...form, competence_slot: e.target.value })}
                >
                  <option value="MES">Mês Normal (JAN a DEZ)</option>
                  <option value="PC">PC (Prestação de Contas)</option>
                  <option value="ORC">ORÇ. (Orçamento)</option>
                </select>
              </div>
            )}

            {usesGroups && (
              <div>
                <label className="label-field">Coluna na Planilha</label>
                <select
                  className="input-field"
                  value={form.competence_slot}
                  onChange={(e) => setForm({ ...form, competence_slot: e.target.value })}
                >
                  <option value="MES">Mês Normal (JAN a DEZ)</option>
                  <option value="PC">PC (Prestação de Contas)</option>
                  <option value="ORC">ORÇ. (Orçamento)</option>
                </select>
              </div>
            )}

            <div>
              <label className="label-field">Situação</label>
              <select
                className="input-field"
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as ServiceInvoice['status'] })
                }
              >
                <option value="EMITIDA">Emitida (Aguardando Recebimento)</option>
                <option value="PG">PG (Paga / Recebida)</option>
                <option value="PENDENTE">Pendente</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>

            <div>
              <label className="label-field">Data de Recebimento (opcional)</label>
              <input
                type="date"
                className="input-field"
                value={form.received_date}
                onChange={(e) => setForm({ ...form, received_date: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-field">Agência (opc.)</label>
                <input
                  className="input-field"
                  placeholder="Ex.: 2702"
                  value={form.agency}
                  onChange={(e) => setForm({ ...form, agency: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Conta (opc.)</label>
                <input
                  className="input-field"
                  placeholder="Ex.: 6954-x"
                  value={form.bank_account}
                  onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                />
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

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Salvando...' : 'Salvar Nota'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Marcar como PG */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title="Confirmar Recebimento (PG)"
        maxWidth="sm"
      >
        <form onSubmit={handleMarkPaid} className="space-y-4">
          <p className="text-sm text-slate-700">
            Nota nº <strong>{payTarget?.invoice_number}</strong> –{' '}
            <strong>
              {payTarget?.city_name} / {payTarget?.fund_name}
            </strong>{' '}
            ({formatBRL(payTarget?.amount)})
          </p>
          <div>
            <label className="label-field">Data de Recebimento *</label>
            <input
              type="date"
              required
              className="input-field"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary">
              Confirmar PG
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir Nota Fiscal"
        message={`Confirma a exclusão da nota nº ${deleteTarget?.invoice_number} (${deleteTarget?.city_name} – ${deleteTarget?.fund_name})?`}
        confirmLabel="Excluir"
        onConfirm={handleDeleteInvoice}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
