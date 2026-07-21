'use client';

import { useMemo, useState } from 'react';
import { Image as ImageIcon, Layers, Square, Type, LayoutGrid, Boxes, MousePointerClick, TextCursorInput } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DesignElement, DesignScreen } from '@/lib/types';

const TABS = ['Pages', 'Layers', 'Components', 'Assets'] as const;
type Tab = typeof TABS[number];

const ELEMENT_ICONS: Record<DesignElement['type'], typeof Square> = {
  rect: Square,
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  icon: Boxes,
  input: TextCursorInput,
};

export function SidebarPanel({
  screens,
  selectedScreenId,
  selectedElementId,
  onSelectScreen,
  onSelectElement,
}: {
  screens: DesignScreen[];
  selectedScreenId: string | null;
  selectedElementId: string | null;
  onSelectScreen: (id: string) => void;
  onSelectElement: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('Pages');
  const activeScreen = screens.find((s) => s.id === selectedScreenId) ?? screens[0];

  const componentCounts = useMemo(() => {
    const counts = new Map<DesignElement['type'], number>();
    screens.forEach((s) => s.elements.forEach((e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1)));
    return Array.from(counts.entries());
  }, [screens]);

  const assets = useMemo(
    () => screens.flatMap((s) => s.elements.filter((e) => e.type === 'image').map((e) => ({ screen: s.name, id: e.id }))),
    [screens],
  );

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/60">
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 px-2 py-2.5 text-[11px] font-medium transition',
              tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'Pages' && (
          <div className="space-y-1">
            {screens.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectScreen(s.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition',
                  s.id === activeScreen?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'Layers' && (
          <div className="space-y-0.5">
            {!activeScreen && <p className="p-2 text-xs text-muted-foreground">Select a page first.</p>}
            {activeScreen?.elements.map((el) => {
              const Icon = ELEMENT_ICONS[el.type] ?? Layers;
              return (
                <button
                  key={el.id}
                  onClick={() => onSelectElement(el.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition',
                    el.id === selectedElementId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate capitalize">{el.text ? el.text.slice(0, 24) : el.type}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'Components' && (
          <div className="space-y-1">
            {componentCounts.map(([type, count]) => {
              const Icon = ELEMENT_ICONS[type] ?? Layers;
              return (
                <div key={type} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate capitalize">{type}</span>
                  <span className="text-[10px] tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'Assets' && (
          <div className="space-y-1">
            {assets.length === 0 && <p className="p-2 text-xs text-muted-foreground">No image assets in this project.</p>}
            {assets.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{a.screen} — image</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
