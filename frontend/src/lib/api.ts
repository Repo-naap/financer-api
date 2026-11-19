const TOKEN_STORAGE_KEY = 'financer_auth_token';

export class ApiError extends Error {
  status: number;
  code?: string;
  isNetworkError: boolean;

  constructor(message: string, status = 0, code?: string, isNetworkError = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.isNetworkError = isNetworkError;
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

let onUnauthorizedCallback: (() => void) | null = null;
let onNetworkStatusChange: ((online: boolean) => void) | null = null;

export function registerApiCallbacks(opts: {
  onUnauthorized: () => void;
  onNetworkStatus: (online: boolean) => void;
}) {
  onUnauthorizedCallback = opts.onUnauthorized;
  onNetworkStatusChange = opts.onNetworkStatus;
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    onNetworkStatusChange?.(false);
    throw new ApiError(
      'Sem conexão com a internet. A operação não foi confirmada nem salva no servidor.',
      0,
      'OFFLINE',
      true
    );
  }

  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${endpoint}`, {
      ...options,
      headers,
    });
    onNetworkStatusChange?.(true);
  } catch {
    onNetworkStatusChange?.(false);
    throw new ApiError(
      'Falha de conexão com o servidor central do FINANCER. Os dados não foram confirmados — verifique sua conexão e tente novamente.',
      0,
      'NETWORK_ERROR',
      true
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    if (res.status === 401 && endpoint !== '/auth/login') {
      setStoredToken(null);
      onUnauthorizedCallback?.();
    }
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Erro HTTP ${res.status}`;
    const code =
      typeof data === 'object' && data && 'code' in data
        ? String((data as { code: unknown }).code)
        : undefined;
    throw new ApiError(msg, res.status, code, false);
  }

  return data as T;
}

export async function downloadAuthenticatedFile(endpoint: string, fallbackFilename: string): Promise<void> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${endpoint}`, { headers });
  } catch {
    throw new ApiError('Sem conexão com o servidor para exportar o documento.', 0, 'OFFLINE', true);
  }

  if (!res.ok) {
    let msg = 'Falha ao exportar relatório.';
    try {
      const errData = await res.json();
      if (errData?.error) msg = errData.error;
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }

  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const filename = match?.[1] || fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildQueryString(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      sp.set(k, String(v));
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}
