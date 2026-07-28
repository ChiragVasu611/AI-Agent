/**
 * AI Issue Boards — shared vocabulary.
 *
 * Pure data, importable from server actions, API routes and client components
 * alike (no Node-only or React imports).
 */

/** The six Kanban columns, in workflow order. */
export const ISSUE_STATUSES = [
  'new',
  'assigned',
  'in_progress',
  'ready_for_qa',
  'reopened',
  'closed',
] as const;

export type IssueStatus = typeof ISSUE_STATUSES[number];

export interface IssueColumn {
  key: IssueStatus;
  label: string;
  emoji: string;
  /** Tailwind classes for the column accent + card badge. */
  accent: string;
  badge: string;
}

export const ISSUE_COLUMNS: IssueColumn[] = [
  { key: 'new', label: 'New', emoji: '🆕', accent: 'bg-sky-500', badge: 'bg-sky-500/15 text-sky-500' },
  { key: 'assigned', label: 'Assigned', emoji: '👤', accent: 'bg-violet-500', badge: 'bg-violet-500/15 text-violet-500' },
  { key: 'in_progress', label: 'In Progress', emoji: '🔨', accent: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-500' },
  { key: 'ready_for_qa', label: 'Ready for QA', emoji: '🧪', accent: 'bg-cyan-500', badge: 'bg-cyan-500/15 text-cyan-500' },
  { key: 'reopened', label: 'Reopened', emoji: '🔄', accent: 'bg-rose-500', badge: 'bg-rose-500/15 text-rose-500' },
  { key: 'closed', label: 'Closed', emoji: '✅', accent: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-500' },
];

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  ready_for_qa: 'Ready for QA',
  reopened: 'Reopened',
  closed: 'Closed',
};

/** Board-level rollup status, derived from its cards — never set by hand. */
export const BOARD_STATUSES = ['open', 'in_progress', 'ready_for_qa', 'resolved'] as const;
export type BoardStatus = typeof BOARD_STATUSES[number];

export const BOARD_STATUS_LABEL: Record<BoardStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  ready_for_qa: 'Ready for QA',
  resolved: 'Resolved',
};

export const BOARD_STATUS_BADGE: Record<BoardStatus, string> = {
  open: 'bg-sky-500/15 text-sky-500',
  in_progress: 'bg-amber-500/15 text-amber-500',
  ready_for_qa: 'bg-cyan-500/15 text-cyan-500',
  resolved: 'bg-emerald-500/15 text-emerald-500',
};

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type IssueSeverity = typeof SEVERITIES[number];

export const PRIORITIES = ['p1', 'p2', 'p3', 'p4'] as const;
export type IssuePriority = typeof PRIORITIES[number];

export const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-orange-500/15 text-orange-500',
  medium: 'bg-amber-500/15 text-amber-500',
  low: 'bg-secondary text-muted-foreground',
};

export const PRIORITY_BADGE: Record<string, string> = {
  p1: 'bg-destructive/15 text-destructive',
  p2: 'bg-orange-500/15 text-orange-500',
  p3: 'bg-amber-500/15 text-amber-500',
  p4: 'bg-secondary text-muted-foreground',
};

export const PRIORITY_LABEL: Record<string, string> = {
  p1: 'P1 — Blocker',
  p2: 'P2 — High',
  p3: 'P3 — Medium',
  p4: 'P4 — Low',
};

/**
 * Issue categories the analyser can raise. Mirrors QaBugType and adds `ux`
 * and `ai_detected`, which have no equivalent in the bug schema but are
 * derived by the board analyser.
 */
export const ISSUE_CATEGORIES = [
  'functional', 'ui', 'ux', 'api', 'security', 'performance', 'memory', 'battery',
  'network', 'accessibility', 'compatibility', 'crash', 'anr', 'ai_detected',
] as const;

export type IssueCategory = typeof ISSUE_CATEGORIES[number];

export const CATEGORY_LABEL: Record<string, string> = {
  functional: 'Functional',
  ui: 'UI',
  ux: 'UX',
  api: 'API',
  security: 'Security',
  performance: 'Performance',
  memory: 'Memory',
  battery: 'Battery',
  network: 'Network',
  accessibility: 'Accessibility',
  compatibility: 'Compatibility',
  crash: 'Crash',
  anr: 'ANR',
  ai_detected: 'AI Detected',
};

/** Module type of the execution that produced a board. */
export const MODULE_TYPE_LABEL: Record<string, string> = {
  catalog: 'Test Execution',
  uploaded: 'AI Test Case Execution',
};

export type IssueActivityType =
  | 'created' | 'assigned' | 'unassigned' | 'status_changed' | 'priority_changed'
  | 'severity_changed' | 'label_changed' | 'due_date_changed' | 'comment'
  | 'attachment_added' | 'qa_retested' | 'reopened' | 'closed';

/** Statuses that count as "still needs developer work". */
export const OPEN_STATUSES: IssueStatus[] = ['new', 'assigned', 'in_progress', 'reopened'];

export function isTerminal(status: IssueStatus): boolean {
  return status === 'closed';
}

/** Zero-padded execution label used in board names: 125 -> "125", 84 -> "084". */
export function executionLabel(runNumber: number): string {
  return String(runNumber).padStart(3, '0');
}

/** "<Project> - <Application> - Execution #<id>" */
export function buildBoardName(projectName: string, applicationName: string, runNumber: number): string {
  return `${projectName} - ${applicationName} - Execution #${executionLabel(runNumber)}`;
}
