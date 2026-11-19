import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppModule } from './types';
import { Layout } from './components/Layout';
import { ToastContainer } from './components/ToastContainer';
import { SetupWizardPage } from './pages/SetupWizardPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { TripsPage } from './pages/TripsPage';
import { RemindersPage } from './pages/RemindersPage';
import { CashPage } from './pages/CashPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ImportsPage } from './pages/ImportsPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ClosingPage } from './pages/ClosingPage';
import { AuditPage } from './pages/AuditPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

function FinancerShell() {
  const { user, company, setupCompleted, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<AppModule>('dashboard');

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-financer-950 via-financer-900 to-financer-700 text-white">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-financer-300 border-t-white" />
        <p className="mt-4 text-sm font-semibold tracking-wide text-financer-100">
          Carregando FINANCER – Gestão Financeira...
        </p>
      </div>
    );
  }

  if (!setupCompleted) {
    return <SetupWizardPage />;
  }

  if (!user) {
    return <LoginPage />;
  }

  const companyKey = company?.code || 'NAAP';

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage key={companyKey} />;
      case 'expenses':
        return <ExpensesPage key={companyKey} />;
      case 'trips':
        return <TripsPage key={companyKey} />;
      case 'reminders':
        return <RemindersPage key={companyKey} />;
      case 'cash':
        return <CashPage key={companyKey} />;
      case 'invoices':
        return <InvoicesPage key={companyKey} />;
      case 'imports':
        return <ImportsPage key={companyKey} onNavigate={setActiveTab} />;
      case 'reconciliation':
        return <ReconciliationPage key={companyKey} />;
      case 'closing':
        return <ClosingPage key={companyKey} />;
      case 'audit':
        return <AuditPage key={companyKey} />;
      case 'reports':
        return <ReportsPage key={companyKey} />;
      case 'settings':
        return <SettingsPage key={companyKey} />;
      default:
        return <DashboardPage key={companyKey} />;
    }
  };

  return (
    <Layout activeTab={activeTab} onSelectTab={setActiveTab}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FinancerShell />
      <ToastContainer />
    </AuthProvider>
  );
}
