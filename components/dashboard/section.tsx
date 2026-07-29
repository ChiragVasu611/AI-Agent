import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * Dashboard layout primitives — presentation only, no data access.
 *
 * These exist so pages stop re-implementing the same header/section/card
 * scaffolding with slightly different spacing and heading weights, which is what
 * made every card read with identical visual weight.
 */

/* ------------------------------------------------------------ page header */

export interface DashboardPageHeaderProps {
  title: string;
  description?: string;
  /** Contextual primary action(s) for the page. */
  actions?: ReactNode;
  /** Optional status/summary chips rendered beneath the title. */
  meta?: ReactNode;
  className?: string;
}

export function DashboardPageHeader({
  title, description, actions, meta, className,
}: DashboardPageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {/*
          h2, not h1: in this app's shell the Topbar renders the page h1 for
          every route. Using h1 here would create a second, competing h1 on
          migrated pages while unmigrated pages still rely on the Topbar's.
          Heading order is therefore h1 (shell) -> h2 (page header) ->
          h3 (section) -> h4 (card), with no skipped levels.
        */}
        <h2 className="type-page-title text-foreground">{title}</h2>
        {description && <p className="type-page-description max-w-2xl text-muted-foreground">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- section */

export interface DashboardSectionProps {
  title: string;
  /** One-line explanation of what the section shows. */
  description?: string;
  /** Right-aligned controls (filters, "view all", counts). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DashboardSection({
  title, description, action, children, className,
}: DashboardSectionProps) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="type-card-title text-foreground">{title}</h3>
          {description && <p className="type-caption text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------- chart card */

export interface ChartCardProps {
  title: string;
  /** One-line explanation — required so no chart ships unexplained. */
  description: string;
  action?: ReactNode;
  /**
   * Text alternative describing what the chart conveys, for screen readers.
   * Charts are rendered as SVG that assistive tech cannot summarise on its own.
   */
  summary?: string;
  children: ReactNode;
  className?: string;
  /** Body padding is removable for charts that should bleed to the edges. */
  bodyClassName?: string;
}

export function ChartCard({
  title, description, action, summary, children, className, bodyClassName,
}: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col rounded-card border-border bg-card elevation-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-0.5">
          <h4 className="type-card-title text-foreground">{title}</h4>
          <p className="type-caption text-muted-foreground">{description}</p>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className={cn('flex-1 p-5', bodyClassName)}>
        {summary && <p className="sr-only">{summary}</p>}
        {children}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ empty state */

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** Keep the existing truthful, action-oriented copy — only presentation changes. */
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {Icon && (
        <span className="grid h-10 w-10 place-items-center rounded-control bg-secondary text-muted-foreground ring-1 ring-inset ring-border">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <p className="type-body mt-1 font-medium text-foreground">{title}</p>
      {description && <p className="type-caption max-w-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------- health/state */

export interface HealthIndicatorProps {
  label: string;
  state: 'healthy' | 'degraded' | 'down' | 'unknown';
  detail?: string;
  className?: string;
}

const HEALTH: Record<HealthIndicatorProps['state'], { dot: string; text: string; label: string }> = {
  healthy: { dot: 'bg-success', text: 'text-success', label: 'Healthy' },
  degraded: { dot: 'bg-warning', text: 'text-warning', label: 'Degraded' },
  down: { dot: 'bg-destructive', text: 'text-destructive', label: 'Down' },
  unknown: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'Unknown' },
};

export function HealthIndicator({ label, state, detail, className }: HealthIndicatorProps) {
  const h = HEALTH[state];
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', h.dot)} />
      <span className="type-body min-w-0 flex-1 truncate text-foreground">{label}</span>
      {/* State is spelled out, not implied by the dot colour alone. */}
      <span className={cn('type-caption shrink-0 font-medium', h.text)}>{detail ?? h.label}</span>
    </div>
  );
}
