'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { DesignElement, DesignScreen } from '@/lib/types';

const WEIGHTS = [400, 500, 600, 700];

export function PropertiesPanel({
  screen,
  element,
  allScreens,
  onChangeElement,
  onChangeScreen,
}: {
  screen: DesignScreen | null;
  element: DesignElement | null;
  allScreens: DesignScreen[];
  onChangeElement: (patch: Partial<DesignElement>) => void;
  onChangeScreen: (patch: Partial<DesignScreen>) => void;
}) {
  if (!screen) {
    return (
      <div className="w-72 shrink-0 border-l border-border bg-card/60 p-4 text-xs text-muted-foreground">
        Select a screen or element to edit its properties.
      </div>
    );
  }

  const hasText = element?.type === 'text' || element?.type === 'button' || element?.type === 'input';
  const hasFill = element?.type === 'rect' || element?.type === 'button' || element?.type === 'input' || element?.type === 'icon';
  const hasTarget = element?.type === 'button' || element?.type === 'icon';

  return (
    <div className="w-72 shrink-0 space-y-5 overflow-y-auto border-l border-border bg-card/60 p-4">
      {!element ? (
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Screen</div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={screen.name}
                onChange={(e) => onChangeScreen({ name: e.target.value })}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Width</Label>
                <Input value={screen.width} disabled className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Height</Label>
                <Input value={screen.height} disabled className="mt-1 h-8 text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Background</Label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={screen.background}
                  onChange={(e) => onChangeScreen({ background: e.target.value })}
                  className="h-8 w-8 rounded border border-border bg-transparent"
                />
                <Input
                  value={screen.background}
                  onChange={(e) => onChangeScreen({ background: e.target.value })}
                  className="h-8 flex-1 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">
            {element.type}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">X</Label>
              <Input
                type="number"
                value={Math.round(element.x)}
                onChange={(e) => onChangeElement({ x: Number(e.target.value) })}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Y</Label>
              <Input
                type="number"
                value={Math.round(element.y)}
                onChange={(e) => onChangeElement({ y: Number(e.target.value) })}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Width</Label>
              <Input
                type="number"
                value={Math.round(element.w)}
                onChange={(e) => onChangeElement({ w: Number(e.target.value) })}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Height</Label>
              <Input
                type="number"
                value={Math.round(element.h)}
                onChange={(e) => onChangeElement({ h: Number(e.target.value) })}
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>

          {element.type !== 'text' && (
            <div>
              <Label className="text-xs">Corner Radius</Label>
              <Input
                type="number"
                value={element.radius ?? 0}
                onChange={(e) => onChangeElement({ radius: Number(e.target.value) })}
                className="mt-1 h-8 text-xs"
              />
            </div>
          )}

          {hasFill && (
            <div>
              <Label className="text-xs">Fill</Label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={element.fill ?? '#000000'}
                  onChange={(e) => onChangeElement({ fill: e.target.value })}
                  className="h-8 w-8 rounded border border-border bg-transparent"
                />
                <Input
                  value={element.fill ?? ''}
                  onChange={(e) => onChangeElement({ fill: e.target.value })}
                  className="h-8 flex-1 text-xs font-mono"
                />
              </div>
            </div>
          )}

          {hasText && (
            <>
              <div>
                <Label className="text-xs">Text</Label>
                <Textarea
                  value={element.text ?? ''}
                  onChange={(e) => onChangeElement({ text: e.target.value })}
                  rows={2}
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Text Color</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={element.color ?? '#000000'}
                    onChange={(e) => onChangeElement({ color: e.target.value })}
                    className="h-8 w-8 rounded border border-border bg-transparent"
                  />
                  <Input
                    value={element.color ?? ''}
                    onChange={(e) => onChangeElement({ color: e.target.value })}
                    className="h-8 flex-1 text-xs font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Font Size</Label>
                  <Input
                    type="number"
                    value={element.fontSize ?? 14}
                    onChange={(e) => onChangeElement({ fontSize: Number(e.target.value) })}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Weight</Label>
                  <Select
                    value={String(element.fontWeight ?? 400)}
                    onValueChange={(v) => onChangeElement({ fontWeight: Number(v) })}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEIGHTS.map((w) => <SelectItem key={w} value={String(w)}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {hasTarget && (
            <div>
              <Label className="text-xs">Links to (Prototype)</Label>
              <Select
                value={element.target ?? 'none'}
                onValueChange={(v) => onChangeElement({ target: v === 'none' ? null : v })}
              >
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allScreens.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
