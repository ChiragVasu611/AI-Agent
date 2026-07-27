import type { AuditFinding } from './audit-engine';

export interface TaskDraft {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'quick_win' | 'long_term' | 'technical' | 'content' | 'aso';
  estimatedTime: string;
  estimatedImpact: string;
  planHorizon: 'weekly' | '30_day' | '90_day';
  sourceFindingRef: string;
}

const SEVERITY_ORDER: Record<AuditFinding['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1 };

const QUICK_FIX_ITEMS = new Set(['Title tag', 'Meta description', 'Canonical tag', 'HTML lang attribute', 'App name', 'Short description', 'Category', 'Release notes']);

function estimateTime(f: AuditFinding): string {
  if (QUICK_FIX_ITEMS.has(f.item)) return '15-30 min';
  if (f.severity === 'critical' || f.severity === 'high') return '2-4 hours';
  return '1-2 hours';
}

function estimateImpact(f: AuditFinding): string {
  if (f.severity === 'critical') return 'High — directly blocks discoverability or ranking';
  if (f.severity === 'high') return 'High — meaningfully affects visibility or conversion';
  if (f.severity === 'medium') return 'Medium — incremental ranking/UX improvement';
  return 'Low — minor polish';
}

function planHorizonFor(f: AuditFinding): 'weekly' | '30_day' | '90_day' {
  if (f.severity === 'critical' || f.severity === 'high') return 'weekly';
  if (f.severity === 'medium') return '30_day';
  return '90_day';
}

function categoryFor(f: AuditFinding, isAso: boolean): TaskDraft['category'] {
  if (isAso) return 'aso';
  if (QUICK_FIX_ITEMS.has(f.item)) return 'quick_win';
  if (f.category === 'Content' || f.category === 'Content Structure') return 'content';
  if (f.severity === 'low') return 'long_term';
  return 'technical';
}

export function buildTasksFromFindings(findings: AuditFinding[], isAso: boolean): TaskDraft[] {
  const actionable = findings.filter((f) => f.status !== 'pass');
  const sorted = [...actionable].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return sorted.map((f) => ({
    title: `Fix: ${f.item}`,
    description: `${f.detail}${f.recommendation ? ` — ${f.recommendation}` : ''}`,
    priority: f.severity,
    category: categoryFor(f, isAso),
    estimatedTime: estimateTime(f),
    estimatedImpact: estimateImpact(f),
    planHorizon: planHorizonFor(f),
    sourceFindingRef: `${f.category}:${f.item}`,
  }));
}

export interface GrowthPlanSummary {
  topPriorityTasks: TaskDraft[];
  quickWins: TaskDraft[];
  longTermImprovements: TaskDraft[];
  weeklyActionPlan: TaskDraft[];
  thirtyDayPlan: TaskDraft[];
  ninetyDayPlan: TaskDraft[];
}

export function summarizeGrowthPlan(tasks: TaskDraft[]): GrowthPlanSummary {
  return {
    topPriorityTasks: tasks.slice(0, 10),
    quickWins: tasks.filter((t) => t.category === 'quick_win'),
    longTermImprovements: tasks.filter((t) => t.category === 'long_term'),
    weeklyActionPlan: tasks.filter((t) => t.planHorizon === 'weekly'),
    thirtyDayPlan: tasks.filter((t) => t.planHorizon === '30_day'),
    ninetyDayPlan: tasks.filter((t) => t.planHorizon === '90_day'),
  };
}
