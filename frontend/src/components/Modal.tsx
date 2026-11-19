import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  children: React.ReactNode;
}

const widthMap = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  '2xl': 'max-w-6xl',
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 'lg',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-financer-950/50 p-4 backdrop-blur-xs">
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-financer-200 bg-white shadow-2xl ${widthMap[maxWidth]}`}
      >
        <div className="flex items-start justify-between border-b border-financer-100 bg-gradient-to-r from-financer-800 to-financer-700 px-6 py-4 text-white">
          <div>
            <h3 className="text-lg font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-financer-100">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-financer-100 transition hover:bg-white/15 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
