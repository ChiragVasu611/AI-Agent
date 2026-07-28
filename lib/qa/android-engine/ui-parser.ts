import type { Bounds, UiNode } from './types';

/**
 * Parser for `uiautomator dump` XML.
 *
 * The dump is a single-line XML document of nested <node> elements. Rather
 * than pulling in an XML dependency, this tokenizes the node tags and rebuilds
 * the tree with a stack — the grammar is fixed and flat enough that this is
 * both faster and dependency-free. Every attribute the engine reasons about
 * (bounds, resource-id, class, content-desc, clickable/enabled/scrollable…)
 * is preserved verbatim from the device.
 */

const NODE_TAG = /<node\b([^>]*?)(\/?)>|<\/node>/g;
const ATTR = /([\w-]+)="([^"]*)"/g;

const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseBounds(raw: string): Bounds {
  const m = BOUNDS_RE.exec(raw ?? '');
  if (!m) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: Number(m[1]), top: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) };
}

function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw)) !== null) out[m[1]] = unescapeXml(m[2]);
  return out;
}

const bool = (v: string | undefined) => v === 'true';

function toNode(raw: string, depth: number): UiNode {
  const a = attrsOf(raw);
  return {
    index: Number(a.index ?? 0),
    text: a.text ?? '',
    resourceId: a['resource-id'] ?? '',
    className: a.class ?? '',
    packageName: a.package ?? '',
    contentDesc: a['content-desc'] ?? '',
    checkable: bool(a.checkable),
    checked: bool(a.checked),
    clickable: bool(a.clickable),
    enabled: bool(a.enabled),
    focusable: bool(a.focusable),
    focused: bool(a.focused),
    scrollable: bool(a.scrollable),
    longClickable: bool(a['long-clickable']),
    password: bool(a.password),
    selected: bool(a.selected),
    bounds: parseBounds(a.bounds ?? ''),
    children: [],
    depth,
  };
}

export interface ParsedHierarchy {
  root: UiNode | null;
  nodes: UiNode[];
  rotation: number;
}

/** Builds the node tree from a raw uiautomator dump. Returns an empty tree on garbage input. */
export function parseHierarchy(xml: string): ParsedHierarchy {
  const rotMatch = /<hierarchy[^>]*rotation="(\d+)"/.exec(xml ?? '');
  const rotation = rotMatch ? Number(rotMatch[1]) : 0;

  const nodes: UiNode[] = [];
  const stack: UiNode[] = [];
  let root: UiNode | null = null;

  NODE_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NODE_TAG.exec(xml ?? '')) !== null) {
    const isClose = m[0] === '</node>';
    if (isClose) {
      stack.pop();
      continue;
    }
    const selfClosing = m[2] === '/';
    const node = toNode(m[1] ?? '', stack.length);
    nodes.push(node);
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (!root) root = node;
    if (!selfClosing) stack.push(node);
  }

  return { root, nodes, rotation };
}

export const width = (b: Bounds) => Math.max(0, b.right - b.left);
export const height = (b: Bounds) => Math.max(0, b.bottom - b.top);
export const area = (b: Bounds) => width(b) * height(b);
export const centerOf = (b: Bounds) => ({
  x: Math.round((b.left + b.right) / 2),
  y: Math.round((b.top + b.bottom) / 2),
});

/** True when the node occupies real space on screen. */
export function isVisible(n: UiNode, screenW: number, screenH: number): boolean {
  const b = n.bounds;
  if (width(b) <= 0 || height(b) <= 0) return false;
  if (b.right <= 0 || b.bottom <= 0) return false;
  if (b.left >= screenW || b.top >= screenH) return false;
  return true;
}

/** Any label a human (or TalkBack) could read off this element. */
export function labelOf(n: UiNode): string {
  return (n.text || n.contentDesc || '').trim();
}

/** Short resource id without the package prefix, e.g. "com.x:id/btn_ok" -> "btn_ok". */
export function shortId(n: UiNode): string {
  const raw = n.resourceId || '';
  const slash = raw.lastIndexOf('/');
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

/** Best available human identity for an element, for logs and repro steps. */
export function describeNode(n: UiNode): string {
  const label = labelOf(n);
  if (label) return label.slice(0, 60);
  const id = shortId(n);
  if (id) return id.slice(0, 60);
  const cls = n.className.split('.').pop() ?? n.className;
  const c = centerOf(n.bounds);
  return `${cls} @(${c.x},${c.y})`;
}

export function isEditable(n: UiNode): boolean {
  return /EditText|AutoCompleteTextView|SearchView/i.test(n.className) || n.className.includes('TextField');
}

export function isToggle(n: UiNode): boolean {
  return n.checkable || /Switch|CheckBox|ToggleButton|RadioButton/i.test(n.className);
}

export function isScrollableNode(n: UiNode): boolean {
  return n.scrollable || /RecyclerView|ListView|ScrollView|ViewPager|NestedScroll|GridView/i.test(n.className);
}

/** Collects all text visible on the screen — the basis for classification and OCR-free heuristics. */
export function visibleText(nodes: UiNode[]): string {
  return nodes
    .map((n) => `${n.text} ${n.contentDesc}`.trim())
    .filter(Boolean)
    .join(' • ')
    .toLowerCase();
}
