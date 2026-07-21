/**
 * Enterprise RBAC catalogue. Pure data/logic, no Node-only or React imports —
 * this file must stay importable from Edge middleware as well as server
 * components/actions.
 */

export const ROLES = [
  'super_admin',
  'company_admin',
  'hr',
  'qa',
  'developer',
  'designer',
  'marketing',
  'finance',
  'employee',
  'guest',
] as const;

export type Role = typeof ROLES[number];

/**
 * Workspace-level "can enter this app at all" permissions, plus a few
 * finer-grained example permissions (employee/payroll/etc) actually
 * consumed by HR server actions.
 */
export const PERMISSIONS = [
  'workspace:enterprise',
  'workspace:hr',
  'workspace:qa',
  'workspace:app_factory',
  'workspace:designer',
  'workspace:marketing',
  'workspace:finance',

  'employee.read',
  'employee.create',
  'employee.update',
  'employee.delete',
  'recruitment.manage',
  'attendance.manage',
  'payroll.view',
  'payroll.manage',
] as const;

export type Permission = typeof PERMISSIONS[number];

const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

/** Each role's permission set. Super Admin gets a '*' wildcard checked specially in hasPermission. */
export const ROLE_PERMISSIONS: Record<Role, Permission[] | '*'> = {
  super_admin: '*',
  company_admin: [
    'workspace:enterprise', 'workspace:hr', 'workspace:qa', 'workspace:app_factory',
    'workspace:designer', 'workspace:marketing', 'workspace:finance',
    'employee.read', 'employee.create', 'employee.update', 'employee.delete',
    'recruitment.manage', 'attendance.manage', 'payroll.view', 'payroll.manage',
  ],
  hr: [
    'workspace:hr', 'employee.read', 'employee.create', 'employee.update', 'employee.delete',
    'recruitment.manage', 'attendance.manage', 'payroll.view',
  ],
  qa: ['workspace:qa'],
  developer: ['workspace:app_factory'],
  designer: ['workspace:designer'],
  marketing: ['workspace:marketing'],
  finance: ['workspace:finance', 'payroll.view', 'payroll.manage'],
  employee: [],
  guest: [],
};

export function permissionsForRole(role: string): Permission[] {
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return [];
  return perms === '*' ? ALL_PERMISSIONS : perms;
}

export function hasPermission(rolePerms: string[], required: string): boolean {
  return rolePerms.includes('*') || rolePerms.includes(required);
}

/** Where each role lands immediately after login / when hitting a bare "/". */
export const ROLE_HOME: Record<Role, string> = {
  super_admin: '/dashboard',
  company_admin: '/dashboard',
  hr: '/hr',
  qa: '/qa',
  developer: '/app-factory',
  designer: '/designer',
  marketing: '/marketing',
  finance: '/finance',
  employee: '/profile',
  guest: '/profile',
};

export function roleHome(role: string): string {
  return ROLE_HOME[role as Role] ?? '/profile';
}

/** Route prefix -> permission required to enter it. Checked by middleware and workspace layouts. */
export const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: Permission }> = [
  { prefix: '/dashboard', permission: 'workspace:enterprise' },
  { prefix: '/hr', permission: 'workspace:hr' },
  { prefix: '/qa', permission: 'workspace:qa' },
  { prefix: '/app-factory', permission: 'workspace:app_factory' },
  { prefix: '/designer', permission: 'workspace:designer' },
  { prefix: '/uiux-editor', permission: 'workspace:designer' },
  { prefix: '/marketing', permission: 'workspace:marketing' },
  { prefix: '/finance', permission: 'workspace:finance' },
];

export function permissionForPath(pathname: string): Permission | null {
  const match = ROUTE_PERMISSIONS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return match?.permission ?? null;
}
