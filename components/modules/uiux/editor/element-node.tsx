'use client';

import { useRef } from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DesignElement } from '@/lib/types';

export function ElementNode({
  element,
  zoom,
  selected,
  mode,
  onSelect,
  onChange,
  onCommit,
  onNavigate,
}: {
  element: DesignElement;
  zoom: number;
  selected: boolean;
  mode: 'design' | 'prototype';
  onSelect: () => void;
  onChange: (patch: Partial<DesignElement>) => void;
  onCommit: () => void;
  onNavigate: (targetScreenId: string) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (mode === 'prototype') {
      if (element.target) onNavigate(element.target);
      return;
    }
    e.stopPropagation();
    onSelect();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: element.x, origY: element.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragState.current) {
      const dx = (e.clientX - dragState.current.startX) / zoom;
      const dy = (e.clientY - dragState.current.startY) / zoom;
      onChange({ x: Math.round(dragState.current.origX + dx), y: Math.round(dragState.current.origY + dy) });
    } else if (resizeState.current) {
      const dx = (e.clientX - resizeState.current.startX) / zoom;
      const dy = (e.clientY - resizeState.current.startY) / zoom;
      onChange({
        w: Math.max(16, Math.round(resizeState.current.origW + dx)),
        h: Math.max(16, Math.round(resizeState.current.origH + dy)),
      });
    }
  }

  function onPointerUp() {
    if (dragState.current || resizeState.current) onCommit();
    dragState.current = null;
    resizeState.current = null;
  }

  function onResizePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: element.w, origH: element.h };
  }

  const style: React.CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    backgroundColor: element.type === 'text' ? 'transparent' : element.fill,
    color: element.color,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    borderRadius: element.radius,
  };

  return (
    <div
      className={cn(
        'absolute select-none',
        mode === 'design' && 'cursor-move',
        mode === 'prototype' && element.target && 'cursor-pointer',
        selected && 'outline outline-2 outline-primary outline-offset-2',
      )}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {(element.type === 'text' || element.type === 'button') && (
        <div
          className={cn(
            'flex h-full w-full items-center overflow-hidden whitespace-pre-wrap break-words px-1',
            element.type === 'button' && 'justify-center text-center',
          )}
        >
          {element.text}
        </div>
      )}
      {element.type === 'input' && (
        <div className="flex h-full w-full items-center px-3 text-xs" style={{ color: element.color }}>
          {element.text}
        </div>
      )}
      {element.type === 'image' && (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}
      {element.type === 'icon' && (
        <div className="h-full w-full rounded-full" style={{ backgroundColor: element.fill }} />
      )}

      {selected && mode === 'design' && (
        <div
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-full border border-background bg-primary"
          onPointerDown={onResizePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
    </div>
  );
}
