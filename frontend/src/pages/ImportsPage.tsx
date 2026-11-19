import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../lib/api';
import { formatBRL, formatDateBR } from '../lib/format';
import { AppModule } from '../types';
import { useAuth } from '../contexts/AuthContext';

type ImportTargetModule = 'expenses' | 'trips' | 'reminders' | 'cash' | 'invoices';

interface AnalyzedImportRow {
  rowIndex: number;
  sourceSheet: string;
  valid: boolean;
  warnings: string[];
  data: Record<string, unknown>;
}

interface AnalyzeImportResult {
  filename: string;
  fileType: 'xlsx' | 'csv' | 'pdf';
  detectedModule: ImportTargetModule;
  detectedModuleLabel: string;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA';
  detectionReason: string;
  sheetsAnalyzed: string[];
  totalRowsFound: number;
  validCount: number;
  invalidCount: number;
  estimatedTotalAmount: number;
  rows: AnalyzedImportRow[];
}

interface CommitImportResult {
  targetModule: ImportTargetModule;
  targetModuleLabel: string;
  importedCount: number;
  skippedDuplicates: number;
  skippedClosed: number;
  skippedInvalid: number;
  errors: string[];
}

interface QueuedFileItem {
  id: string;
  filename: string;
  contentBase64: string;
  sizeBytes: number;
  analyzing: boolean;
  importing: boolean;
  error?: string;
  analysis?: AnalyzeImportResult;
  commitResult?: CommitImportResult;
  showAllRows?: boolean;
}

const MODULE_OPTIONS: Array<{ value: ImportTargetModule; label: string }> = [
  { value: 'expenses', label: 'Despesas Mensais' },
  { value: 'trips', label: 'Viagens' },
  { value: 'reminders', label: 'Lembretes e Obrigações' },
  { value: 'cash', label: 'Caixa (Entradas e Saídas)' },
  { value: 'invoices', label: 'Conferência de Notas' },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Não foi possível ler o arquivo "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderPreviewColumns(mod: ImportTargetModule): Array<{
  label: string;
  align?: 'right' | 'center';
  render: (d: Record<string, unknown>) => React.ReactNode;
}> {
  if (mod === 'expenses') {
    return [
      { label: 'Data', render: (d) => formatDateBR(String(d.day || '')) },
      {
        label: 'Despesa / Categoria',
        render: (d) =>
          d.category === 'Outros' && d.custom_description
            ? `Outros – ${String(d.custom_description)}`
            : String(d.category || '-'),
      },
      { label: 'NF', render: (d) => String(d.invoice_number || '-') },
      { label: 'Valor Orig.', align: 'right', render: (d) => formatBRL(Number(d.original_amount || 0)) },
      { label: 'Desc. / Juros', align: 'right', render: (d) => `${formatBRL(Number(d.discount || 0))} / ${formatBRL(Number(d.interest || 0))}` },
      { label: 'Valor Final', align: 'right', render: (d) => <span className="font-semibold">{formatBRL(Number(d.final_amount || 0))}</span> },
      { label: 'Tipo', align: 'center', render: (d) => <span className="badge-purple">{String(d.expense_type || 'Empresa')}</span> },
    ];
  }

  if (mod === 'trips') {
    return [
      { label: 'Grupo', render: (d) => <span className="badge-purple">{String(d.trip_group || '-')}</span> },
      { label: 'Colaborador', render: (d) => String(d.collaborator || '-') },
      { label: 'Município/UF', render: (d) => `${String(d.municipality_name || '-')}${d.state_uf ? `/${String(d.state_uf)}` : ''}` },
      { label: 'Saída', render: (d) => formatDateBR(String(d.departure_date || '')) },
      { label: 'Val. Saída', align: 'right', render: (d) => formatBRL(Number(d.departure_amount || 0)) },
      { label: 'Devolução', align: 'right', render: (d) => formatBRL(Number(d.return_amount || 0)) },
      { label: 'Gasto / VPP', align: 'right', render: (d) => <span className="font-semibold">{formatBRL(Number(d.spent_amount || 0))} ({formatBRL(Number(d.vpp || 0))})</span> },
      { label: 'Pessoas', align: 'center', render: (d) => String(d.people_count || 1) },
    ];
  }

  if (mod === 'reminders') {
    return [
      { label: 'Descrição', render: (d) => String(d.description || '-') },
      { label: 'Conta', render: (d) => String(d.account || '-') },
      { label: 'Dígito', align: 'center', render: (d) => String(d.digit || '-') },
      { label: 'Vencimento', render: (d) => formatDateBR(String(d.due_date || '')) },
      {
        label: 'Comp.',
        align: 'center',
        render: (d) =>
          `${String(d.competence_month || '').padStart(2, '0')}/${String(d.competence_year || '')}`,
      },
      { label: 'Valor', align: 'right', render: (d) => <span className="font-semibold">{formatBRL(Number(d.amount || 0))}</span> },
      {
        label: 'Situação',
        align: 'center',
        render: (d) => (
          <span className={d.status === 'PAGA' ? 'badge-green' : 'badge-amber'}>
            {String(d.status || 'PENDENTE')}
          </span>
        ),
      },
    ];
  }

  if (mod === 'cash') {
    return [
      { label: 'Data', render: (d) => formatDateBR(String(d.entry_date || '')) },
      { label: 'Destino', render: (d) => String(d.destination || '-') },
      { label: 'Finalidade', render: (d) => String(d.purpose || '-') },
      {
        label: 'Entrada',
        align: 'right',
        render: (d) =>
          Number(d.inflow || 0) > 0 ? (
            <span className="font-semibold text-emerald-700">{formatBRL(Number(d.inflow))}</span>
          ) : (
            '-'
          ),
      },
      {
        label: 'Saída',
        align: 'right',
        render: (d) =>
          Number(d.outflow || 0) > 0 ? (
            <span className="font-semibold text-rose-700">{formatBRL(Number(d.outflow))}</span>
          ) : (
            '-'
          ),
      },
    ];
  }

  // invoices (Conferência de Notas)
  return [
    { label: 'Nº Nota', render: (d) => <span className="font-mono font-semibold">{String(d.invoice_number || '-')}</span> },
    { label: 'Grupo', align: 'center', render: (d) => <span className="badge-purple">{String(d.invoice_group || 'SEM_GRUPO')}</span> },
    { label: 'Cidade', render: (d) => String(d.city_name || '-') },
    { label: 'Fundo / Órgão', render: (d) => String(d.fund_name || '-') },
    {
      label: 'Mês / Ref.',
      align: 'center',
      render: (d) => {
        const slot = String(d.competence_slot || 'MES');
        const mo = String(d.competence_month || '').padStart(2, '0');
        const yr = String(d.competence_year || '');
        return slot !== 'MES' ? `${slot}/${yr}` : `${mo}/${yr}`;
      },
    },
    { label: 'Valor', align: 'right', render: (d) => <span className="font-semibold">{formatBRL(Number(d.amount || 0))}</span> },
    {
      label: 'Situação',
      align: 'center',
      render: (d) => (
        <span
          className={
            d.status === 'PG'
              ? 'badge-green'
              : d.status === 'CANCELADA'
              ? 'badge-red'
              : 'badge-amber'
          }
        >
          {String(d.status || 'EMITIDA')}
        </span>
      ),
    },
    { label: 'Recebimento', render: (d) => (d.received_date ? formatDateBR(String(d.received_date)) : '-') },
  ];
}

interface ImportsPageProps {
  onNavigate?: (tab: AppModule) => void;
}

export function ImportsPage({ onNavigate }: ImportsPageProps) {
  const { company, can, notify } = useAuth();
  const canCreate = can('imports', 'create');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [referenceYear, setReferenceYear] = useState<number>(new Date().getFullYear());
  const [defaultOverride, setDefaultOverride] = useState<'' | ImportTargetModule>('');
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueuedFileItem[]>([]);
  const [importingAll, setImportingAll] = useState(false);

  const analyzeItem = async (
    id: string,
    filename: string,
    contentBase64: string,
    overrideModule?: ImportTargetModule,
    yearOverride?: number
  ) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, analyzing: true, error: undefined, commitResult: undefined }
          : item
      )
    );

    try {
      const result = await apiRequest<AnalyzeImportResult>('/imports/analyze', {
        method: 'POST',
        body: JSON.stringify({
          filename,
          contentBase64,
          overrideModule: overrideModule || undefined,
          referenceYear: yearOverride || referenceYear,
        }),
      });
      setQueue((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, analyzing: false, analysis: result, error: undefined } : item
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao analisar arquivo.';
      setQueue((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, analyzing: false, error: msg } : item
        )
      );
      notify(`${filename}: ${msg}`, 'error');
    }
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    const newItems: QueuedFileItem[] = [];
    for (const file of files) {
      try {
        const contentBase64 = await fileToBase64(file);
        newItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          filename: file.name,
          contentBase64,
          sizeBytes: file.size,
          analyzing: true,
          importing: false,
        });
      } catch (err) {
        notify(err instanceof Error ? err.message : `Erro ao ler ${file.name}`, 'error');
      }
    }

    if (newItems.length === 0) return;
    setQueue((prev) => [...newItems, ...prev]);

    for (const item of newItems) {
      await analyzeItem(
        item.id,
        item.filename,
        item.contentBase64,
        defaultOverride || undefined,
        referenceYear
      );
    }
  };

  const handleCommitItem = async (item: QueuedFileItem) => {
    if (!item.analysis) return;
    const validRows = item.analysis.rows.filter((r) => r.valid).map((r) => r.data);
    if (validRows.length === 0) {
      notify('Não há registros válidos para importar neste arquivo.', 'error');
      return;
    }

    setQueue((prev) =>
      prev.map((q) => (q.id === item.id ? { ...q, importing: true, error: undefined } : q))
    );

    try {
      const res = await apiRequest<CommitImportResult>('/imports/commit', {
        method: 'POST',
        body: JSON.stringify({
          targetModule: item.analysis.detectedModule,
          filename: item.filename,
          rows: validRows,
        }),
      });
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, importing: false, commitResult: res } : q
        )
      );
      notify(
        `${item.filename}: ${res.importedCount} registro(s) importado(s) em ${res.targetModuleLabel}!`,
        'success'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gravar dados importados.';
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, importing: false, error: msg } : q))
      );
      notify(msg, 'error');
    }
  };

  const handleCommitAll = async () => {
    const readyItems = queue.filter(
      (item) => item.analysis && item.analysis.validCount > 0 && !item.commitResult && !item.importing && !item.analyzing
    );
    if (readyItems.length === 0) return;
    setImportingAll(true);
    try {
      for (const item of readyItems) {
        await handleCommitItem(item);
      }
    } finally {
      setImportingAll(false);
    }
  };

  const handleDownloadTemplate = async (mod: ImportTargetModule) => {
    try {
      await downloadAuthenticatedFile(`/imports/template/${mod}`, `FINANCER-modelo-${mod}.xlsx`);
      notify('Planilha modelo baixada com sucesso.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao baixar modelo.', 'error');
    }
  };

  const readyToImportCount = queue.filter(
    (q) => q.analysis && q.analysis.validCount > 0 && !q.commitResult && !q.analyzing
  ).length;

  return (
    <div className="space-y-6">
      {/* Cabeçalho explicativo */}
      <div className="card border-financer-200 bg-gradient-to-r from-financer-950 via-financer-900 to-financer-800 p-5 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-300" />
              <h3 className="text-lg font-bold">
                Importação Inteligente de Dados Antigos ({company?.name})
              </h3>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-financer-100 sm:text-sm">
              Envie planilhas <strong>Excel (.xlsx / .csv)</strong> ou relatórios <strong>PDF (.pdf)</strong> antigos.
              O FINANCER identifica automaticamente a qual aba cada arquivo pertence (Despesas, Viagens, Lembretes, Caixa
              ou Conferência de Notas — inclusive planilhas anuais por cidade JAN..DEZ), mostra uma prévia completa e importa
              tudo no local correto da empresa <strong>{company?.name}</strong> sem duplicar lançamentos.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {readyToImportCount > 1 && canCreate && (
              <button
                type="button"
                disabled={importingAll}
                onClick={handleCommitAll}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-emerald-600 disabled:opacity-50"
              >
                {importingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar Todos ({readyToImportCount} arquivos)
              </button>
            )}
            {queue.length > 0 && (
              <button
                type="button"
                onClick={() => setQueue([])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpar Fila
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Painel de Configuração + Zona de Upload */}
      <div className="card p-5">
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label-field">Ano de Referência (padrão)</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={referenceYear}
              onChange={(e) => setReferenceYear(Number(e.target.value) || new Date().getFullYear())}
              className="input-field"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Usado quando a planilha antiga tiver datas sem ano (ex: 3013/27.02).
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="label-field">Modo de Identificação</label>
            <select
              value={defaultOverride}
              onChange={(e) => setDefaultOverride(e.target.value as '' | ImportTargetModule)}
              className="input-field"
            >
              <option value="">Detectar Automaticamente (Recomendado — identifica cada planilha sozinho)</option>
              {MODULE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  Forçar destino: {m.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Você também pode ajustar o destino individualmente em cada arquivo após a leitura.
            </p>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFilesSelected(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging
              ? 'border-financer-600 bg-financer-50'
              : 'border-financer-200 bg-slate-50/70 hover:border-financer-400 hover:bg-financer-50/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.csv,.pdf"
            className="hidden"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-financer-100 text-financer-700">
            <Upload className="h-7 w-7" />
          </div>
          <p className="mt-3 text-sm font-bold text-financer-950">
            Arraste suas planilhas ou PDFs aqui, ou clique para selecionar
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Aceita múltiplos arquivos ao mesmo tempo · Formatos suportados: <strong>.xlsx</strong> (Excel),{' '}
            <strong>.csv</strong> e <strong>.pdf</strong>
          </p>
          <span className="btn-primary mt-4 pointer-events-none text-xs">
            <Upload className="h-4 w-4" />
            Selecionar Arquivos do Computador
          </span>
        </div>
      </div>

      {/* Fila de Arquivos Analisados */}
      {queue.map((item) => {
        const analysis = item.analysis;
        const columns = analysis ? renderPreviewColumns(analysis.detectedModule) : [];
        const visibleRows = analysis
          ? item.showAllRows
            ? analysis.rows
            : analysis.rows.slice(0, 50)
          : [];

        return (
          <div key={item.id} className="card overflow-hidden">
            {/* Topo do card do arquivo */}
            <div className="flex flex-col gap-3 border-b border-financer-100 bg-financer-50/40 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    item.filename.toLowerCase().endsWith('.pdf')
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {item.filename.toLowerCase().endsWith('.pdf') ? (
                    <FileText className="h-5 w-5" />
                  ) : (
                    <FileSpreadsheet className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-bold text-slate-900">{item.filename}</h4>
                    <span className="badge-slate">{formatBytes(item.sizeBytes)}</span>
                    {analysis && (
                      <>
                        <span className="badge-purple font-bold">
                          Destino: {analysis.detectedModuleLabel}
                        </span>
                        <span
                          className={
                            analysis.confidence === 'ALTA'
                              ? 'badge-green'
                              : analysis.confidence === 'MEDIA'
                              ? 'badge-amber'
                              : 'badge-red'
                          }
                        >
                          Confiança {analysis.confidence}
                        </span>
                      </>
                    )}
                  </div>
                  {analysis && (
                    <p className="mt-1 text-xs text-slate-600">
                      {analysis.detectionReason} · Abas analisadas: <strong>{analysis.sheetsAnalyzed.join(', ')}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {analysis && !item.commitResult && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] font-semibold text-slate-600">Alterar destino:</label>
                    <select
                      disabled={item.analyzing || item.importing}
                      value={analysis.detectedModule}
                      onChange={(e) =>
                        analyzeItem(
                          item.id,
                          item.filename,
                          item.contentBase64,
                          e.target.value as ImportTargetModule,
                          referenceYear
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800"
                    >
                      {MODULE_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      title="Reanalisar com ano de referência atual"
                      disabled={item.analyzing || item.importing}
                      onClick={() =>
                        analyzeItem(
                          item.id,
                          item.filename,
                          item.contentBase64,
                          analysis.detectedModule,
                          referenceYear
                        )
                      }
                      className="btn-ghost px-2 py-1.5 text-xs"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${item.analyzing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                  className="btn-ghost text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Remover
                </button>
              </div>
            </div>

            {/* Corpo do Card */}
            <div className="p-5">
              {item.analyzing && (
                <div className="flex items-center justify-center gap-3 py-8 text-sm font-medium text-financer-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Lendo arquivo e identificando automaticamente o módulo e colunas...
                </div>
              )}

              {item.error && !item.analyzing && (
                <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                  <div>
                    <p className="font-bold">Não foi possível processar este arquivo</p>
                    <p className="mt-0.5 text-xs">{item.error}</p>
                  </div>
                </div>
              )}

              {/* Resultado após importação confirmada */}
              {item.commitResult && (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                      <div>
                        <h5 className="text-sm font-bold text-emerald-900">
                          Importação concluída em {item.commitResult.targetModuleLabel} ({company?.name})!
                        </h5>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-emerald-800">
                          <span>
                            <strong>{item.commitResult.importedCount}</strong> importado(s)
                          </span>
                          <span>
                            <strong>{item.commitResult.skippedDuplicates}</strong> duplicado(s) ignorado(s)
                          </span>
                          {item.commitResult.skippedClosed > 0 && (
                            <span className="text-amber-700">
                              <strong>{item.commitResult.skippedClosed}</strong> em período fechado (bloqueado)
                            </span>
                          )}
                          {item.commitResult.skippedInvalid > 0 && (
                            <span className="text-rose-700">
                              <strong>{item.commitResult.skippedInvalid}</strong> inválido(s) ignorado(s)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(item.commitResult!.targetModule)}
                        className="btn-primary shrink-0 text-xs"
                      >
                        Abrir {item.commitResult.targetModuleLabel}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {analysis && !item.analyzing && (
                <>
                  {/* Resumo Numérico */}
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">Linhas Lidas</p>
                      <p className="mt-0.5 text-lg font-extrabold text-slate-900">{analysis.totalRowsFound}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                      <p className="text-[11px] font-semibold uppercase text-emerald-700">Válidas p/ Importar</p>
                      <p className="mt-0.5 text-lg font-extrabold text-emerald-800">{analysis.validCount}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
                      <p className="text-[11px] font-semibold uppercase text-amber-700">Com Alerta / Ignoradas</p>
                      <p className="mt-0.5 text-lg font-extrabold text-amber-800">{analysis.invalidCount}</p>
                    </div>
                    <div className="rounded-xl border border-financer-200 bg-financer-50/70 px-3.5 py-2.5">
                      <p className="text-[11px] font-semibold uppercase text-financer-700">Valor Total Estimado</p>
                      <p className="mt-0.5 text-lg font-extrabold text-financer-900">
                        {formatBRL(analysis.estimatedTotalAmount)}
                      </p>
                    </div>
                  </div>

                  {/* Tabela de Prévia */}
                  {analysis.rows.length === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      <div className="flex items-center gap-2 font-bold">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Nenhum registro financeiro reconhecido neste arquivo.
                      </div>
                      <p className="mt-1">
                        Verifique se o módulo selecionado acima ({analysis.detectedModuleLabel}) corresponde às colunas da
                        planilha, ou baixe uma das planilhas modelo no final desta página.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-financer-900 text-white">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Linha</th>
                            <th className="px-3 py-2 text-center font-semibold">Status</th>
                            {columns.map((col, ci) => (
                              <th
                                key={ci}
                                className={`px-3 py-2 font-semibold ${
                                  col.align === 'right'
                                    ? 'text-right'
                                    : col.align === 'center'
                                    ? 'text-center'
                                    : 'text-left'
                                }`}
                              >
                                {col.label}
                              </th>
                            ))}
                            <th className="px-3 py-2 text-left font-semibold">Observações / Alertas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {visibleRows.map((row, idx) => (
                            <tr
                              key={`${row.sourceSheet}-${row.rowIndex}-${idx}`}
                              className={row.valid ? 'hover:bg-financer-50/30' : 'bg-rose-50/50'}
                            >
                              <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                                {row.sourceSheet !== item.filename ? `${row.sourceSheet} #${row.rowIndex}` : `#${row.rowIndex}`}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-center">
                                {row.valid ? (
                                  <span className="badge-green">OK</span>
                                ) : (
                                  <span className="badge-red">Inválida</span>
                                )}
                              </td>
                              {columns.map((col, ci) => (
                                <td
                                  key={ci}
                                  className={`whitespace-nowrap px-3 py-2 text-slate-800 ${
                                    col.align === 'right'
                                      ? 'text-right'
                                      : col.align === 'center'
                                      ? 'text-center'
                                      : 'text-left'
                                  }`}
                                >
                                  {col.render(row.data)}
                                </td>
                              ))}
                              <td className="px-3 py-2 text-[11px] text-amber-700">
                                {row.warnings.length > 0 ? row.warnings.join('; ') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {analysis.rows.length > 50 && (
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Exibindo {visibleRows.length} de {analysis.rows.length} linhas.
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setQueue((prev) =>
                            prev.map((q) =>
                              q.id === item.id ? { ...q, showAllRows: !q.showAllRows } : q
                            )
                          )
                        }
                        className="font-semibold text-financer-700 hover:underline"
                      >
                        {item.showAllRows ? 'Mostrar apenas 50 linhas' : `Ver todas as ${analysis.rows.length} linhas`}
                      </button>
                    </div>
                  )}

                  {/* Barra de confirmação */}
                  {!item.commitResult && (
                    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-slate-500">
                        Os registros válidos serão gravados exclusivamente na empresa ativa{' '}
                        <strong className="text-financer-900">{company?.name}</strong> e registrados na Auditoria.
                      </p>
                      {canCreate ? (
                        <button
                          type="button"
                          disabled={item.importing || analysis.validCount === 0}
                          onClick={() => handleCommitItem(item)}
                          className="btn-primary shrink-0"
                        >
                          {item.importing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Importando...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              Confirmar e Importar {analysis.validCount} Registro(s) em {analysis.detectedModuleLabel}
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="badge-amber">Sem permissão de inclusão para importar</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Planilhas Modelo para Download */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-financer-950">Planilhas Modelo (.xlsx) Opcionais</h4>
            <p className="text-xs text-slate-500">
              Você pode subir suas planilhas antigas diretamente (inclusive o modelo anual de Conferência de Notas com JAN..DEZ),
              ou baixar um modelo limpo abaixo caso deseje organizar novos lotes:
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {MODULE_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => handleDownloadTemplate(m.value)}
              className="btn-secondary justify-start text-xs"
            >
              <Download className="h-4 w-4 shrink-0 text-financer-600" />
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
