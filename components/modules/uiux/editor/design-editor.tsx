'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Eye, Loader2, Minus, MousePointer2, Plus, Redo2, RotateCcw, Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SidebarPanel } from './sidebar-panel';
import { PropertiesPanel } from './properties-panel';
import { ElementNode } from './element-node';
import type { DesignDocumentVersion, DesignElement, DesignScreen } from '@/lib/types';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const AUTOSAVE_DELAY = 1200;

export function DesignEditor({
  projectId,
  projectName,
  initialScreens,
  initialVersions,
}: {
  projectId: string;
  projectName: string;
  initialScreens: DesignScreen[];
  initialVersions: DesignDocumentVersion[];
}) {
  const [screens, setScreens] = useState<DesignScreen[]>(initialScreens);
  const [versions, setVersions] = useState<DesignDocumentVersion[]>(initialVersions);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(initialScreens[0]?.id ?? null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [mode, setMode] = useState<'design' | 'prototype'>('design');
  const [zoom, setZoom] = useState(0.6);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const historyRef = useRef<DesignScreen[][]>([initialScreens]);
  const historyIndexRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const selectedScreen = screens.find((s) => s.id === selectedScreenId) ?? null;
  const selectedElement = selectedScreen?.elements.find((e) => e.id === selectedElementId) ?? null;

  const pushHistory = useCallback((next: DesignScreen[]) => {
    const truncated = historyRef.current.slice(0, historyIndexRef.current + 1);
    truncated.push(next);
    if (truncated.length > 50) truncated.shift();
    historyRef.current = truncated;
    historyIndexRef.current = truncated.length - 1;
  }, []);

  const scheduleSave = useCallback((next: DesignScreen[]) => {
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/design-documents/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screens: next }),
        });
        if (res.ok) {
          const data = await res.json();
          setVersions(data.document.versions ?? []);
          setSaveStatus('saved');
        }
      } catch {
        toast.error('Failed to save design');
      }
    }, AUTOSAVE_DELAY);
  }, [projectId]);

  function updateScreens(updater: (prev: DesignScreen[]) => DesignScreen[], commit: boolean) {
    setScreens((prev) => {
      const next = updater(prev);
      if (commit) {
        pushHistory(next);
        scheduleSave(next);
      }
      return next;
    });
  }

  function updateElement(screenId: string, elementId: string, patch: Partial<DesignElement>, commit: boolean) {
    updateScreens((prev) => prev.map((s) => (
      s.id !== screenId ? s : { ...s, elements: s.elements.map((e) => (e.id === elementId ? { ...e, ...patch } : e)) }
    )), commit);
  }

  function updateScreen(screenId: string, patch: Partial<DesignScreen>) {
    updateScreens((prev) => prev.map((s) => (s.id === screenId ? { ...s, ...patch } : s)), true);
  }

  function commitCurrent() {
    setScreens((prev) => {
      pushHistory(prev);
      scheduleSave(prev);
      return prev;
    });
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setScreens(historyRef.current[historyIndexRef.current]);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setScreens(historyRef.current[historyIndexRef.current]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        if (selectedElementId && selectedScreenId) {
          e.preventDefault();
          updateScreens((prev) => prev.map((s) => (
            s.id !== selectedScreenId ? s : { ...s, elements: s.elements.filter((el) => el.id !== selectedElementId) }
          )), true);
          setSelectedElementId(null);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementId, selectedScreenId]);

  function zoomBy(factor: number, center?: { x: number; y: number }) {
    setZoom((z) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      if (center) {
        setPan((p) => {
          const worldX = (center.x - p.x) / z;
          const worldY = (center.y - p.y) / z;
          return { x: center.x - worldX * nextZoom, y: center.y - worldY * nextZoom };
        });
      }
      return nextZoom;
    });
  }

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = viewportRef.current?.getBoundingClientRect();
      const center = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined;
      zoomBy(1 - e.deltaY * 0.001, center);
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    setSelectedElementId(null);
    (e.target as Element).setPointerCapture(e.pointerId);
    panState.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (!panState.current) return;
    setPan({
      x: panState.current.origX + (e.clientX - panState.current.startX),
      y: panState.current.origY + (e.clientY - panState.current.startY),
    });
  }

  function onCanvasPointerUp() {
    panState.current = null;
  }

  function focusScreen(screenId: string) {
    setSelectedScreenId(screenId);
    setSelectedElementId(null);
    const screen = screens.find((s) => s.id === screenId);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (screen && rect) {
      setPan({
        x: rect.width / 2 - (screen.canvasX + screen.width / 2) * zoom,
        y: rect.height / 2 - (screen.canvasY + screen.height / 2) * zoom,
      });
    }
  }

  async function restoreVersion(index: number) {
    const res = await fetch(`/api/design-documents/${projectId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    if (res.ok) {
      const data = await res.json();
      setScreens(data.document.screens);
      setVersions(data.document.versions ?? []);
      pushHistory(data.document.screens);
      toast.success('Version restored');
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4">
        <Link href={`/designer/${projectId}`} className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="truncate text-sm font-medium">{projectName}</span>
        <Badge variant="outline" className="gap-1 text-[10px]">
          {saveStatus === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
        </Badge>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(0.8)}>
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(1.25)}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setZoom(0.6); setPan({ x: 40, y: 40 }); }}>
            <RotateCcw className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">History</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">Version History</div>
              {versions.length === 0 && <p className="px-1 text-xs text-muted-foreground">No saved versions yet.</p>}
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {versions.slice().reverse().map((v, i) => {
                  const realIndex = versions.length - 1 - i;
                  return (
                    <button
                      key={realIndex}
                      onClick={() => restoreVersion(realIndex)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
                    >
                      <span>{new Date(v.savedAt).toLocaleTimeString()}</span>
                      <span className="text-[10px] text-primary">Restore</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant={mode === 'prototype' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setMode(mode === 'design' ? 'prototype' : 'design')}
          >
            {mode === 'design' ? <Eye className="h-3.5 w-3.5" /> : <MousePointer2 className="h-3.5 w-3.5" />}
            {mode === 'design' ? 'Present' : 'Exit Present'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {mode === 'design' && (
          <SidebarPanel
            screens={screens}
            selectedScreenId={selectedScreenId}
            selectedElementId={selectedElementId}
            onSelectScreen={focusScreen}
            onSelectElement={setSelectedElementId}
          />
        )}

        {/* Canvas */}
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden bg-[radial-gradient(circle,theme(colors.border)_1px,transparent_1px)] [background-size:24px_24px]"
          onWheel={onWheel}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          <div
            className="absolute left-0 top-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
          >
            {screens.map((screen) => (
              <div
                key={screen.id}
                className="absolute"
                style={{ left: screen.canvasX, top: screen.canvasY, width: screen.width, height: screen.height }}
              >
                <div className="absolute -top-6 left-0 text-xs font-medium text-muted-foreground">{screen.name}</div>
                <div
                  className={cn(
                    'relative overflow-hidden rounded-lg border shadow-xl',
                    screen.id === selectedScreenId ? 'border-primary/60' : 'border-border',
                  )}
                  style={{ width: screen.width, height: screen.height, background: screen.background }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedScreenId(screen.id); setSelectedElementId(null); }}
                >
                  {screen.elements.map((el) => (
                    <ElementNode
                      key={el.id}
                      element={el}
                      zoom={zoom}
                      mode={mode}
                      selected={mode === 'design' && el.id === selectedElementId}
                      onSelect={() => { setSelectedScreenId(screen.id); setSelectedElementId(el.id); }}
                      onChange={(patch) => updateElement(screen.id, el.id, patch, false)}
                      onCommit={commitCurrent}
                      onNavigate={focusScreen}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {mode === 'design' && (
          <PropertiesPanel
            screen={selectedScreen}
            element={selectedElement}
            allScreens={screens}
            onChangeElement={(patch) => selectedScreen && selectedElementId && updateElement(selectedScreen.id, selectedElementId, patch, true)}
            onChangeScreen={(patch) => selectedScreen && updateScreen(selectedScreen.id, patch)}
          />
        )}
      </div>
    </div>
  );
}
