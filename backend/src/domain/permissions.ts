export const MODULES = [
  'dashboard',
  'expenses',
  'trips',
  'reminders',
  'cash',
  'invoices',
  'imports',
  'reconciliation',
  'closing',
  'audit',
  'reports',
  'settings',
] as const;

export type AppModule = (typeof MODULES)[number];

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'close_period',
  'reopen_period',
] as const;

export type PermissionAction = (typeof ACTIONS)[number];

export type UserRole = 'ADMINISTRADOR' | 'FINANCEIRO' | 'CONSULTA' | 'PERSONALIZADO';

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionsMatrix = Record<AppModule, ModulePermissions>;

function makeActions(overrides: Partial<ModulePermissions> = {}): ModulePermissions {
  return {
    view: false,
    create: false,
    edit: false,
    delete: false,
    export: false,
    close_period: false,
    reopen_period: false,
    ...overrides,
  };
}

export function getDefaultPermissionsForRole(role: UserRole): PermissionsMatrix {
  if (role === 'ADMINISTRADOR') {
    const all = makeActions({
      view: true,
      create: true,
      edit: true,
      delete: true,
      export: true,
      close_period: true,
      reopen_period: true,
    });
    return {
      dashboard: { ...all },
      expenses: { ...all },
      trips: { ...all },
      reminders: { ...all },
      cash: { ...all },
      invoices: { ...all },
      imports: { ...all },
      reconciliation: { ...all },
      closing: { ...all },
      audit: makeActions({ view: true, export: true }),
      reports: makeActions({ view: true, export: true }),
      settings: { ...all },
    };
  }

  if (role === 'FINANCEIRO') {
    const finOps = makeActions({
      view: true,
      create: true,
      edit: true,
      delete: true,
      export: true,
    });
    return {
      dashboard: makeActions({ view: true }),
      expenses: { ...finOps },
      trips: { ...finOps },
      reminders: { ...finOps },
      cash: { ...finOps },
      invoices: { ...finOps },
      imports: makeActions({ view: true, create: true }),
      reconciliation: makeActions({ view: true, create: true, edit: true, export: true }),
      closing: makeActions({ view: true, close_period: true, export: true }),
      audit: makeActions({ view: false }),
      reports: makeActions({ view: true, export: true }),
      settings: makeActions({ view: false }),
    };
  }

  if (role === 'CONSULTA') {
    const readOnly = makeActions({ view: true, export: true });
    return {
      dashboard: makeActions({ view: true }),
      expenses: { ...readOnly },
      trips: { ...readOnly },
      reminders: { ...readOnly },
      cash: { ...readOnly },
      invoices: { ...readOnly },
      imports: makeActions({ view: false }),
      reconciliation: { ...readOnly },
      closing: { ...readOnly },
      audit: makeActions({ view: false }),
      reports: { ...readOnly },
      settings: makeActions({ view: false }),
    };
  }

  // PERSONALIZADO inicia com visualização apenas no Dashboard até o administrador configurar
  const none = makeActions();
  return {
    dashboard: makeActions({ view: true }),
    expenses: { ...none },
    trips: { ...none },
    reminders: { ...none },
    cash: { ...none },
    invoices: { ...none },
    imports: { ...none },
    reconciliation: { ...none },
    closing: { ...none },
    audit: { ...none },
    reports: { ...none },
    settings: { ...none },
  };
}

export function normalizePermissions(
  role: UserRole,
  custom?: Partial<Record<AppModule, Partial<ModulePermissions>>> | null
): PermissionsMatrix {
  if (role !== 'PERSONALIZADO') {
    return getDefaultPermissionsForRole(role);
  }
  const base = getDefaultPermissionsForRole('PERSONALIZADO');
  if (!custom) return base;
  for (const mod of MODULES) {
    if (custom[mod]) {
      base[mod] = makeActions({ ...base[mod], ...custom[mod] });
    }
  }
  // Auditoria nunca pode ser editada ou excluída
  base.audit.create = false;
  base.audit.edit = false;
  base.audit.delete = false;
  return base;
}

export function hasPermission(
  user: { role: UserRole; permissions: PermissionsMatrix },
  module: AppModule,
  action: PermissionAction
): boolean {
  // Reabertura de períodos fechados é exclusiva do ADMINISTRADOR (Seção 8.3)
  if (action === 'reopen_period' && user.role !== 'ADMINISTRADOR') {
    return false;
  }
  if (user.role === 'ADMINISTRADOR') {
    if (module === 'audit' && (action === 'delete' || action === 'edit')) return false;
    return true;
  }
  return Boolean(user.permissions?.[module]?.[action]);
}
