import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  BellRing,
  Building,
  CalendarClock,
  CheckCircle2,
  Clock,
  Plane,
  RefreshCw,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest, buildQueryString } from '../lib/api';
import { formatBRL, formatDateBR, MONTHS_PT } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';

interface DashboardResponse {
  range: { period: string; year: number; month: number; quarter: number; label: string };
  indicators: {
    totalPersonalExpenses: number;
    totalCompanyExpenses: number;
    totalTripsExpenses: number;
    totalCashInflows: number;
    totalCashOutflows: number;
    currentCashBalance: number;
    periodEndingCashBalance: number;
    totalPendingBills: number;
    pendingBillsCount: number;
    totalPaidBills: number;
    paidBillsCount: number;
    overdueBillsCount: number;
    overdueBillsAmount: number;
    upcomingDueCount: number;
    upcomingDueAmount: number;
    totalMonthExpenses: number;
    revenueVsExpense: {
      revenues: number;
      expenses: number;
      cashOutflows: number;
      netResult: number;
    };
  };
  upcomingDueBills: Array<{
    id: string;
    description: string;
    account: string;
    digit: string;
    due_date: string;
    competence: string;
    amount: number;
    alert_status: string;
  }>;
  charts: {
    expensesByCategory: Array<{ category: string; total: number }>;
    personalVsCompany: Array<{ name: string; value: number }>;
    monthlyExpenseEvolution: Array<{ label: string; pessoal: number; empresa: number; total: number }>;
    tripsByGroup: Array<{ group: string; total: number; count: number }>;
    cashFlowMovement: Array<{ label: string; entradas: number; saidas: number; saldo: number }>;
    billsPaidVsPending: Array<{ name: string; value: number; count: number }>;
  };
}

const THEME_CHARTS = {
  purple: {
    palette: ['#A82979', '#F5B800', '#C23B90', '#751853', '#D962AE', '#8F1F65'],
    primary: '#A82979',
    secondary: '#F5B800',
    dark: '#5C1241',
    grid: '#FAE3F2',
  },
  navy: {
    palette: ['#0074C4', '#00B4D8', '#008CE3', '#003566', '#2DAEF8', '#005DA6'],
    primary: '#0074C4',
    secondary: '#00B4D8',
    dark: '#003566',
    grid: '#D6EFFF',
  },
  burgundy: {
    palette: ['#7F1D3A', '#9F1239', '#BE264C', '#520E23', '#F4728C', '#881337'],
    primary: '#7F1D3A',
    secondary: '#F4728C',
    dark: '#520E23',
    grid: '#FFE4E6',
  },
};

export function DashboardPage() {
  const { notify, company } = useAuth();
  const chartColors = THEME_CHARTS[company?.theme || 'purple'];
  const now = new Date();
  const [period, setPeriod] = useState<'MENSAL' | 'TRIMESTRAL' | 'ANUAL'>('MENSAL');
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [quarter, setQuarter] = useState<number>(Math.ceil((now.getMonth() + 1) / 3));
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [drillModal, setDrillModal] = useState<{
    open: boolean;
    title: string;
    module: string;
    items: Array<Record<string, unknown>>;
  }>({ open: false, title: '', module: '', items: [] });

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({ period, year, month, quarter });
      const res = await apiRequest<DashboardResponse>(`/dashboard${qs}`);
      setData(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar painel.', 'error');
    } finally {
      setLoading(false);
    }
  }, [period, year, month, quarter, notify]);

  useEffect(() => {
    loadDashboard();
    // Atualização automática periódica para refletir lançamentos simultâneos de outros usuários
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const openDrilldown = async (metric: string, value?: string) => {
    try {
      const qs = buildQueryString({ metric, value, period, year, month, quarter });
      const res = await apiRequest<{
        module: string;
        title: string;
        items: Array<Record<string, unknown>>;
      }>(`/dashboard/drilldown${qs}`);
      setDrillModal({ open: true, title: res.title, module: res.module, items: res.items });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Sem permissão para detalhar este indicador.', 'error');
    }
  };

  const ind = data?.indicators;

  return (
    <div className="space-y-6">
      {/* Banner Institucional com Logo Oficial do FINANCER e da Empresa Ativa */}
      <div className="card flex flex-wrap items-center justify-between gap-4 border-financer-200 bg-gradient-to-r from-white via-white to-financer-50 px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <img
            src={
              company?.code === 'NAAP'
                ? '/naap-logo.png'
                : company?.code === 'INFOR_MANAGER'
                ? '/informanager-logo.png'
                : '/financer-logo.png'
            }
            alt={`Logo ${company?.name || 'FINANCER'}`}
            className="h-14 w-auto object-contain"
          />
          <div className="hidden border-l border-financer-200 pl-4 sm:block">
            <p className="text-xs font-extrabold uppercase tracking-wider text-financer-700">
              {company?.name || 'FINANCER'} · Gestão Financeira e Contábil
            </p>
            <p className="text-xs text-slate-500">
              Painel de Controle em tempo real · {data?.range.label || `${String(month).padStart(2, '0')}/${year}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(company?.code === 'NAAP' || company?.code === 'INFOR_MANAGER') && (
            <img
              src="/financer-logo.png"
              alt="FINANCER"
              className="hidden h-8 w-auto object-contain opacity-90 md:block"
            />
          )}
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-bold ${
              company?.code === 'NAAP'
                ? 'border-[#F5B800]/50 bg-[#FDF2F9] text-[#5C1241]'
                : company?.code === 'INFOR_MANAGER'
                ? 'border-[#00B4D8]/50 bg-[#EDF8FF] text-[#003566]'
                : 'border-financer-300 bg-financer-50 text-financer-900'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                company?.code === 'NAAP'
                  ? 'bg-[#F5B800]'
                  : company?.code === 'INFOR_MANAGER'
                  ? 'bg-[#00B4D8]'
                  : 'bg-financer-700'
              }`}
            />
            {company?.name || 'FINANCER'} Ativo
          </span>
        </div>
      </div>

      {/* Barra de Seleção de Período */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['MENSAL', 'TRIMESTRAL', 'ANUAL'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                period === p
                  ? 'bg-financer-700 text-white shadow-sm'
                  : 'bg-financer-50 text-financer-800 hover:bg-financer-100'
              }`}
            >
              {p === 'MENSAL' ? 'Mensal' : p === 'TRIMESTRAL' ? 'Trimestral' : 'Anual'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {period === 'MENSAL' && (
            <select
              className="input-field w-40"
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
          {period === 'TRIMESTRAL' && (
            <select
              className="input-field w-40"
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value))}
            >
              <option value={1}>1º Trimestre</option>
              <option value={2}>2º Trimestre</option>
              <option value={3}>3º Trimestre</option>
              <option value={4}>4º Trimestre</option>
            </select>
          )}
          <select
            className="input-field w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[year - 2, year - 1, year, year + 1, year + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadDashboard} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* 11 Indicadores Financeiros Clicáveis (Drill-down) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard
          title="Despesas Pessoais"
          value={formatBRL(ind?.totalPersonalExpenses)}
          icon={User}
          accent="purple"
          onClick={() => openDrilldown('personal_expenses')}
        />
        <KpiCard
          title="Despesas da Empresa"
          value={formatBRL(ind?.totalCompanyExpenses)}
          icon={Building}
          accent="violet"
          onClick={() => openDrilldown('company_expenses')}
        />
        <KpiCard
          title="Despesas com Viagens"
          value={formatBRL(ind?.totalTripsExpenses)}
          icon={Plane}
          accent="indigo"
          onClick={() => openDrilldown('trips')}
        />
        <KpiCard
          title="Total de Despesas do Mês"
          value={formatBRL(ind?.totalMonthExpenses)}
          subtitle={`Ref. ${String(month).padStart(2, '0')}/${year}`}
          icon={CalendarClock}
          accent="purple"
          onClick={() => openDrilldown('month_expenses')}
        />
        <KpiCard
          title="Entradas no Caixa"
          value={formatBRL(ind?.totalCashInflows)}
          icon={ArrowUpCircle}
          accent="emerald"
          onClick={() => openDrilldown('cash_inflows')}
        />
        <KpiCard
          title="Saídas no Caixa"
          value={formatBRL(ind?.totalCashOutflows)}
          icon={ArrowDownCircle}
          accent="rose"
          onClick={() => openDrilldown('cash_outflows')}
        />
        <KpiCard
          title="Saldo Atual do Caixa"
          value={formatBRL(ind?.currentCashBalance)}
          subtitle={`Saldo fim período: ${formatBRL(ind?.periodEndingCashBalance)}`}
          icon={Wallet}
          accent="violet"
          onClick={() => openDrilldown('cash_balance')}
        />
        <KpiCard
          title="Receitas x Despesas"
          value={formatBRL(ind?.revenueVsExpense.netResult)}
          subtitle={`Entradas ${formatBRL(ind?.revenueVsExpense.revenues)} | Desp+Viag ${formatBRL(ind?.revenueVsExpense.expenses)}`}
          icon={TrendingUp}
          accent={(ind?.revenueVsExpense.netResult ?? 0) >= 0 ? 'emerald' : 'rose'}
          onClick={() => openDrilldown('cash_inflows')}
        />
        <KpiCard
          title="Contas Pendentes"
          value={formatBRL(ind?.totalPendingBills)}
          subtitle={`${ind?.pendingBillsCount ?? 0} conta(s) pendente(s)`}
          icon={Clock}
          accent="amber"
          onClick={() => openDrilldown('pending_bills')}
        />
        <KpiCard
          title="Contas Pagas"
          value={formatBRL(ind?.totalPaidBills)}
          subtitle={`${ind?.paidBillsCount ?? 0} conta(s) paga(s)`}
          icon={CheckCircle2}
          accent="emerald"
          onClick={() => openDrilldown('paid_bills')}
        />
        <KpiCard
          title="Próximos Vencimentos / Vencidas"
          value={formatBRL(ind?.upcomingDueAmount)}
          subtitle={`${ind?.upcomingDueCount ?? 0} alerta(s) (${ind?.overdueBillsCount ?? 0} vencida(s))`}
          icon={AlertTriangle}
          accent={(ind?.overdueBillsCount ?? 0) > 0 ? 'rose' : 'amber'}
          onClick={() => openDrilldown('upcoming_bills')}
        />
      </div>

      {/* Alertas de Lembretes Próximos / Vencidos */}
      {data && data.upcomingDueBills.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-financer-950">
              <BellRing className="h-4 w-4 text-financer-700" />
              Alertas de Contas e Próximos Vencimentos
            </h3>
            <span className="text-xs text-slate-500">Clique nos indicadores para detalhar</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.upcomingDueBills.slice(0, 6).map((b) => (
              <div
                key={b.id}
                className={`flex items-center justify-between rounded-xl border p-3 text-xs ${
                  b.alert_status === 'VENCIDA'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : b.alert_status === 'PROXIMO_VENCIMENTO'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-financer-100 bg-financer-50/50 text-slate-800'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <p className="truncate font-bold">{b.description}</p>
                  <p className="opacity-80">
                    {b.account} · Díg. {b.digit} · Venc. {formatDateBR(b.due_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold">{formatBRL(b.amount)}</p>
                  <span className="text-[10px] font-bold uppercase">
                    {b.alert_status === 'VENCIDA'
                      ? 'Vencida'
                      : b.alert_status === 'PROXIMO_VENCIMENTO'
                      ? 'Vence em breve'
                      : 'Pendente'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6 Gráficos Interativos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gráfico 1: Despesas por Categoria */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">1. Despesas por Categoria</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.charts.expensesByCategory || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Bar
                  dataKey="total"
                  name="Total Líquido"
                  radius={[8, 8, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) =>
                    entry?.category && openDrilldown('expense_category', String(entry.category))
                  }
                >
                  {(data?.charts.expensesByCategory || []).map((_, idx) => (
                    <Cell key={idx} fill={chartColors.palette[idx % chartColors.palette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Comparativo Despesas Pessoais x Empresariais */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">
            2. Despesas Pessoais x Empresariais
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.charts.personalVsCompany || []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  label={({ name, value }) => `${name}: ${formatBRL(value)}`}
                  onClick={(entry) =>
                    openDrilldown(
                      entry?.name === 'Pessoal' ? 'personal_expenses' : 'company_expenses'
                    )
                  }
                >
                  <Cell fill={chartColors.primary} />
                  <Cell fill={chartColors.secondary} />
                </Pie>
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 3: Evolução das Despesas Mensais */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">
            3. Evolução das Despesas Mensais ({year})
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.charts.monthlyExpenseEvolution || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="empresa"
                  name="Empresa"
                  stroke={chartColors.primary}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="pessoal"
                  name="Pessoal"
                  stroke={chartColors.secondary}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke={chartColors.dark}
                  strokeWidth={3}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 4: Despesas com Viagens */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">
            4. Despesas com Viagens por Grupo
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.charts.tripsByGroup || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Bar
                  dataKey="total"
                  name="Valor Gasto"
                  fill={chartColors.primary}
                  radius={[8, 8, 0, 0]}
                  cursor="pointer"
                  onClick={(entry) =>
                    entry?.group && openDrilldown('trip_group', String(entry.group))
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 5: Movimentação do Caixa */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">
            5. Movimentação do Caixa ({year})
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.charts.cashFlowMovement || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Legend />
                <Bar dataKey="entradas" name="Entradas" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="saidas" name="Saídas" fill="#F43F5E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 6: Contas Pagas e Pendentes */}
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-bold text-financer-950">
            6. Contas Pagas e Pendentes
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.charts.billsPaidVsPending || []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  label={({ name, value }) => `${name}: ${formatBRL(value)}`}
                  onClick={(entry) =>
                    openDrilldown(entry?.name === 'Pagas' ? 'paid_bills' : 'pending_bills')
                  }
                >
                  <Cell fill="#10B981" />
                  <Cell fill="#F59E0B" />
                </Pie>
                <Tooltip formatter={(v: number) => formatBRL(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Modal de Drill-Down */}
      <Modal
        open={drillModal.open}
        onClose={() => setDrillModal({ ...drillModal, open: false })}
        title={drillModal.title}
        subtitle={`${drillModal.items.length} lançamento(s) compondo este indicador`}
        maxWidth="xl"
      >
        {drillModal.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum lançamento registrado neste indicador para o período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-financer-100 bg-financer-50 text-financer-900">
                  {drillModal.module === 'expenses' && (
                    <>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Categoria</th>
                      <th className="px-3 py-2">NF</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-right">Valor Final</th>
                    </>
                  )}
                  {drillModal.module === 'trips' && (
                    <>
                      <th className="px-3 py-2">Saída</th>
                      <th className="px-3 py-2">Grupo</th>
                      <th className="px-3 py-2">Colaborador</th>
                      <th className="px-3 py-2">Município</th>
                      <th className="px-3 py-2 text-right">Gasto</th>
                      <th className="px-3 py-2 text-right">VPP</th>
                    </>
                  )}
                  {drillModal.module === 'cash' && (
                    <>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Destino</th>
                      <th className="px-3 py-2">Finalidade</th>
                      <th className="px-3 py-2 text-right">Entrada</th>
                      <th className="px-3 py-2 text-right">Saída</th>
                    </>
                  )}
                  {drillModal.module === 'reminders' && (
                    <>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Conta/Díg.</th>
                      <th className="px-3 py-2">Situação</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drillModal.items.map((item, idx) => (
                  <tr key={String(item.id || idx)} className="hover:bg-financer-50/40">
                    {drillModal.module === 'expenses' && (
                      <>
                        <td className="px-3 py-2">{formatDateBR(String(item.day))}</td>
                        <td className="px-3 py-2">
                          {String(item.category)}
                          {item.custom_description ? ` - ${String(item.custom_description)}` : ''}
                        </td>
                        <td className="px-3 py-2">{String(item.invoice_number || '-')}</td>
                        <td className="px-3 py-2">{String(item.expense_type)}</td>
                        <td className="px-3 py-2 text-right font-bold">
                          {formatBRL(Number(item.final_amount))}
                        </td>
                      </>
                    )}
                    {drillModal.module === 'trips' && (
                      <>
                        <td className="px-3 py-2">{formatDateBR(String(item.departure_date))}</td>
                        <td className="px-3 py-2">{String(item.trip_group)}</td>
                        <td className="px-3 py-2">{String(item.collaborator)}</td>
                        <td className="px-3 py-2">
                          {String(item.municipality_name)}/{String(item.state_uf)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          {formatBRL(Number(item.spent_amount))}
                        </td>
                        <td className="px-3 py-2 text-right">{formatBRL(Number(item.vpp))}</td>
                      </>
                    )}
                    {drillModal.module === 'cash' && (
                      <>
                        <td className="px-3 py-2">{formatDateBR(String(item.entry_date))}</td>
                        <td className="px-3 py-2">{String(item.destination)}</td>
                        <td className="px-3 py-2">{String(item.purpose)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 font-semibold">
                          {Number(item.inflow) > 0 ? formatBRL(Number(item.inflow)) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-rose-700 font-semibold">
                          {Number(item.outflow) > 0 ? formatBRL(Number(item.outflow)) : '-'}
                        </td>
                      </>
                    )}
                    {drillModal.module === 'reminders' && (
                      <>
                        <td className="px-3 py-2">{formatDateBR(String(item.due_date))}</td>
                        <td className="px-3 py-2">{String(item.description)}</td>
                        <td className="px-3 py-2">
                          {String(item.account)} / {String(item.digit)}
                        </td>
                        <td className="px-3 py-2">{String(item.status)}</td>
                        <td className="px-3 py-2 text-right font-bold">
                          {formatBRL(Number(item.amount))}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent,
  onClick,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'purple' | 'violet' | 'indigo' | 'emerald' | 'rose' | 'amber';
  onClick: () => void;
}) {
  const accentMap = {
    purple: 'bg-financer-100 text-financer-700',
    violet: 'bg-violet-100 text-violet-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="card group flex flex-col justify-between p-4 text-left transition hover:-translate-y-0.5 hover:border-financer-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500 group-hover:text-financer-700">
          {title}
        </span>
        <div className={`rounded-xl p-2 ${accentMap[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-xl font-extrabold tracking-tight text-slate-900">{value}</p>
        {subtitle && <p className="mt-1 truncate text-[11px] text-slate-500">{subtitle}</p>}
      </div>
    </button>
  );
}
