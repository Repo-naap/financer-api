import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AppModule,
  CompanyCode,
  CompanyInfo,
  CompanyTheme,
  PermissionAction,
  SystemConfig,
  UserProfile,
} from '../types';
import { apiRequest, getStoredToken, registerApiCallbacks, setStoredToken } from '../lib/api';

interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  company: CompanyInfo | null;
  companies: CompanyInfo[];
  allCompanies: CompanyInfo[];
  config: SystemConfig | null;
  setupCompleted: boolean;
  loading: boolean;
  isOnline: boolean;
  toasts: ToastItem[];
  setPreviewTheme: (theme: CompanyTheme) => void;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: number) => void;
  login: (login: string, password: string, companyCode: CompanyCode) => Promise<void>;
  switchCompany: (companyCode: CompanyCode) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  completeSetup: (token: string, user: UserProfile, company?: CompanyInfo) => Promise<void>;
  can: (module: AppModule, action: PermissionAction) => boolean;
}

const DEFAULT_COMPANIES: CompanyInfo[] = [
  { code: 'NAAP', name: 'NAAP', theme: 'purple', initial_cash_balance: 0, due_alert_days: 5 },
  { code: 'INFOR_MANAGER', name: 'INFOR MANAGER', theme: 'navy', initial_cash_balance: 0, due_alert_days: 5 },
  { code: 'CONTABILITA', name: 'CONTABILITÁ', theme: 'burgundy', initial_cash_balance: 0, due_alert_days: 5 },
];

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>(DEFAULT_COMPANIES);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [setupCompleted, setSetupCompleted] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [previewTheme, setPreviewTheme] = useState<CompanyTheme>('purple');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Aplica dinamicamente o tema visual da empresa ativa (ou da empresa selecionada no login)
  useEffect(() => {
    const activeTheme: CompanyTheme = company?.theme || previewTheme || 'purple';
    document.documentElement.setAttribute('data-theme', activeTheme);
  }, [company?.theme, previewTheme]);

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const status = await apiRequest<{
        setupCompleted: boolean;
        officeName: string;
        companies?: CompanyInfo[];
      }>('/setup/status');
      setSetupCompleted(status.setupCompleted);
      if (status.companies && status.companies.length > 0) {
        setAllCompanies(status.companies);
      }
      if (!status.setupCompleted) {
        setUser(null);
        setCompany(null);
        setLoading(false);
        return;
      }

      const token = getStoredToken();
      if (!token) {
        setUser(null);
        setCompany(null);
        setLoading(false);
        return;
      }

      const me = await apiRequest<{
        user: UserProfile;
        company: CompanyInfo;
        companies: CompanyInfo[];
        config: SystemConfig;
      }>('/auth/me');
      setUser(me.user);
      setCompany(me.company);
      setCompanies(me.companies || []);
      setConfig(me.config);
    } catch {
      setUser(null);
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    registerApiCallbacks({
      onUnauthorized: () => {
        setUser(null);
        setCompany(null);
      },
      onNetworkStatus: (online) => {
        setIsOnline(online);
      },
    });

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    refreshProfile();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshProfile]);

  const login = async (loginName: string, password: string, companyCode: CompanyCode) => {
    const data = await apiRequest<{
      token: string;
      user: UserProfile;
      company: CompanyInfo;
      companies: CompanyInfo[];
      config: SystemConfig;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: loginName, password, companyCode }),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setCompany(data.company);
    setCompanies(data.companies || []);
    setConfig(data.config);
    setSetupCompleted(true);
  };

  const switchCompany = async (companyCode: CompanyCode) => {
    const data = await apiRequest<{
      user: UserProfile;
      company: CompanyInfo;
      companies: CompanyInfo[];
      config: SystemConfig;
    }>('/auth/switch-company', {
      method: 'POST',
      body: JSON.stringify({ companyCode }),
    });
    setUser(data.user);
    setCompany(data.company);
    setCompanies(data.companies || []);
    setConfig(data.config);
    notify(`Ambiente alternado para ${data.company.name}.`, 'info');
  };

  const completeSetup = async (token: string, newUser: UserProfile, newCompany?: CompanyInfo) => {
    setStoredToken(token);
    setUser(newUser);
    if (newCompany) setCompany(newCompany);
    setSetupCompleted(true);
    await refreshProfile();
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore logout network errors
    } finally {
      setStoredToken(null);
      setUser(null);
      setCompany(null);
    }
  };

  const can = useCallback(
    (module: AppModule, action: PermissionAction): boolean => {
      if (!user) return false;
      if (action === 'reopen_period' && user.role !== 'ADMINISTRADOR') return false;
      if (user.role === 'ADMINISTRADOR') {
        if (module === 'audit' && (action === 'delete' || action === 'edit')) return false;
        return true;
      }
      return Boolean(user.permissions?.[module]?.[action]);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        company,
        companies,
        allCompanies,
        config,
        setupCompleted,
        loading,
        isOnline,
        toasts,
        setPreviewTheme,
        notify,
        dismissToast,
        login,
        switchCompany,
        logout,
        refreshProfile,
        completeSetup,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return ctx;
}
