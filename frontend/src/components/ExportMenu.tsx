import { useState } from 'react';
import { FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { downloadAuthenticatedFile } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ExportMenuProps {
  baseEndpoint: string;
  queryString?: string;
  formats?: Array<'pdf' | 'xlsx' | 'docx'>;
  filenamePrefix: string;
}

export function ExportMenu({
  baseEndpoint,
  queryString = '',
  formats = ['pdf', 'xlsx', 'docx'],
  filenamePrefix,
}: ExportMenuProps) {
  const { notify } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const handleExport = async (fmt: 'pdf' | 'xlsx' | 'docx') => {
    setBusy(fmt);
    try {
      const sep = queryString.includes('?') ? '&' : '?';
      await downloadAuthenticatedFile(
        `${baseEndpoint}${queryString}${sep}format=${fmt}`,
        `${filenamePrefix}.${fmt}`
      );
      notify(`Relatório exportado em ${fmt.toUpperCase()} com sucesso.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao exportar relatório.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {formats.includes('pdf') && (
        <button
          type="button"
          onClick={() => handleExport('pdf')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" />
          {busy === 'pdf' ? 'Gerando...' : 'PDF'}
        </button>
      )}
      {formats.includes('xlsx') && (
        <button
          type="button"
          onClick={() => handleExport('xlsx')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          {busy === 'xlsx' ? 'Gerando...' : 'Excel (.xlsx)'}
        </button>
      )}
      {formats.includes('docx') && (
        <button
          type="button"
          onClick={() => handleExport('docx')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-financer-200 bg-financer-50 px-3 py-1.5 text-xs font-semibold text-financer-700 transition hover:bg-financer-100 disabled:opacity-50"
        >
          <FileType className="h-3.5 w-3.5" />
          {busy === 'docx' ? 'Gerando...' : 'Word (.docx)'}
        </button>
      )}
    </div>
  );
}
