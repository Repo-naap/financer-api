import { useState } from 'react';
import { FileBarChart2 } from 'lucide-react';
import { buildQueryString } from '../lib/api';
import { MONTHS_PT } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';
import { ExportMenu } from '../components/ExportMenu';

export function ReportsPage() {
  const { can, company } = useAuth();
  const companyAccount = company?.name || 'NAAP';
  const now = new Date();

  const [exp, setExp] = useState({ startDate: '', endDate: '', category: 'ALL', expenseType: 'ALL', invoiceNumber: '' });
  const [trip, setTrip] = useState({ startDate: '', endDate: '', group: 'ALL', uf: '', municipality: '', collaborator: '', paymentMethod: 'ALL' });
  const [rem, setRem] = useState({ startDate: '', endDate: '', account: 'ALL', digit: 'ALL', status: 'ALL', description: '' });
  const [cash, setCash] = useState({ reportMode: 'MENSAL', year: now.getFullYear(), month: now.getMonth() + 1, startDate: '', endDate: '', destination: '', entryType: 'ALL' });
  const [inv, setInv] = useState({ year: now.getFullYear(), group: 'ALL', city: '' });
  const [closing, setClosing] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [audit, setAudit] = useState({ startDate: '', endDate: '', operation: 'ALL' });

  return (
    <div className="space-y-6">
      <div className="card flex items-center gap-3 bg-gradient-to-r from-financer-900 to-financer-700 p-5 text-white">
        <FileBarChart2 className="h-8 w-8 shrink-0 text-financer-200" />
        <div>
          <h2 className="text-lg font-extrabold">Central de Relatórios Gerais – FINANCER</h2>
          <p className="text-xs text-financer-100">
            Todos os relatórios incluem identificação institucional do escritório, período, data/hora
            de emissão, responsável, totais, subtotais e paginação (PDF), fórmulas (Excel) e tabelas
            editáveis (Word).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 1. Despesas */}
        {can('expenses', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">1. Relatório de Despesas Mensais</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input-field" value={exp.startDate} onChange={(e) => setExp({ ...exp, startDate: e.target.value })} />
              <input type="date" className="input-field" value={exp.endDate} onChange={(e) => setExp({ ...exp, endDate: e.target.value })} />
              <select className="input-field" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>
                <option value="ALL">Todas as categorias</option>
                <option value="Alimentação">Alimentação</option>
                <option value="Farmácia">Farmácia</option>
                <option value="Gerais">Gerais</option>
                <option value="Combustíveis">Combustíveis</option>
                <option value="Outros">Outros</option>
              </select>
              <select className="input-field" value={exp.expenseType} onChange={(e) => setExp({ ...exp, expenseType: e.target.value })}>
                <option value="ALL">Empresa e Pessoal</option>
                <option value="Empresa">Empresa</option>
                <option value="Pessoal">Pessoal</option>
              </select>
            </div>
            <ExportMenu
              baseEndpoint="/expenses/export"
              queryString={buildQueryString({
                startDate: exp.startDate,
                endDate: exp.endDate,
                category: exp.category === 'ALL' ? '' : exp.category,
                expenseType: exp.expenseType === 'ALL' ? '' : exp.expenseType,
              })}
              formats={['pdf', 'xlsx', 'docx']}
              filenamePrefix="financer-despesas"
            />
          </div>
        )}

        {/* 2. Viagens */}
        {can('trips', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">2. Relatório de Viagens</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input-field" value={trip.startDate} onChange={(e) => setTrip({ ...trip, startDate: e.target.value })} />
              <input type="date" className="input-field" value={trip.endDate} onChange={(e) => setTrip({ ...trip, endDate: e.target.value })} />
              <select className="input-field" value={trip.group} onChange={(e) => setTrip({ ...trip, group: e.target.value })}>
                <option value="ALL">Todos os Grupos</option>
                <option value="GP-A">GP-A</option>
                <option value="GP-B">GP-B</option>
                <option value="GP-C">GP-C</option>
                <option value="GP-D">GP-D</option>
                <option value="ALFA">ALFA</option>
              </select>
              <input className="input-field" placeholder="Colaborador" value={trip.collaborator} onChange={(e) => setTrip({ ...trip, collaborator: e.target.value })} />
            </div>
            <ExportMenu
              baseEndpoint="/trips/export"
              queryString={buildQueryString({
                startDate: trip.startDate,
                endDate: trip.endDate,
                group: trip.group === 'ALL' ? '' : trip.group,
                collaborator: trip.collaborator,
              })}
              formats={['pdf', 'xlsx']}
              filenamePrefix="financer-viagens"
            />
          </div>
        )}

        {/* 3. Lembretes */}
        {can('reminders', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">3. Relatório de Lembretes / Obrigações</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="input-field" value={rem.startDate} onChange={(e) => setRem({ ...rem, startDate: e.target.value })} />
              <input type="date" className="input-field" value={rem.endDate} onChange={(e) => setRem({ ...rem, endDate: e.target.value })} />
              <select className="input-field" value={rem.account} onChange={(e) => setRem({ ...rem, account: e.target.value })}>
                <option value="ALL">Conta: Todas</option>
                <option value="PESSOAS">PESSOAS</option>
                <option value={companyAccount}>{companyAccount}</option>
              </select>
              <select className="input-field" value={rem.status} onChange={(e) => setRem({ ...rem, status: e.target.value })}>
                <option value="ALL">Situação: Todas</option>
                <option value="PENDENTE">Pendente</option>
                <option value="PAGA">Paga</option>
              </select>
            </div>
            <ExportMenu
              baseEndpoint="/reminders/export"
              queryString={buildQueryString({
                startDate: rem.startDate,
                endDate: rem.endDate,
                account: rem.account === 'ALL' ? '' : rem.account,
                status: rem.status === 'ALL' ? '' : rem.status,
              })}
              formats={['pdf', 'xlsx', 'docx']}
              filenamePrefix="financer-lembretes"
            />
          </div>
        )}

        {/* 4. Caixa */}
        {can('cash', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">4. Relatório do Caixa</h3>
            <div className="grid grid-cols-3 gap-2">
              <select className="input-field" value={cash.reportMode} onChange={(e) => setCash({ ...cash, reportMode: e.target.value })}>
                <option value="MENSAL">Mensal</option>
                <option value="ANUAL">Anual</option>
              </select>
              {cash.reportMode === 'MENSAL' && (
                <select className="input-field" value={cash.month} onChange={(e) => setCash({ ...cash, month: Number(e.target.value) })}>
                  {MONTHS_PT.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              )}
              <input type="number" className="input-field" value={cash.year} onChange={(e) => setCash({ ...cash, year: Number(e.target.value) })} />
            </div>
            <ExportMenu
              baseEndpoint="/cash/export"
              queryString={buildQueryString({
                reportMode: cash.reportMode,
                year: cash.year,
                month: cash.reportMode === 'MENSAL' ? cash.month : undefined,
              })}
              formats={['pdf', 'xlsx', 'docx']}
              filenamePrefix="financer-caixa"
            />
          </div>
        )}

        {/* 5. Conferência de Notas */}
        {can('invoices', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">Relatório de Conferência de Notas</h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className="input-field"
                value={inv.year}
                onChange={(e) => setInv({ ...inv, year: Number(e.target.value) })}
              />
              {company?.code === 'NAAP' ? (
                <select
                  className="input-field"
                  value={inv.group}
                  onChange={(e) => setInv({ ...inv, group: e.target.value })}
                >
                  <option value="ALL">Todos os Grupos</option>
                  <option value="GP-A">GP-A</option>
                  <option value="GP-B">GP-B</option>
                  <option value="GP-C">GP-C</option>
                  <option value="GP-D">GP-D</option>
                  <option value="RH-Folha">RH-Folha</option>
                </select>
              ) : (
                <input
                  className="input-field"
                  placeholder="Cidade (opcional)"
                  value={inv.city}
                  onChange={(e) => setInv({ ...inv, city: e.target.value })}
                />
              )}
            </div>
            <ExportMenu
              baseEndpoint="/invoices/export"
              queryString={buildQueryString({
                year: inv.year,
                group: inv.group === 'ALL' ? '' : inv.group,
                city: inv.city,
              })}
              formats={['xlsx', 'pdf', 'docx']}
              filenamePrefix={`financer-conferencia-notas-${inv.year}`}
            />
          </div>
        )}

        {/* 5. Conciliação */}
        {can('reconciliation', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">5. Relatório de Conciliação Financeira</h3>
            <p className="text-xs text-slate-600">
              Exporta todas as conferências registradas com diferenças, justificativas e responsáveis.
            </p>
            <ExportMenu
              baseEndpoint="/reconciliation/export"
              formats={['pdf', 'xlsx']}
              filenamePrefix="financer-conciliacao"
            />
          </div>
        )}

        {/* 6. Fechamento Mensal */}
        {can('closing', 'export') && (
          <div className="card space-y-3 p-5">
            <h3 className="font-bold text-financer-950">6. Relatório de Fechamento Mensal</h3>
            <div className="grid grid-cols-2 gap-2">
              <select className="input-field" value={closing.month} onChange={(e) => setClosing({ ...closing, month: Number(e.target.value) })}>
                {MONTHS_PT.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <input type="number" className="input-field" value={closing.year} onChange={(e) => setClosing({ ...closing, year: Number(e.target.value) })} />
            </div>
            <ExportMenu
              baseEndpoint={`/closing/${closing.year}/${closing.month}/export`}
              formats={['pdf', 'xlsx', 'docx']}
              filenamePrefix={`financer-fechamento-${closing.year}-${String(closing.month).padStart(2, '0')}`}
            />
          </div>
        )}

        {/* 7. Auditoria */}
        {can('audit', 'export') && (
          <div className="card space-y-3 p-5 lg:col-span-2">
            <h3 className="font-bold text-financer-950">7. Relatório de Auditoria e Histórico</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input type="date" className="input-field" value={audit.startDate} onChange={(e) => setAudit({ ...audit, startDate: e.target.value })} />
              <input type="date" className="input-field" value={audit.endDate} onChange={(e) => setAudit({ ...audit, endDate: e.target.value })} />
              <select className="input-field" value={audit.operation} onChange={(e) => setAudit({ ...audit, operation: e.target.value })}>
                <option value="ALL">Todas as operações</option>
                <option value="INCLUSAO">Inclusão</option>
                <option value="EDICAO">Edição</option>
                <option value="EXCLUSAO">Exclusão</option>
                <option value="FECHAMENTO_MENSAL">Fechamento Mensal</option>
                <option value="REABERTURA">Reabertura</option>
              </select>
            </div>
            <ExportMenu
              baseEndpoint="/audit/export"
              queryString={buildQueryString({
                startDate: audit.startDate,
                endDate: audit.endDate,
                operation: audit.operation === 'ALL' ? '' : audit.operation,
              })}
              formats={['pdf', 'xlsx']}
              filenamePrefix="financer-auditoria"
            />
          </div>
        )}
      </div>
    </div>
  );
}
