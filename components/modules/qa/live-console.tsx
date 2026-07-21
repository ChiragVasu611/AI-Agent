'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface LogEntry {
  id: string;
  source: 'automation' | 'logcat' | 'api' | 'error' | 'crash';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  automation: 'Automation', logcat: 'Logcat', api: 'API', error: 'Error', crash: 'Crash',
};

const SOURCES = ['automation', 'logcat', 'api', 'error', 'crash'];

export function LiveConsole({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [logs]);

  const filtered = logs.filter((l) => (!filter || l.source === filter) && (!search || l.message.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setFilter(null)}
          className={cn('rounded-full px-2.5 py-1 text-[11px]', !filter ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}
        >
          All
        </button>
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn('rounded-full px-2.5 py-1 text-[11px]', filter === s ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground')}
          >
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs…" className="h-8 pl-8 text-xs" />
      </div>
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto rounded-lg bg-black/90 p-3 font-mono text-[11px]">
        {filtered.length === 0 && <p className="text-muted-foreground">No log entries yet.</p>}
        {filtered.map((l) => (
          <div key={l.id} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">{new Date(l.createdAt).toLocaleTimeString()}</span>
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">{SOURCE_LABEL[l.source]}</Badge>
            <span className={cn(
              l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-green-400',
            )}>
              {l.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
