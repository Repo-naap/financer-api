import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatBRL, formatDateTimeBR, MONTHS_PT } from '../lib/format';
import { MonthlyClosingSummary } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ExportMenu } from '../components/ExportMenu';

export function ClosingPage() {
  const { user, can, notify } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<MonthlyClosingSummary | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  const [closeNotes, setCloseNotes] = useState('');
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [reopenJustification, setReopenJustification] = useState('');
  const [busy, setBusy] = useState(false);

  const loadClosing = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        apiRequest<MonthlyClosingSummary>(`/closing/${year}/${month}`),
        apiRequest<{ items: Array<Record<string, unknown>> }>('/closing'),
      ]);
      setSummary(sum);
      setHistory(list.items);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar fechamento mensal.', 'error');
    } finally {
      setLoading(false);
    }
  }, [year, month, notify]);

  useEffect(() => {
    loadClosing();
  }, [loadClosing]);

  const handleConfirmClose = async () => {
    setBusy(true);
    try {
      await apiRequest(`/closing/${year}/${month}/close`, {
        method: 'POST',
        body: JSON.stringify({ notes: closeNotes }),
      });
      notify(
        `Período ${String(month).padStart(2, '0')}/${year} FECHADO com sucesso! Saldo transportado para o mês seguinte.`,
        'success'
      );
      setCloseModalOpen(false);
      setCloseNotes('');
      await loadClosing();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao fechar período.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (reopenJustification.trim().length < 5) {
      notify('Informe uma justificativa detalhada (mínimo 5 caracteres).', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/closing/${year}/${month}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ justification: reopenJustification }),
      });
      notify(
        `Período ${String(month).padStart(2, '0')}/${year} REABERTO e registrado na auditoria.`,
        'info'
      );
      setReopenModalOpen(false);
      setReopenJustification('');
      await loadClosing();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao reabrir período.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Seletor de Competência e Ações */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
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

          {summary && (
            <span
              className={
                summary.status === 'FECHADO'
                  ? 'badge-green px-3 py-1 text-xs'
                  : summary.status === 'REABERTO'
                  ? 'badge-amber px-3 py-1 text-xs'
                  : 'badge-purple px-3 py-1 text-xs'
              }
            >
              Status: {summary.status}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('closing', 'export') && (
            <ExportMenu
              baseEndpoint={`/closing/${year}/${month}/export`}
              formats={['pdf', 'xlsx', 'docx']}
              filenamePrefix={`financer-fechamento-${year}-${String(month).padStart(2, '0')}`}
            />
          )}
          {summary && summary.status !== 'FECHADO' && can('closing', 'close_period') && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setCloseModalOpen(true)}
            >
              <Lock className="h-4 w-4" />
              Confirmar Fechamento Mensal
            </button>
          )}
          {summary && summary.status === 'FECHADO' && user?.role === 'ADMINISTRADOR' && (
            <button
              type="button"
              className="btn-danger"
              onClick={() => setReopenModalOpen(true)}
            >
              <Unlock className="h-4 w-4" />
              Reabrir Período (Admin)
            </button>
          )}
        </div>
      </div>

      {/* Conferências e Inconsistências */}
      {loading || !summary ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Carregando conferências do mês...
        </div>
      ) : (
        <>
          {summary.inconsistencies.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Alertas e Conferências Antes do Fechamento ({summary.inconsistencies.length})
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                {summary.inconsistencies.map((inc, idx) => (
                  <li key={idx}>
                    <strong>[{inc.severity}]</strong> {inc.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Nenhuma inconsistência encontrada para a competência {summary.competence}.
            </div>
          )}

          {/* Resumo Completo do Fechamento */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryBox label="Saldo Inicial" value={formatBRL(summary.openingBalance)} />
            <SummaryBox
              label="Despesas Pessoais"
              value={formatBRL(summary.totalPersonalExpenses)}
            />
            <SummaryBox
              label="Despesas Empresariais"
              value={formatBRL(summary.totalCompanyExpenses)}
            />
            <SummaryBox
              label="Total de Viagens"
              value={formatBRL(summary.totalTrips)}
              sub={`${summary.tripsCount} viagem(ns)`}
            />
            <SummaryBox
              label="Entradas no Caixa"
              value={formatBRL(summary.totalInflows)}
              tone="green"
            />
            <SummaryBox
              label="Saídas no Caixa"
              value={formatBRL(summary.totalOutflows)}
              tone="red"
            />
            <SummaryBox
              label="Saldo Final (Transportado)"
              value={formatBRL(summary.closingBalance)}
              tone="purple"
            />
            <SummaryBox
              label="Contas Pendentes / Conciliação"
              value={`${summary.pendingRemindersCount} pendente(s)`}
              sub={`Valor: ${formatBRL(summary.pendingRemindersAmount)} · Conc.: ${summary.reconciliationStatus}`}
            />
          </div>
        </>
      )}

      {/* Histórico de Fechamentos */}
      <div className="card overflow-hidden">
        <div className="border-b border-financer-100 bg-financer-50/70 px-5 py-3">
          <h3 className="text-sm font-bold text-financer-950">Histórico de Períodos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-bold uppercase text-slate-600">
                <th className="px-4 py-3">Competência</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Saldo Inicial</th>
                <th className="px-4 py-3 text-right">Entradas</th>
                <th className="px-4 py-3 text-right">Saídas</th>
                <th className="px-4 py-3 text-right">Saldo Final</th>
                <th className="px-4 py-3">Fechamento / Reabertura</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Nenhum fechamento mensal registrado ainda.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr
                    key={String(h.id)}
                    className="cursor-pointer hover:bg-financer-50/50"
                    onClick={() => {
                      setYear(Number(h.year));
                      setMonth(Number(h.month));
                    }}
                  >
                    <td className="px-4 py-3 font-bold">{String(h.competence)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          h.status === 'FECHADO'
                            ? 'badge-green'
                            : h.status === 'REABERTO'
                            ? 'badge-amber'
                            : 'badge-purple'
                        }
                      >
                        {String(h.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{formatBRL(Number(h.opening_balance))}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {formatBRL(Number(h.total_inflows))}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-700">
                      {formatBRL(Number(h.total_outflows))}
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold text-financer-950">
                      {formatBRL(Number(h.closing_balance))}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {h.closed_by_name
                        ? `Fechado por ${h.closed_by_name} em ${formatDateTimeBR(String(h.closed_at))}`
                        : 'Aberto (saldo transportado)'}
                      {h.reopen_justification ? (
                        <p className="text-amber-800">
                          Reaberto: {String(h.reopen_justification)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Confirmar Fechamento */}
      <Modal
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        title={`Confirmar Fechamento – ${summary?.competence}`}
        subtitle="Após o fechamento, alterações e exclusões neste período ficarão bloqueadas"
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            O saldo final de <strong>{formatBRL(summary?.closingBalance)}</strong> será transportado
            automaticamente como saldo inicial do mês seguinte.
          </p>
          <div>
            <label className="label-field">Observações do Fechamento (opcional)</label>
            <textarea
              rows={3}
              className="input-field"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCloseModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-primary"
              onClick={handleConfirmClose}
            >
              <Lock className="h-4 w-4" />
              {busy ? 'Fechando...' : 'Confirmar Fechamento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Reabertura (Admin) */}
      <Modal
        open={reopenModalOpen}
        onClose={() => setReopenModalOpen(false)}
        title={`Reabrir Período Fechado – ${summary?.competence}`}
        subtitle="Ação exclusiva do Administrador com registro obrigatório na Auditoria"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label-field">Justificativa Obrigatória *</label>
            <textarea
              rows={3}
              required
              className="input-field"
              placeholder="Informe o motivo técnico ou contábil para reabertura deste período..."
              value={reopenJustification}
              onChange={(e) => setReopenJustification(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setReopenModalOpen(false)}
            >
              Cancelar
            </button>
            <button type="button" disabled={busy} className="btn-danger" onClick={handleReopen}>
              <Unlock className="h-4 w-4" />
              {busy ? 'Reabrindo...' : 'Confirmar Reabertura'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'red' | 'purple';
}) {
  const cls =
    tone === 'purple'
      ? 'border-financer-300 bg-financer-50/70'
      : tone === 'green'
      ? 'border-emerald-200 bg-emerald-50/40'
      : tone === 'red'
      ? 'border-rose-200 bg-rose-50/40'
      : '';
  return (
    <div className={`card p-4 ${cls}`}>
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
