import React, { useEffect, useState } from 'react';
import { Building2, Check, KeyRound, Lock, LogIn, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiRequest } from '../lib/api';
import { CompanyCode, CompanyTheme } from '../types';

const COMPANY_STYLES: Record<
  CompanyCode,
  { badge: string; dot: string; ring: string; subtitle: string; theme: CompanyTheme }
> = {
  NAAP: {
    badge: 'bg-[#FAE3F2] text-[#5C1241]',
    dot: 'bg-[#A82979] ring-2 ring-[#F5B800]',
    ring: 'border-[#A82979] bg-[#FDF2F9] text-[#5C1241] ring-2 ring-[#F5B800]/60',
    subtitle: 'Ameixa Vibrante / Dourado',
    theme: 'purple',
  },
  INFOR_MANAGER: {
    badge: 'bg-[#D6EFFF] text-[#003566]',
    dot: 'bg-[#0074C4] ring-2 ring-[#00B4D8]',
    ring: 'border-[#0074C4] bg-[#EDF8FF] text-[#003566] ring-2 ring-[#00B4D8]/60',
    subtitle: 'Azul Vibrante / Ciano',
    theme: 'navy',
  },
  CONTABILITA: {
    badge: 'bg-rose-100 text-rose-950',
    dot: 'bg-[#7F1D3A]',
    ring: 'border-[#7F1D3A] bg-rose-50 text-[#4A0D1F] ring-2 ring-rose-200',
    subtitle: 'Tema Bordô',
    theme: 'burgundy',
  },
};

export function LoginPage() {
  const { login, allCompanies, setPreviewTheme, notify } = useAuth();
  const [mode, setMode] = useState<'login' | 'recover'>('login');
  const [selectedCompany, setSelectedCompany] = useState<CompanyCode>('NAAP');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const found = allCompanies.find((c) => c.code === selectedCompany);
    setPreviewTheme(found?.theme || COMPANY_STYLES[selectedCompany].theme);
  }, [selectedCompany, allCompanies, setPreviewTheme]);

  const activeCompanyObj = allCompanies.find((c) => c.code === selectedCompany) || allCompanies[0];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(loginName, password, selectedCompany);
      notify(`Bem-vindo(a) à ${activeCompanyObj?.name || selectedCompany}!`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao autenticar.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ login: loginName, resetCode, newPassword }),
      });
      notify(res.message, 'success');
      setMode('login');
      setPassword('');
      setResetCode('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido ou expirado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-financer-950 via-financer-900 to-financer-700 p-4 transition-colors duration-300">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-financer-300/30 bg-white shadow-2xl">
        <div className="bg-gradient-to-r from-financer-900 to-financer-700 px-8 py-6 text-center text-white transition-colors duration-300">
          <div className="mx-auto mb-3 flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-2 shadow-lg">
              <img
                src="/financer-logo.png"
                alt="Logo FINANCER – Gestão Financeira"
                className="h-10 w-auto object-contain"
              />
            </div>
            {selectedCompany === 'NAAP' && (
              <div className="inline-flex items-center justify-center rounded-2xl bg-white px-3.5 py-2 shadow-lg ring-2 ring-[#F5B800]/80">
                <img
                  src="/naap-logo.png"
                  alt="Logo NAAP"
                  className="h-10 w-auto object-contain"
                />
              </div>
            )}
            {selectedCompany === 'INFOR_MANAGER' && (
              <div className="inline-flex items-center justify-center rounded-2xl bg-white px-3.5 py-1.5 shadow-lg ring-2 ring-[#00B4D8]/80">
                <img
                  src="/informanager-logo.png"
                  alt="Logo INFOR MANAGER"
                  className="h-11 w-auto object-contain"
                />
              </div>
            )}
          </div>
          <p className="mt-1 text-xs font-medium text-financer-100">
            Empresa selecionada: <strong>{activeCompanyObj?.name}</strong>
          </p>
        </div>

        <div className="p-7">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              {error}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-5">
              {/* Seletor visual das 3 Empresas */}
              <div>
                <label className="label-field mb-2">Selecione a Empresa para Acessar *</label>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {allCompanies.map((c) => {
                    const isSelected = selectedCompany === c.code;
                    const st = COMPANY_STYLES[c.code];
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setSelectedCompany(c.code)}
                        className={`relative flex flex-col items-start rounded-xl border-2 p-3 text-left transition ${
                          isSelected
                            ? st.ring
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className={`h-3 w-3 rounded-full ${st.dot}`} />
                          {isSelected && <Check className="h-4 w-4 shrink-0" />}
                        </div>
                        <span className="mt-2 text-xs font-extrabold tracking-wide">{c.name}</span>
                        <span className="text-[10px] opacity-75">{st.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="label-field">Login</label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="input-field pl-9"
                    required
                    autoFocus
                    placeholder="Seu login de acesso"
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label-field">Senha</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    className="input-field pl-9"
                    required
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
                <LogIn className="h-4 w-4" />
                {busy
                  ? 'Autenticando...'
                  : `Entrar em ${activeCompanyObj?.name || selectedCompany}`}
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setMode('recover');
                  }}
                  className="text-xs font-semibold text-financer-700 hover:text-financer-900 hover:underline"
                >
                  Esqueci minha senha / Usar código de recuperação
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
              <div className="rounded-lg bg-financer-50 p-3 text-xs text-financer-900">
                Solicite ao Administrador um <strong>Código de Recuperação</strong> em Configurações
                &rarr; Usuários e informe-o abaixo para definir sua nova senha.
              </div>
              <div>
                <label className="label-field">Login</label>
                <input
                  className="input-field"
                  required
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                />
              </div>
              <div>
                <label className="label-field">Código de Recuperação</label>
                <input
                  className="input-field uppercase tracking-widest"
                  required
                  placeholder="EX: A1B2C3D4E5F6"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                />
              </div>
              <div>
                <label className="label-field">Nova Senha (mín. 8 caracteres)</label>
                <input
                  type="password"
                  className="input-field"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
                <KeyRound className="h-4 w-4" />
                {busy ? 'Redefinindo...' : 'Redefinir Senha'}
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setMode('login');
                  }}
                  className="text-xs font-semibold text-slate-600 hover:text-financer-800"
                >
                  Voltar para o login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
