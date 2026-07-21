import { DesignAgentRun } from '@/lib/mongodb/models/DesignAgentRun';
import { DesignDocument } from '@/lib/mongodb/models/DesignDocument';
import { buildFallbackScreens, dedupeNames, extractHexColors } from './design-fallback-layout';
import type { DesignElement, DesignScreen } from '@/lib/types';

const VALID_ELEMENT_TYPES = new Set(['rect', 'text', 'button', 'image', 'icon', 'input']);

function isUsableElement(el: unknown): el is DesignElement {
  if (!el || typeof el !== 'object') return false;
  const e = el as Record<string, unknown>;
  return (
    typeof e.type === 'string' && VALID_ELEMENT_TYPES.has(e.type)
    && Number.isFinite(e.x) && Number.isFinite(e.y)
    && Number.isFinite(e.w) && Number.isFinite(e.h)
    && (e.w as number) > 0 && (e.h as number) > 0
  );
}

/** A screen counts as usable only if every generated screen name has real, renderable content — no blank frames. */
function isUsableScreensArray(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const screen = s as Record<string, unknown>;
    if (typeof screen.name !== 'string' || !screen.name.trim()) return false;
    if (!Array.isArray(screen.elements) || screen.elements.length === 0) return false;
    return screen.elements.every(isUsableElement);
  });
}

// Exported for the API route's PATCH validation (user edits must also stay well-formed).
export function isValidScreens(value: unknown): value is DesignScreen[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (s) => s && typeof s === 'object' && Array.isArray((s as Record<string, unknown>).elements),
  );
}

async function buildInitialScreens(projectId: string): Promise<DesignScreen[]> {
  const runs = await DesignAgentRun.find({ projectId }).lean();
  const runByAgent = new Map(runs.map((r: any) => [r.agent, r]));

  const uidesignOutput = (runByAgent.get('uidesign') as any)?.output;
  const researchOutput = (runByAgent.get('research') as any)?.output;
  const strategyOutput = (runByAgent.get('strategy') as any)?.output;

  const rawScreens = (uidesignOutput as Record<string, unknown> | undefined)?.screens;
  if (isUsableScreensArray(rawScreens)) {
    const names = dedupeNames(rawScreens.map((s) => String(s.name)));
    return rawScreens.map((s, i) => ({
      id: s.id ? String(s.id) : `screen-${i}`,
      name: names[i],
      canvasX: i * (375 + 120),
      canvasY: 0,
      width: Number(s.width) || 375,
      height: Number(s.height) || 812,
      background: typeof s.background === 'string' ? s.background : '#FAFAFB',
      elements: s.elements as DesignElement[],
    }));
  }

  // The LLM's structured screen layout was missing, incomplete, or contained blank/malformed
  // frames — fall back to a deterministic, always-complete generator so no screen ships empty.
  let screenNames: string[] = [];
  if (Array.isArray(researchOutput?.screenHierarchy)) {
    screenNames = researchOutput.screenHierarchy.map(String);
  } else if (Array.isArray(strategyOutput?.screenInventory)) {
    screenNames = strategyOutput.screenInventory.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
  }

  const colors = [
    ...extractHexColors(uidesignOutput ?? {}),
    ...extractHexColors(researchOutput ?? {}),
  ];

  const style = (uidesignOutput as any)?.style ?? 'modern';
  return buildFallbackScreens(screenNames, colors, String(style));
}

export async function getOrCreateDesignDocument(projectId: string): Promise<Record<string, any>> {
  // Atomic upsert: findOne+create would race under concurrent requests (e.g. two
  // client polls hitting GET at once) and throw on the unique projectId index,
  // which previously surfaced as "created in history but empty when opened".
  const screens = await buildInitialScreens(projectId);
  const doc = await DesignDocument.findOneAndUpdate(
    { projectId },
    { $setOnInsert: { projectId, screens, versions: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return doc as Record<string, any>;
}
