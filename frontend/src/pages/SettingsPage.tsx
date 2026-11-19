import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Download,
  Edit2,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../lib/api';
import { formatDateTimeBR } from '../lib/format';
import {
  AppModule,
  CompanyCode,
  PermissionAction,
  PermissionsMatrix,
  SystemConfig,
  UserProfile,
  UserRole,
} from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

const MODULE_LABELS: Array<{ id: AppModule; label: string }> = [
  { id: 'dashboard', label: 'Painel Inicial' },
  { id: 'expenses', label: 'Despesas Mensais' },
  { id: 'trips', label: 'Viagens' },
  { id: 'reminders', label: 'Lembretes' },
  { id: 'cash', label: 'Caixa' },
  { id: 'invoices', label: 'Conferência de Notas' },
  { id: 'imports', label: 'Importar Dados' },
  { id: 'reconciliation', label: 'Conciliação' },
  { id: 'closing', label: 'Fechamento Mensal' },
  { id: 'audit', label: 'Auditoria' },
  { id: 'reports', label: 'Relatórios' },
  { id: 'settings', label: 'Configurações' },
];

const ACTION_LABELS: Array<{ id: PermissionAction; label: string }> = [
  { id: 'view', label: 'Visualizar' },
  { id: 'create', label: 'Cadastrar' },
  { id: 'edit', label: 'Editar' },
  { id: 'delete', label: 'Excluir' },
  { id: 'export', label: 'Exportar' },
  { id: 'close_period', label: 'Fechar' },
  { id: 'reopen_period', label: 'Reabrir' },
];

function createEmptyPermissions(): PermissionsMatrix {
  const m = {} as PermissionsMatrix;
  for (const mod of MODULE_LABELS) {
    m[mod.id] = {
      view: mod.id === 'dashboard',
      create: false,
      edit: false,
      delete: false,
      export: false,
      close_period: false,
      reopen_period: false,
    };
  }
  return m;
}

export function SettingsPage() {
  const { user, company, allCompanies, notify, refreshProfile, logout } = useAuth();
  const isAdmin = user?.role === 'ADMINISTRADOR';
  const [tab, setTab] = useState<'users' | 'office' | 'security' | 'backup'>(
    isAdmin ? 'users' : 'security'
  );

  // Office config
  const [officeForm, setOfficeForm] = useState<SystemConfig>({
    office_name: '',
    office_document: '',
    office_email: '',
    office_phone: '',
    initial_cash_balance: 0,
    due_alert_days: 5,
    setup_completed: true,
  });

  // Users
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    login: '',
    password: '',
    role: 'FINANCEIRO' as UserRole,
    active: true,
    allowed_companies: ['NAAP'] as CompanyCode[],
    permissions: createEmptyPermissions(),
  });
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfile | null>(null);
  const [resetCodeModal, setResetCodeModal] = useState<{
    login: string;
    resetCode: string;
    expiresAt: string;
  } | null>(null);

  // Security / sessions / login history / password change
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [loginHistory, setLoginHistory] = useState<Array<Record<string, unknown>>>([]);
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '' });

  // Backups & health
  const [backups, setBackups] = useState<
    Array<{ filename: string; sizeBytes: number; modifiedAt: string }>
  >([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [sessRes, histRes] = await Promise.all([
        apiRequest<{ currentSessionId: string; sessions: Array<Record<string, unknown>> }>(
          '/auth/sessions'
        ),
        apiRequest<{ items: Array<Record<string, unknown>> }>('/auth/login-history'),
      ]);
      setSessions(sessRes.sessions);
      setCurrentSessionId(sessRes.currentSessionId);
      setLoginHistory(histRes.items);

      if (isAdmin) {
        const [cfg, uRes, bkRes, hRes] = await Promise.all([
          apiRequest<SystemConfig>('/settings/config'),
          apiRequest<{ items: UserProfile[] }>('/settings/users'),
          apiRequest<{ backups: Array<{ filename: string; sizeBytes: number; modifiedAt: string }> }>(
            '/settings/backups'
          ),
          apiRequest<Record<string, unknown>>('/settings/health'),
        ]);
        setOfficeForm({
          ...cfg,
          initial_cash_balance: Number(cfg.initial_cash_balance || 0),
          due_alert_days: Number(cfg.due_alert_days || 5),
        });
        setUsers(uRes.items);
        setBackups(bkRes.backups);
        setHealth(hRes);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar configurações.', 'error');
    }
  }, [isAdmin, notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSaveOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/settings/config', {
        method: 'PUT',
        body: JSON.stringify(officeForm),
      });
      notify('Configurações do escritório salvas com sucesso.', 'success');
      await refreshProfile();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar configurações.', 'error');
    }
  };

  const openNewUser = () => {
    setEditingUser(null);
    setUserForm({
      name: '',
      login: '',
      password: '',
      role: 'FINANCEIRO',
      active: true,
      allowed_companies: [company?.code || 'NAAP'],
      permissions: createEmptyPermissions(),
    });
    setUserModalOpen(true);
  };

  const openEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setUserForm({
      name: u.name,
      login: u.login,
      password: '',
      role: u.role,
      active: u.active,
      allowed_companies:
        u.allowed_companies || u.allowedCompanies || ['NAAP', 'INFOR_MANAGER', 'CONTABILITA'],
      permissions: u.permissions || createEmptyPermissions(),
    });
    setUserModalOpen(true);
  };

  const toggleUserCompany = (code: CompanyCode) => {
    setUserForm((prev) => {
      const exists = prev.allowed_companies.includes(code);
      if (exists && prev.allowed_companies.length === 1) return prev;
      return {
        ...prev,
        allowed_companies: exists
          ? prev.allowed_companies.filter((c) => c !== code)
          : [...prev.allowed_companies, code],
      };
    });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...userForm,
        version: editingUser?.version,
      };
      if (editingUser) {
        await apiRequest(`/settings/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('Usuário atualizado com sucesso.', 'success');
      } else {
        await apiRequest('/settings/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Usuário cadastrado com sucesso.', 'success');
      }
      setUserModalOpen(false);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar usuário.', 'error');
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUserTarget) return;
    try {
      await apiRequest(`/settings/users/${deleteUserTarget.id}`, { method: 'DELETE' });
      notify('Usuário excluído com sucesso.', 'success');
      setDeleteUserTarget(null);
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir usuário.', 'error');
    }
  };

  const handleGenerateResetCode = async (u: UserProfile) => {
    try {
      const res = await apiRequest<{ login: string; resetCode: string; expiresAt: string }>(
        `/settings/users/${u.id}/reset-code`,
        { method: 'POST' }
      );
      setResetCodeModal(res);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao gerar código.', 'error');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(pwdForm),
      });
      notify('Sua senha foi alterada com sucesso.', 'success');
      setPwdForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao alterar senha.', 'error');
    }
  };

  const handleRevokeSession = async (id: string) => {
    try {
      await apiRequest(`/auth/sessions/${id}`, { method: 'DELETE' });
      notify('Sessão encerrada.', 'success');
      if (id === currentSessionId) await logout();
      else await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao encerrar sessão.', 'error');
    }
  };

  const handleCreateBackup = async () => {
    try {
      const res = await apiRequest<{ filename: string }>('/settings/backups', { method: 'POST' });
      notify(`Backup "${res.filename}" gerado e armazenado com sucesso.`, 'success');
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao gerar backup.', 'error');
    }
  };

  const handleRestoreFromDisk = async () => {
    if (!restoreConfirm) return;
    try {
      await apiRequest('/settings/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ filename: restoreConfirm }),
      });
      notify('Backup restaurado com sucesso! Faça login novamente.', 'success');
      setRestoreConfirm(null);
      await logout();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao restaurar backup.', 'error');
    }
  };

  const handleUploadBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await apiRequest('/settings/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ payload: parsed }),
      });
      notify('Backup enviado e restaurado com sucesso! Faça login novamente.', 'success');
      await logout();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Arquivo de backup inválido.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Navegação Interna */}
      <div className="card flex flex-wrap gap-2 p-3">
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${
              tab === 'users' ? 'bg-financer-700 text-white' : 'bg-financer-50 text-financer-800'
            }`}
          >
            <Users className="h-4 w-4" />
            Usuários e Permissões
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab('office')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${
              tab === 'office' ? 'bg-financer-700 text-white' : 'bg-financer-50 text-financer-800'
            }`}
          >
            <Save className="h-4 w-4" />
            Escritório e Parâmetros
          </button>
        )}
        <button
          type="button"
          onClick={() => setTab('security')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${
            tab === 'security' ? 'bg-financer-700 text-white' : 'bg-financer-50 text-financer-800'
          }`}
        >
          <Shield className="h-4 w-4" />
          Segurança, Sessões e Logins
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab('backup')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${
              tab === 'backup' ? 'bg-financer-700 text-white' : 'bg-financer-50 text-financer-800'
            }`}
          >
            <Database className="h-4 w-4" />
            Backup, Restauração e Servidor
          </button>
        )}
      </div>

      {/* ABA 1: USUÁRIOS E PERMISSÕES */}
      {tab === 'users' && isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={openNewUser}>
              <Plus className="h-4 w-4" />
              Novo Usuário
            </button>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-financer-100 bg-financer-50 text-xs font-bold uppercase text-financer-900">
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Login</th>
                    <th className="px-4 py-3">Perfil</th>
                    <th className="px-4 py-3">Empresas Autorizadas</th>
                    <th className="px-4 py-3">Situação</th>
                    <th className="px-4 py-3">Último Acesso</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => {
                    const userComps = u.allowed_companies || u.allowedCompanies || [];
                    return (
                    <tr key={u.id} className="hover:bg-financer-50/40">
                      <td className="px-4 py-3 font-semibold">{u.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{u.login}</td>
                      <td className="px-4 py-3">
                        <span className="badge-purple">{u.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {userComps.map((code) => {
                            const label =
                              allCompanies.find((c) => c.code === code)?.name || code;
                            return (
                              <span key={code} className="badge-slate text-[11px]">
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={u.active ? 'badge-green' : 'badge-red'}>
                          {u.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {u.last_login_at ? formatDateTimeBR(u.last_login_at) : 'Nunca acessou'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleGenerateResetCode(u)}
                            className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                            title="Gerar código de recuperação de senha"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditUser(u)}
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-financer-100"
                            title="Editar usuário e permissões"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          {u.id !== user?.id && (
                            <button
                              type="button"
                              onClick={() => setDeleteUserTarget(u)}
                              className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                              title="Excluir usuário"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: ESCRITÓRIO E PARÂMETROS */}
      {tab === 'office' && isAdmin && (
        <form onSubmit={handleSaveOffice} className="card max-w-2xl space-y-4 p-6">
          <h3 className="text-base font-bold text-financer-950">
            Identificação do Escritório e Parâmetros Financeiros
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label-field">Nome do Escritório (exibido nos relatórios) *</label>
              <input
                className="input-field"
                required
                value={officeForm.office_name}
                onChange={(e) => setOfficeForm({ ...officeForm, office_name: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">CNPJ / Documento</label>
              <input
                className="input-field"
                value={officeForm.office_document || ''}
                onChange={(e) => setOfficeForm({ ...officeForm, office_document: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Telefone</label>
              <input
                className="input-field"
                value={officeForm.office_phone || ''}
                onChange={(e) => setOfficeForm({ ...officeForm, office_phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Saldo Inicial Geral do Caixa (R$)</label>
              <input
                type="number"
                step="0.01"
                className="input-field"
                value={officeForm.initial_cash_balance}
                onChange={(e) =>
                  setOfficeForm({ ...officeForm, initial_cash_balance: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label-field">Antecedência de Alerta de Vencimento (dias)</label>
              <input
                type="number"
                min={0}
                max={60}
                className="input-field"
                value={officeForm.due_alert_days}
                onChange={(e) =>
                  setOfficeForm({ ...officeForm, due_alert_days: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <button type="submit" className="btn-primary">
            <Save className="h-4 w-4" />
            Salvar Configurações
          </button>
        </form>
      )}

      {/* ABA 3: SEGURANÇA, SESSÕES E HISTÓRICO DE LOGIN */}
      {tab === 'security' && (
        <div className="space-y-5">
          <form onSubmit={handleChangePassword} className="card max-w-lg space-y-3 p-5">
            <h3 className="font-bold text-financer-950">Alterar Minha Senha</h3>
            <div>
              <label className="label-field">Senha Atual</label>
              <input
                type="password"
                className="input-field"
                required
                value={pwdForm.currentPassword}
                onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Nova Senha (mín. 8 caracteres)</label>
              <input
                type="password"
                className="input-field"
                required
                minLength={8}
                value={pwdForm.newPassword}
                onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary">
              Atualizar Senha
            </button>
          </form>

          <div className="card overflow-hidden">
            <div className="border-b border-financer-100 bg-financer-50/70 px-5 py-3">
              <h3 className="text-sm font-bold text-financer-950">Sessões Registradas</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 uppercase text-slate-600">
                    <th className="px-4 py-2.5">Usuário</th>
                    <th className="px-4 py-2.5">IP</th>
                    <th className="px-4 py-2.5">Início</th>
                    <th className="px-4 py-2.5">Última Atividade</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.slice(0, 20).map((s) => {
                    const active = !s.revoked_at && new Date(String(s.expires_at)).getTime() > Date.now();
                    return (
                      <tr key={String(s.id)}>
                        <td className="px-4 py-2.5 font-semibold">
                          {String(s.user_name)} ({String(s.login)})
                          {s.id === currentSessionId && (
                            <span className="ml-2 badge-purple">Atual</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono">{String(s.ip_address || '-')}</td>
                        <td className="px-4 py-2.5">{formatDateTimeBR(String(s.created_at))}</td>
                        <td className="px-4 py-2.5">{formatDateTimeBR(String(s.last_activity_at))}</td>
                        <td className="px-4 py-2.5">
                          <span className={active ? 'badge-green' : 'badge-slate'}>
                            {active ? 'Ativa' : 'Encerrada'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {active && (
                            <button
                              type="button"
                              onClick={() => handleRevokeSession(String(s.id))}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-rose-600 hover:bg-rose-50"
                            >
                              <LogOut className="h-3.5 w-3.5" />
                              Encerrar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-financer-100 bg-financer-50/70 px-5 py-3">
              <h3 className="text-sm font-bold text-financer-950">
                Histórico de Login e Tentativas de Acesso
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 uppercase text-slate-600">
                    <th className="px-4 py-2.5">Data/Hora</th>
                    <th className="px-4 py-2.5">Login Informado</th>
                    <th className="px-4 py-2.5">Resultado</th>
                    <th className="px-4 py-2.5">Motivo</th>
                    <th className="px-4 py-2.5">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loginHistory.slice(0, 30).map((h) => (
                    <tr key={String(h.id)}>
                      <td className="px-4 py-2.5 font-mono">{formatDateTimeBR(String(h.created_at))}</td>
                      <td className="px-4 py-2.5 font-semibold">{String(h.login_attempted)}</td>
                      <td className="px-4 py-2.5">
                        <span className={h.success ? 'badge-green' : 'badge-red'}>
                          {h.success ? 'Sucesso' : 'Bloqueado/Falha'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{String(h.reason || '-')}</td>
                      <td className="px-4 py-2.5 font-mono">{String(h.ip_address || '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: BACKUP, RESTAURAÇÃO E MONITORAMENTO */}
      {tab === 'backup' && isAdmin && (
        <div className="space-y-5">
          {health && (
            <div className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">Status do Servidor</span>
                <p className="mt-1 text-lg font-extrabold text-emerald-700">
                  {String(health.status)}
                </p>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">Banco de Dados</span>
                <p className="mt-1 text-lg font-extrabold text-financer-900">
                  PostgreSQL ({String(health.databaseDriver)})
                </p>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">Municípios IBGE</span>
                <p className="mt-1 text-lg font-extrabold">
                  {String((health.counts as Record<string, string>)?.municipalities || 0)}
                </p>
              </div>
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">Eventos de Auditoria</span>
                <p className="mt-1 text-lg font-extrabold">
                  {String((health.counts as Record<string, string>)?.audit_logs || 0)}
                </p>
              </div>
            </div>
          )}

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-bold text-financer-950">Backup e Restauração do Banco de Dados</h3>
              <p className="text-xs text-slate-600">
                Gere cópias de segurança verificadas por SHA-256 ou restaure um arquivo anterior.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" onClick={handleCreateBackup}>
                <Database className="h-4 w-4" />
                Gerar Novo Backup Agora
              </button>
              <label className="btn-secondary cursor-pointer">
                <Upload className="h-4 w-4" />
                Restaurar de Arquivo (.json)
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleUploadBackupFile}
                />
              </label>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-financer-100 bg-financer-50/70 px-5 py-3">
              <h3 className="text-sm font-bold text-financer-950">Backups Armazenados no Servidor</h3>
            </div>
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-600">
                  <th className="px-4 py-3">Arquivo</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3 text-right">Tamanho</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Nenhum backup gerado ainda.
                    </td>
                  </tr>
                ) : (
                  backups.map((b) => (
                    <tr key={b.filename}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{b.filename}</td>
                      <td className="px-4 py-3">{formatDateTimeBR(b.modifiedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {(b.sizeBytes / 1024).toFixed(1)} KB
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              downloadAuthenticatedFile(`/settings/backups/${b.filename}`, b.filename)
                            }
                            className="btn-secondary px-2.5 py-1 text-xs"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Baixar
                          </button>
                          <button
                            type="button"
                            onClick={() => setRestoreConfirm(b.filename)}
                            className="btn-danger px-2.5 py-1 text-xs"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restaurar
                          </button>
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

      {/* Modal Criar/Editar Usuário + Permissões Granulares */}
      <Modal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title={editingUser ? 'Editar Usuário e Permissões' : 'Cadastrar Novo Usuário'}
        maxWidth="xl"
      >
        <form onSubmit={handleSaveUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field">Nome Completo *</label>
              <input
                className="input-field"
                required
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Login *</label>
              <input
                className="input-field"
                required
                value={userForm.login}
                onChange={(e) => setUserForm({ ...userForm, login: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">
                {editingUser ? 'Nova Senha (deixe vazio para manter)' : 'Senha (mín. 8 caracteres) *'}
              </label>
              <input
                type="password"
                className="input-field"
                required={!editingUser}
                minLength={editingUser ? undefined : 8}
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-field">Perfil *</label>
                <select
                  className="input-field"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
                >
                  <option value="ADMINISTRADOR">ADMINISTRADOR</option>
                  <option value="FINANCEIRO">FINANCEIRO</option>
                  <option value="CONSULTA">CONSULTA</option>
                  <option value="PERSONALIZADO">PERSONALIZADO</option>
                </select>
              </div>
              <div>
                <label className="label-field">Situação</label>
                <select
                  className="input-field"
                  value={userForm.active ? 'true' : 'false'}
                  onChange={(e) => setUserForm({ ...userForm, active: e.target.value === 'true' })}
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo (Bloqueado)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Empresas Permitidas */}
          <div className="rounded-xl border border-financer-200 bg-financer-50/40 p-4">
            <h4 className="mb-2 text-xs font-bold uppercase text-financer-900">
              Empresas Autorizadas para este Usuário
            </h4>
            {userForm.role === 'ADMINISTRADOR' ? (
              <p className="text-xs text-slate-600">
                Usuários com perfil <strong>ADMINISTRADOR</strong> possuem acesso automático a todas
                as 3 empresas (NAAP, INFOR MANAGER e CONTABILITÁ).
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {allCompanies.map((c) => {
                  const checked = userForm.allowed_companies.includes(c.code);
                  return (
                    <label
                      key={c.code}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${
                        checked
                          ? 'border-financer-500 bg-financer-100 text-financer-950'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUserCompany(c.code)}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {userForm.role === 'PERSONALIZADO' && (
            <div className="rounded-xl border border-financer-200 p-4">
              <h4 className="mb-3 text-xs font-bold uppercase text-financer-900">
                Permissões Granulares por Aba e Operação
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-financer-100 bg-financer-50">
                      <th className="px-3 py-2">Aba / Módulo</th>
                      {ACTION_LABELS.map((a) => (
                        <th key={a.id} className="px-2 py-2 text-center">
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {MODULE_LABELS.map((mod) => (
                      <tr key={mod.id}>
                        <td className="px-3 py-2 font-semibold">{mod.label}</td>
                        {ACTION_LABELS.map((act) => {
                          const disabled =
                            act.id === 'reopen_period' ||
                            (mod.id === 'audit' &&
                              (act.id === 'create' || act.id === 'edit' || act.id === 'delete'));
                          return (
                            <td key={act.id} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                disabled={disabled}
                                checked={Boolean(userForm.permissions?.[mod.id]?.[act.id])}
                                onChange={(e) =>
                                  setUserForm({
                                    ...userForm,
                                    permissions: {
                                      ...userForm.permissions,
                                      [mod.id]: {
                                        ...userForm.permissions[mod.id],
                                        [act.id]: e.target.checked,
                                      },
                                    },
                                  })
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setUserModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary">
              Salvar Usuário
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetCodeModal)}
        onClose={() => setResetCodeModal(null)}
        title="Código de Recuperação de Senha"
        maxWidth="sm"
      >
        {resetCodeModal && (
          <div className="space-y-3 text-sm">
            <p>
              Entregue este código seguro ao usuário <strong>{resetCodeModal.login}</strong> para
              redefinir sua senha na tela de login:
            </p>
            <div className="rounded-xl border border-financer-300 bg-financer-50 p-4 text-center font-mono text-2xl font-extrabold tracking-widest text-financer-900">
              {resetCodeModal.resetCode}
            </div>
            <p className="text-xs text-slate-500">
              Válido até: {formatDateTimeBR(resetCodeModal.expiresAt)} (uso único).
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteUserTarget)}
        title="Excluir Usuário"
        message={`Confirma a exclusão do usuário "${deleteUserTarget?.name}" (${deleteUserTarget?.login})?`}
        confirmLabel="Excluir"
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteUserTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(restoreConfirm)}
        title="Restaurar Backup do Banco de Dados"
        message={`ATENÇÃO: Todos os dados atuais serão substituídos pelos dados do arquivo "${restoreConfirm}". Deseja continuar?`}
        confirmLabel="Restaurar Agora"
        onConfirm={handleRestoreFromDisk}
        onCancel={() => setRestoreConfirm(null)}
      />
    </div>
  );
}
