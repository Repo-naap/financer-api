import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { CompanyCode, CompanyInfo, UserProfile } from '../types';

export function SetupWizardPage() {
  const { completeSetup, allCompanies, setPreviewTheme, notify } = useAuth();
  const [form, setForm] = useState({
    companyCode: 'NAAP' as CompanyCode,
    officeDocument: '',
    officePhone: '',
    initialCashBalance: '0',
    dueAlertDays: '5',
    adminName: '',
    adminLogin: '',
    adminPassword: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const found = allCompanies.find((c) => c.code === form.companyCode);
    if (found) setPreviewTheme(found.theme);
  }, [form.companyCode, allCompanies, setPreviewTheme]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.adminPassword !== form.confirmPassword) {
      setError('A confirmação de senha não confere.');
      return;
    }
    if (form.adminPassword.length < 8) {
      setError('A senha do administrador deve conter pelo menos 8 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const selectedComp = allCompanies.find((c) => c.code === form.companyCode);
      const res = await apiRequest<{ token: string; user: UserProfile; company: CompanyInfo }>(
        '/setup/initialize',
        {
          method: 'POST',
          body: JSON.stringify({
            companyCode: form.companyCode,
            officeName: selectedComp?.name || 'NAAP',
            officeDocument: form.officeDocument,
            officePhone: form.officePhone,
            initialCashBalance: Number(form.initialCashBalance.replace(',', '.')) || 0,
            dueAlertDays: Number(form.dueAlertDays) || 5,
            adminName: form.adminName,
            adminLogin: form.adminLogin,
            adminPassword: form.adminPassword,
          }),
        }
      );
      await completeSetup(res.token, res.user, res.company);
      notify('Configuração inicial concluída! Bem-vindo ao FINANCER Multi-Empresa.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao inicializar o sistema.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-financer-950 via-financer-900 to-financer-700 p-4 transition-colors duration-300">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-financer-300/30 bg-white shadow-2xl">
        <div className="bg-gradient-to-r from-financer-900 to-financer-700 px-8 py-6 text-white">
          <div className="flex flex-wrap items-center gap-4">
            <div className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 shadow-md">
              <img
                src="/financer-logo.png"
                alt="FINANCER – Gestão Financeira"
                className="h-9 w-auto object-contain"
              />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight">Configuração Inicial Segura</h1>
              <p className="text-xs text-financer-100">
                Ambiente Multi-Empresa (NAAP · INFOR MANAGER · CONTABILITÁ)
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-8">
          <div className="rounded-xl border border-financer-200 bg-financer-50 p-4 text-xs leading-relaxed text-financer-900">
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="h-4 w-4 text-financer-700" />
              Ambiente Multi-Empresa Isolado
            </div>
            <p className="mt-1">
              As empresas <strong>NAAP (Roxo)</strong>, <strong>INFOR MANAGER (Azul Marinho)</strong>{' '}
              e <strong>CONTABILITÁ (Bordô)</strong> já estão pré-cadastradas com bancos de dados
              separados. O Administrador principal terá acesso completo às 3 empresas.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              {error}
            </div>
          )}

          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-financer-800">
              1. Empresa Inicial e Parâmetros
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label-field">Empresa para Iniciar Agora *</label>
                <select
                  className="input-field"
                  value={form.companyCode}
                  onChange={(e) =>
                    setForm({ ...form, companyCode: e.target.value as CompanyCode })
                  }
                >
                  <option value="NAAP">NAAP (Identidade Roxa / Lilás)</option>
                  <option value="INFOR_MANAGER">INFOR MANAGER (Identidade Azul Marinho)</option>
                  <option value="CONTABILITA">CONTABILITÁ (Identidade Bordô)</option>
                </select>
              </div>
              <div>
                <label className="label-field">CNPJ / Documento (da empresa selecionada)</label>
                <input
                  className="input-field"
                  placeholder="00.000.000/0001-00"
                  value={form.officeDocument}
                  onChange={(e) => setForm({ ...form, officeDocument: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Telefone</label>
                <input
                  className="input-field"
                  placeholder="(00) 00000-0000"
                  value={form.officePhone}
                  onChange={(e) => setForm({ ...form, officePhone: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Saldo Inicial do Caixa (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input-field"
                  value={form.initialCashBalance}
                  onChange={(e) => setForm({ ...form, initialCashBalance: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Dias de Alerta de Vencimento</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  className="input-field"
                  value={form.dueAlertDays}
                  onChange={(e) => setForm({ ...form, dueAlertDays: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-financer-800">
              2. Administrador Principal (Acesso às 3 Empresas)
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label-field">Nome Completo *</label>
                <input
                  className="input-field"
                  required
                  placeholder="Nome do responsável"
                  value={form.adminName}
                  onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Login de Acesso *</label>
                <input
                  className="input-field"
                  required
                  placeholder="ex: admin"
                  value={form.adminLogin}
                  onChange={(e) => setForm({ ...form, adminLogin: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Senha (mín. 8 caracteres) *</label>
                <input
                  type="password"
                  className="input-field"
                  required
                  minLength={8}
                  value={form.adminPassword}
                  onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Confirmar Senha *</label>
                <input
                  type="password"
                  className="input-field"
                  required
                  minLength={8}
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                />
              </div>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full py-3 text-base">
            <CheckCircle2 className="h-5 w-5" />
            {submitting ? 'Configurando banco de dados...' : 'Concluir Configuração e Acessar'}
          </button>
        </form>
      </div>
    </div>
  );
}
