import React, { useState } from 'react';
import {
  ArrowLeftRight,
  BellRing,
  Building2,
  FileBarChart2,
  FileCheck2,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plane,
  Receipt,
  Scale,
  Settings,
  Upload,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AppModule, CompanyCode } from '../types';

export interface NavItem {
  id: AppModule;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Painel Inicial', icon: LayoutDashboard },
  { id: 'expenses', label: 'Despesas Mensais', icon: Receipt },
  { id: 'trips', label: 'Viagens', icon: Plane },
  { id: 'reminders', label: 'Lembretes', icon: BellRing },
  { id: 'cash', label: 'Caixa', icon: Wallet },
  { id: 'invoices', label: 'Conferência de Notas', icon: FileCheck2 },
  { id: 'imports', label: 'Importar Dados', icon: Upload },
  { id: 'reconciliation', label: 'Conciliação Financeira', icon: Scale },
  { id: 'closing', label: 'Fechamento Mensal', icon: Lock },
  { id: 'audit', label: 'Auditoria', icon: History },
  { id: 'reports', label: 'Relatórios', icon: FileBarChart2 },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

interface LayoutProps {
  activeTab: AppModule;
  onSelectTab: (tab: AppModule) => void;
  children: React.ReactNode;
}

export function Layout({ activeTab, onSelectTab, children }: LayoutProps) {
  const { user, company, companies, isOnline, logout, switchCompany, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'settings') return user?.role === 'ADMINISTRADOR' || can('settings', 'view');
    return can(item.id, 'view');
  });

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab);

  const handleSwitch = async (code: CompanyCode) => {
    if (!code || code === company?.code) return;
    setSwitching(true);
    try {
      await switchCompany(code);
    } finally {
      setSwitching(false);
    }
  };

  const renderSidebar = () => (
    <div className="flex h-full flex-col bg-gradient-to-b from-financer-950 via-financer-900 to-financer-800 text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="space-y-2.5">
          {/* Logo Oficial do Sistema FINANCER */}
          <div className="flex items-center justify-center rounded-xl bg-white px-3 py-2 shadow-md">
            <img
              src="/financer-logo.png"
              alt="FINANCER – Gestão Financeira"
              className="h-8 w-auto object-contain"
            />
          </div>

          {/* Identificação / Logo da Empresa Ativa */}
          {company?.code === 'NAAP' ? (
            <div className="flex items-center justify-center rounded-lg bg-white/95 px-2.5 py-1.5 ring-2 ring-[#F5B800]/80">
              <img
                src="/naap-logo.png"
                alt="NAAP – Núcleo de Assessoria à Administração Pública"
                className="h-8 w-auto object-contain"
              />
            </div>
          ) : company?.code === 'INFOR_MANAGER' ? (
            <div className="flex items-center justify-center rounded-lg bg-white/95 px-2.5 py-1.5 ring-2 ring-[#00B4D8]/80">
              <img
                src="/informanager-logo.png"
                alt="INFOR MANAGER"
                className="h-9 w-auto object-contain"
              />
            </div>
          ) : (
            <div className="rounded-lg bg-white/10 px-3 py-1.5 text-center">
              <p className="truncate text-xs font-extrabold uppercase tracking-wider text-financer-100">
                {company?.name || 'CONTABILITÁ'}
              </p>
            </div>
          )}
        </div>

        {/* Troca rápida de empresa se o usuário tiver acesso a mais de 1 empresa */}
        {companies.length > 1 && (
          <div className="mt-3">
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-financer-200">
              <ArrowLeftRight className="h-3 w-3" />
              Empresa Ativa
            </label>
            <select
              disabled={switching}
              value={company?.code || 'NAAP'}
              onChange={(e) => handleSwitch(e.target.value as CompanyCode)}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white outline-none transition hover:bg-white/15 focus:border-white/50"
            >
              {companies.map((c) => (
                <option key={c.code} value={c.code} className="bg-slate-900 text-white">
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                setMobileOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition ${
                active
                  ? 'bg-white text-financer-900 shadow-md'
                  : 'text-financer-100 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-financer-700' : 'text-financer-300'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 rounded-xl bg-white/10 p-3">
          <p className="truncate text-xs font-bold text-white">{user?.name}</p>
          <p className="truncate text-[11px] text-financer-200">
            @{user?.login} · {user?.role}
          </p>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-financer-100 transition hover:bg-rose-500/20 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Encerrar Sessão
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-screen">{renderSidebar()}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="relative w-72 max-w-[85vw] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-lg bg-white/15 p-1.5 text-white"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebar()}
          </div>
          <div
            className="flex-1 bg-financer-950/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isOnline && (
          <div className="flex items-center justify-center gap-2 bg-rose-600 px-4 py-2 text-xs font-semibold text-white">
            <WifiOff className="h-4 w-4" />
            Sem conexão com o servidor central do FINANCER. Nenhuma alteração será confirmada até o restabelecimento da conexão.
          </div>
        )}

        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-financer-100 bg-white/95 px-4 py-3.5 shadow-2xs backdrop-blur-sm sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg border border-financer-200 p-2 text-financer-800 hover:bg-financer-50 lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-financer-950">
                  {activeNav?.label || 'FINANCER'}
                </h2>
                <span className="badge-purple font-extrabold tracking-wide">
                  {company?.name || 'NAAP'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Dados isolados exclusivamente para <strong>{company?.name}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isOnline ? 'Sincronizado' : 'Offline'}</span>
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
