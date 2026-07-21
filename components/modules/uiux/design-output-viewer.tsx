'use client';

import { Badge } from '@/components/ui/badge';

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function collectHexColors(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    const matches = value.match(HEX_RE);
    matches?.forEach((m) => out.add(m));
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectHexColors(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => collectHexColors(v, out));
  }
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-1.5">
      <span className="h-4 w-4 shrink-0 rounded-full border border-border/60" style={{ backgroundColor: hex }} />
      <span className="font-mono text-xs text-muted-foreground">{hex}</span>
    </div>
  );
}

function RenderValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  if (typeof value === 'string') {
    return <p className="text-sm leading-relaxed text-foreground/90">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <Badge variant="secondary" className="font-mono text-xs">{String(value)}</Badge>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <Badge key={i} variant="outline" className="text-xs font-normal">{String(v)}</Badge>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-secondary/30 p-3">
            <RenderValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    if (depth >= 3) {
      return (
        <pre className="overflow-x-auto rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    return <KeyValueList data={value as Record<string, unknown>} depth={depth + 1} />;
  }
  return null;
}

function KeyValueList({ data, depth = 0 }: { data: Record<string, unknown>; depth?: number }) {
  return (
    <div className={depth === 0 ? 'space-y-5' : 'space-y-3'}>
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {humanize(key)}
          </div>
          <RenderValue value={value} depth={depth} />
        </div>
      ))}
    </div>
  );
}

export function DesignOutputViewer({ output }: { output: Record<string, unknown> | null }) {
  if (!output) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        This agent hasn&apos;t produced output yet.
      </div>
    );
  }

  if ('raw' in output && output._note === 'unstructured') {
    return (
      <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-secondary/30 p-4 text-xs text-muted-foreground">
        {String(output.raw)}
      </pre>
    );
  }

  const colors = new Set<string>();
  collectHexColors(output, colors);

  return (
    <div className="space-y-6">
      {colors.size > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Color Palette
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(colors).map((hex) => <ColorSwatch key={hex} hex={hex} />)}
          </div>
        </div>
      )}
      <KeyValueList data={output} />
    </div>
  );
}
