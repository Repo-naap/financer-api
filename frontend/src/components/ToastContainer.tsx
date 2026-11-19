import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function ToastContainer() {
  const { toasts, dismissToast } = useAuth();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-md flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            t.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : t.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-financer-200 bg-financer-50 text-financer-900'
          }`}
        >
          {t.type === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
          {t.type === 'error' && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
          {t.type === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-financer-700" />}
          <span className="flex-1 font-medium">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="rounded p-0.5 opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
