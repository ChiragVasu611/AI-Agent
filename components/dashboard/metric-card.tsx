import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/dashboard/status-badge';

/**
 * KPI presentation components.
 *
 * HONESTY RULE: every optional element here renders only when the caller passes
 * real data. There is no default trend, no invented "vs last period", and no
 * placeholder sparkline — omitting a prop omits the element entirely. Nothing in
 * this file computes or fabricates a comparison.
 */

export type MetricState = 'default' | 'success' | 'warning' | 'critical';

const STATE_ACCENT: Record<MetricState, string> = {
  default: 'text-primary bg-primary/10 ring-primary/15',
  success: 'text-success bg-success/12 ring-success/20',
  warning: 'text-warning bg-warning/12 ring-warning/20',
  critical: 'text-destructive bg-destructive/12 ring-destructive/20',
};

/* ------------------------------------------------------------------ trend */

export interface TrendBadgeProps {
  /** Signed change. Caller computes this from real historical data. */
  deltaPct: number;
  /** When false, a rise is bad (e.g. crash count) and colours invert. */
  higherIsBetter?: boolean;
  className?: string;
}

export function TrendBadge({ deltaPct, higherIsBetter = true, className }: TrendBadgeProps) {
  const flat = Math.abs(deltaPct) < 0.05;
  const up = deltaPct > 0;
  const good = flat ? null : up === higherIsBetter;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'type-badge inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ring-1 ring-inset',
        good === null && 'bg-secondary text-muted-foreground ring-border',
        good === true && 'bg-success/12 text-success ring-success/20',
        good === false && 'bg-destructive/12 text-destructive ring-destructive/20',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {/* Sign is explicit so the direction never depends on colour alone. */}
      <span className="nums">{flat ? '0%' : `${up ? '+' : ''}${deltaPct.toFixed(1)}%`}</span>
    </span>
  );
}

/* -------------------------------------------------------------- sparkline */

export interface MiniSparklineProps {
  /** Real time-series values, oldest first. Fewer than 3 points renders nothing. */
  data: number[];
  className?: string;
  tone?: MetricState;
}

/**
 * Dependency-free inline sparkline. Recharts is used for real charts; a KPI
 * spark is a single path and does not warrant a chart runtime per card.
 * Decorative by definition — the metric value beside it carries the meaning —
 * so it is hidden from assistive tech.
 */
export function MiniSparkline({ data, className, tone = 'default' }: MiniSparklineProps) {
  if (!data || data.length < 3) return null;

  const w = 72;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`);

  const stroke =
    tone === 'success' ? 'hsl(var(--success))'
      : tone === 'warning' ? 'hsl(var(--warning))'
        : tone === 'critical' ? 'hsl(var(--destructive))'
          : 'hsl(var(--chart-1))';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-6 w-[72px] overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ metric card */

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  state?: MetricState;
  /** Short qualifier under the value (e.g. "12 of 40 screens"). Real data only. */
  hint?: string;
  /** Only pass when a genuine prior-period comparison exists. */
  trend?: { deltaPct: number; higherIsBetter?: boolean; comparisonLabel?: string };
  /** Only pass when a real series is available. */
  sparkline?: number[];
  className?: string;
}

export function MetricCard({
  label, value, icon: Icon, state = 'default', hint, trend, sparkline, className,
}: MetricCardProps) {
  return (
    <Card
      className={cn(
        // Consistent minimum height keeps a KPI row aligned whether or not
        // individual cards carry a trend or sparkline.
        'flex min-h-[132px] flex-col justify-between gap-3 rounded-card border-border bg-card p-5',
        'elevation-card transition-shadow duration-200 hover:elevation-raised',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="type-caption font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span
            className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-control ring-1 ring-inset', STATE_ACCENT[state])}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="nums type-metric-value truncate">{value}</div>
          {hint && <div className="type-caption mt-1 truncate text-muted-foreground">{hint}</div>}
        </div>
        {sparkline && <MiniSparkline data={sparkline} tone={state} className="shrink-0" />}
      </div>

      {trend && (
        <div className="flex items-center gap-2">
          <TrendBadge deltaPct={trend.deltaPct} higherIsBetter={trend.higherIsBetter} />
          {trend.comparisonLabel && (
            <span className="type-caption truncate text-muted-foreground">{trend.comparisonLabel}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Skeleton mirroring MetricCard's box model so nothing shifts on load. */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('flex min-h-[132px] flex-col justify-between gap-3 rounded-card border-border bg-card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-control" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- status metric */

export interface StatusMetricProps {
  label: string;
  value: string | number;
  /** Existing status value, passed straight through to StatusBadge. */
  status: string;
  icon?: LucideIcon;
  className?: string;
}

/** A KPI whose headline is a state rather than a trend (e.g. device health). */
export function StatusMetric({ label, value, status, icon, className }: StatusMetricProps) {
  const Icon = icon;
  return (
    <Card className={cn('flex min-h-[132px] flex-col justify-between gap-3 rounded-card border-border bg-card p-5 elevation-card', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="type-caption font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-secondary text-muted-foreground ring-1 ring-inset ring-border">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="nums type-metric-value truncate">{value}</div>
        <StatusBadge status={status} />
      </div>
    </Card>
  );
}
