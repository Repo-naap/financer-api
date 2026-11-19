import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { apiRequest, buildQueryString } from '../lib/api';
import { IbgeMunicipality } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface MunicipalitySelectProps {
  value: number | '';
  selectedLabel?: string;
  onChange: (mun: IbgeMunicipality | null) => void;
}

export function MunicipalitySelect({ value, selectedLabel, onChange }: MunicipalitySelectProps) {
  const { notify } = useAuth();
  const [states, setStates] = useState<Array<{ uf: string; state_name: string }>>([]);
  const [uf, setUf] = useState<string>('ALL');
  const [query, setQuery] = useState<string>('');
  const [items, setItems] = useState<IbgeMunicipality[]>([]);
  const [totalInDb, setTotalInDb] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);

  useEffect(() => {
    apiRequest<{ states: Array<{ uf: string; state_name: string }> }>('/trips/states')
      .then((res) => setStates(res.states))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const qs = buildQueryString({ uf, q: query, limit: 150 });
      apiRequest<{ items: IbgeMunicipality[]; totalInDatabase: number }>(
        `/trips/municipalities${qs}`
      )
        .then((res) => {
          setItems(res.items);
          setTotalInDb(res.totalInDatabase);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [uf, query]);

  const handleSyncIbge = async () => {
    setSyncing(true);
    try {
      const res = await apiRequest<{ message: string; total: number }>(
        '/trips/municipalities/sync',
        { method: 'POST' }
      );
      setTotalInDb(res.total);
      notify(res.message, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao sincronizar base IBGE.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-financer-200 bg-financer-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-financer-900">
          Base Oficial IBGE ({totalInDb.toLocaleString('pt-BR')} municípios)
        </span>
        <button
          type="button"
          onClick={handleSyncIbge}
          disabled={syncing}
          className="inline-flex items-center gap-1 rounded-md border border-financer-200 bg-white px-2 py-1 text-[11px] font-semibold text-financer-700 hover:bg-financer-100 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Atualizando IBGE...' : 'Atualizar lista IBGE'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          className="input-field"
          value={uf}
          onChange={(e) => setUf(e.target.value)}
          aria-label="Filtrar por estado"
        >
          <option value="ALL">Todos os Estados (UF)</option>
          {states.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.uf} – {s.state_name}
            </option>
          ))}
        </select>

        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            className="input-field pl-9"
            placeholder="Pesquisar município pelo nome..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <select
        className="input-field"
        value={value}
        onChange={(e) => {
          const code = Number(e.target.value);
          const found = items.find((m) => m.ibge_code === code) || null;
          onChange(found);
        }}
        required
      >
        <option value="">
          {selectedLabel ? `Selecionado: ${selectedLabel}` : 'Selecione o município...'}
        </option>
        {items.map((m) => (
          <option key={m.ibge_code} value={m.ibge_code}>
            {m.uf} – {m.name} ({m.state_name})
          </option>
        ))}
      </select>
    </div>
  );
}
