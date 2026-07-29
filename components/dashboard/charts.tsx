'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Shared chart primitives.
 *
 * HONESTY RULE: these render only what the caller passes. When every value is
 * zero they render an explicit "no data yet" state instead of an empty axis or a
 * misleading full-circle donut — a chart is never drawn from invented numbers.
 *
 * All colours come from the semantic `--chart-*` / state tokens, so both themes
 * are handled by the token layer rather than per-chart overrides.
 */

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 10,
  fontSize: 12,
  color: 'hsl(var(--popover-foreground))',
  boxShadow: '0 8px 24px -8px hsl(var(--shadow-color) / 0.25)',
} as const;

export interface ChartDatum {
  name: string;
  value: number;
  /** A semantic token expression, e.g. `hsl(var(--destructive))`. */
  color?: string;
}

function NoChartData({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-control bg-surface/60 px-4 text-center">
      <p className="type-caption text-muted-foreground">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ donut */

export interface DonutChartProps {
  data: ChartDatum[];
  /** Shown when there is genuinely nothing to plot. */
  emptyMessage: string;
  /** Large figure in the centre of the ring. */
  centerValue?: string | number;
  centerLabel?: string;
  height?: number;
  className?: string;
}

export function DonutChart({
  data, emptyMessage, centerValue, centerLabel, height = 220, className,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return <NoChartData message={emptyMessage} />;

  // Zero-value slices are dropped so the legend doesn't list absent categories.
  const slices = data.filter((d) => d.value > 0);

  return (
    <div className={cn('relative', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {slices.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? `hsl(var(--chart-${(i % 6) + 1}))`} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [
              `${value} (${Math.round((value / total) * 100)}%)`, name,
            ]}
          />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue != null && (
        // Decorative duplicate of data already in the legend/tooltip.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center"
        >
          <div className="nums type-card-title text-foreground">{centerValue}</div>
          {centerLabel && <div className="type-caption text-muted-foreground">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- bar chart */

export interface CategoryBarChartProps {
  data: ChartDatum[];
  emptyMessage: string;
  /** Horizontal bars suit ranked categories with long labels. */
  layout?: 'vertical' | 'horizontal';
  height?: number;
  className?: string;
}

export function CategoryBarChart({
  data, emptyMessage, layout = 'horizontal', height = 240, className,
}: CategoryBarChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return <NoChartData message={emptyMessage} />;

  // Recharts calls a left-to-right bar chart layout="vertical"; expose the
  // intuitive naming and translate here.
  const isRanked = layout === 'vertical';

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout={isRanked ? 'vertical' : 'horizontal'}
          margin={isRanked ? { top: 4, right: 16, left: 4, bottom: 4 } : { top: 8, right: 8, left: -18, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            horizontal={!isRanked}
            vertical={isRanked}
          />
          {isRanked ? (
            <>
              <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={104}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={54}
              />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
            </>
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} />
          <Bar dataKey="value" name="Count" radius={isRanked ? [0, 5, 5, 0] : [5, 5, 0, 0]} maxBarSize={44}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? `hsl(var(--chart-${(i % 6) + 1}))`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
