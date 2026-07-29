import { cn } from '@/lib/utils';

/**
 * Central status presentation.
 *
 * PRESENTATION ONLY — this maps an existing status *value* to colours and a
 * label. No enum value, API field, or comparison anywhere in the app changes;
 * callers keep passing exactly the strings they already have. Unknown values
 * fall back to a neutral treatment and render their own text, so a status this
 * table hasn't seen still displays correctly rather than disappearing.
 *
 * Every entry pairs colour with a dot and readable text, so status is never
 * communicated by colour alone (WCAG 1.4.1).
 */

export type StatusTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface StatusSpec {
  label: string;
  tone: StatusTone;
  /** Live/in-flight states get a calm pulsing dot. */
  pulse?: boolean;
}

/** Keyed by the raw status values already used across the app. */
const STATUS: Record<string, StatusSpec> = {
  // Run lifecycle
  running: { label: 'Running', tone: 'brand', pulse: true },
  queued: { label: 'Queued', tone: 'neutral' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  partial: { label: 'Partial', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  // Result values
  pass: { label: 'Pass', tone: 'success' },
  fail: { label: 'Fail', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'info' },
  // Account / entity states
  active: { label: 'Active', tone: 'success' },
  deactivated: { label: 'Deactivated', tone: 'neutral' },
  // Severity
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'danger' },
  medium: { label: 'Medium', tone: 'warning' },
  low: { label: 'Low', tone: 'info' },
  // Availability / provenance
  live: { label: 'Live', tone: 'success', pulse: true },
  soon: { label: 'Coming soon', tone: 'neutral' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
  real: { label: 'Real', tone: 'success' },
  simulated: { label: 'Simulated', tone: 'neutral' },
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-secondary text-secondary-foreground ring-border',
  brand: 'bg-primary/10 text-primary ring-primary/20',
  success: 'bg-success/12 text-success ring-success/25',
  warning: 'bg-warning/12 text-warning ring-warning/25',
  danger: 'bg-destructive/12 text-destructive ring-destructive/25',
  info: 'bg-info/12 text-info ring-info/25',
};

export function statusTone(status: string): StatusTone {
  return STATUS[String(status).toLowerCase()]?.tone ?? 'neutral';
}

export interface StatusBadgeProps {
  /** The raw status value already in use (enum values are never altered). */
  status: string;
  /** Overrides the mapped label; the status value itself is unchanged. */
  label?: string;
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, showDot = true, className }: StatusBadgeProps) {
  const key = String(status ?? '').toLowerCase();
  const spec = STATUS[key];
  const tone = spec?.tone ?? 'neutral';
  // Unknown statuses still render their own value rather than vanishing.
  const text = label ?? spec?.label ?? String(status ?? '').replace(/_/g, ' ');

  return (
    <span
      className={cn(
        'type-badge inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5',
        'ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', spec?.pulse && 'pulse-dot')}
        />
      )}
      <span className="capitalize">{text}</span>
    </span>
  );
}
