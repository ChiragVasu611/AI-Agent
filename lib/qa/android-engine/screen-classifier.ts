import type { ScreenKind, ScreenState, UiNode } from './types';
import { isEditable, labelOf, shortId, visibleText, area, isScrollableNode } from './ui-parser';

/**
 * Classifies an observed screen into a generic kind.
 *
 * Classification is driven purely by structural signals that exist in EVERY
 * Android app — element classes, resource-id vocabulary, password fields,
 * dialog geometry, WebView presence — never by app-specific names. The result
 * is advisory: it steers exploration priority and reporting labels, and a
 * misclassification can never invalidate a finding, because findings are
 * always backed by independent evidence.
 */

/** Generic Android UI vocabulary — these words appear across the whole ecosystem. */
const VOCAB: Array<{ kind: ScreenKind; words: RegExp; weight: number }> = [
  { kind: 'login', words: /\b(sign in|log ?in|continue with|forgot password|remember me)\b/, weight: 3 },
  { kind: 'signup', words: /\b(sign ?up|create account|register|get started free)\b/, weight: 3 },
  { kind: 'paywall', words: /\b(subscribe|subscription|upgrade|premium|free trial|restore purchase|per month|per year|monthly|yearly|unlock (all|full)|go pro)\b/, weight: 3 },
  { kind: 'onboarding', words: /\b(welcome|get started|next|skip( intro)?|swipe to continue|tutorial)\b/, weight: 2 },
  { kind: 'settings', words: /\b(settings|preferences|notifications?|privacy|account settings|language)\b/, weight: 2 },
  { kind: 'profile', words: /\b(profile|my account|edit profile|log ?out|sign out)\b/, weight: 2 },
  { kind: 'search', words: /\b(search|find|query|filter results)\b/, weight: 2 },
  { kind: 'checkout', words: /\b(checkout|cart|place order|payment|billing|total amount|proceed to pay)\b/, weight: 3 },
  { kind: 'product', words: /\b(add to cart|buy now|product details|in stock|reviews)\b/, weight: 2 },
  { kind: 'home', words: /\b(home|for you|feed|dashboard|explore)\b/, weight: 1 },
  { kind: 'gallery', words: /\b(gallery|albums|photos|videos|downloads)\b/, weight: 2 },
  { kind: 'camera', words: /\b(capture|shutter|record|switch camera)\b/, weight: 2 },
];

const PERMISSION_PKGS = /permissioncontroller|packageinstaller|com\.android\.permission/i;
const PERMISSION_IDS = /permission_(allow|deny|message)|grant_dialog|allow_button|deny_button/i;
const PERMISSION_TEXT = /\ballow\b|\bdeny\b|only this time|while using the app|don't allow|access to your/i;

/** True when the system permission dialog owns the screen. */
export function isPermissionDialog(nodes: UiNode[], pkg: string): boolean {
  if (PERMISSION_PKGS.test(pkg)) return true;
  if (nodes.some((n) => PERMISSION_PKGS.test(n.packageName))) return true;
  if (nodes.some((n) => PERMISSION_IDS.test(n.resourceId))) return true;
  const text = visibleText(nodes);
  return PERMISSION_TEXT.test(text) && text.length < 400;
}

/** Geometry test: a small centered surface over a dimmed background is a dialog. */
function looksLikeDialog(nodes: UiNode[], w: number, h: number): boolean {
  const screenArea = Math.max(1, w * h);
  const framed = nodes.filter((n) => n.depth <= 6 && area(n.bounds) > screenArea * 0.15 && area(n.bounds) < screenArea * 0.85);
  if (framed.length === 0) return false;
  return framed.some((n) => {
    const b = n.bounds;
    const marginLeft = b.left;
    const marginRight = w - b.right;
    const centered = Math.abs(marginLeft - marginRight) < w * 0.12 && marginLeft > w * 0.03;
    const notFullHeight = (b.bottom - b.top) < h * 0.9;
    return centered && notFullHeight;
  });
}

/** A surface anchored to the bottom edge spanning full width is a bottom sheet. */
function looksLikeBottomSheet(nodes: UiNode[], w: number, h: number): boolean {
  return nodes.some((n) => {
    const b = n.bounds;
    const fullWidth = b.left <= w * 0.03 && b.right >= w * 0.97;
    const anchoredBottom = b.bottom >= h * 0.96;
    const startsLow = b.top > h * 0.25 && b.top < h * 0.85;
    return fullWidth && anchoredBottom && startsLow && n.depth <= 12;
  });
}

function hasWebView(nodes: UiNode[]): boolean {
  return nodes.some((n) => /WebView|ChromeClient/i.test(n.className));
}

function hasVideoSurface(nodes: UiNode[]): boolean {
  return nodes.some((n) => /VideoView|SurfaceView|TextureView|ExoPlayer|PlayerView/i.test(n.className));
}

function hasPasswordField(nodes: UiNode[]): boolean {
  return nodes.some((n) => n.password);
}

function editableCount(nodes: UiNode[]): number {
  return nodes.filter(isEditable).length;
}

/** Splash: almost nothing interactive, no scrollables, very few elements. */
function looksLikeSplash(nodes: UiNode[]): boolean {
  const interactive = nodes.filter((n) => n.clickable && n.enabled).length;
  const scrollables = nodes.filter(isScrollableNode).length;
  return nodes.length > 0 && nodes.length < 14 && interactive <= 1 && scrollables === 0;
}

export interface ClassifyInput {
  nodes: UiNode[];
  activity: string;
  packageName: string;
  width: number;
  height: number;
  /** Set by the ad detector, which owns SDK-level signals. */
  adDetected?: boolean;
}

export interface Classification {
  kind: ScreenKind;
  label: string;
  confidence: number;
}

/** Derives a readable screen label from the activity name — generic across all apps. */
export function labelFromActivity(activity: string): string {
  const comp = activity.includes('/') ? activity.split('/')[1] : activity;
  const cls = comp.split('.').filter(Boolean).pop() ?? comp;
  const cleaned = cls
    .replace(/Activity$|Fragment$|Screen$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned || cls || 'Screen';
}

export function classifyScreen(input: ClassifyInput): Classification {
  const { nodes, activity, packageName, width, height } = input;
  const label = labelFromActivity(activity);

  if (input.adDetected) return { kind: 'ad', label: `Ad (${label})`, confidence: 0.9 };

  if (isPermissionDialog(nodes, packageName)) {
    return { kind: 'permission_dialog', label: 'Permission Dialog', confidence: 0.95 };
  }

  const text = visibleText(nodes);

  // Score the generic vocabulary; combine with structural evidence below.
  const scores = new Map<ScreenKind, number>();
  for (const entry of VOCAB) {
    if (entry.words.test(text)) {
      scores.set(entry.kind, (scores.get(entry.kind) ?? 0) + entry.weight);
    }
  }

  // Structural signals outrank vocabulary — they can't be faked by copy.
  if (hasPasswordField(nodes) && editableCount(nodes) >= 1) {
    scores.set('login', (scores.get('login') ?? 0) + 4);
  }
  if (editableCount(nodes) >= 3) {
    scores.set('signup', (scores.get('signup') ?? 0) + 2);
  }
  const activityLower = activity.toLowerCase();
  for (const entry of VOCAB) {
    // The activity's own class name is app-authored but structurally generic.
    if (entry.words.test(activityLower)) scores.set(entry.kind, (scores.get(entry.kind) ?? 0) + 2);
  }

  let best: ScreenKind = 'unknown';
  let bestScore = 0;
  for (const [kind, score] of Array.from(scores.entries())) {
    if (score > bestScore) { best = kind; bestScore = score; }
  }

  // A paywall reading is only trusted when it also blocks the surface.
  if (best === 'paywall' && bestScore >= 3) {
    return { kind: 'paywall', label: `Paywall (${label})`, confidence: 0.8 };
  }

  if (bestScore >= 3) return { kind: best, label, confidence: 0.75 };

  // Fall back to pure structure when vocabulary is inconclusive.
  if (looksLikeSplash(nodes)) return { kind: 'splash', label: label || 'Splash', confidence: 0.6 };
  if (looksLikeBottomSheet(nodes, width, height)) return { kind: 'bottom_sheet', label: `${label} (Sheet)`, confidence: 0.6 };
  if (looksLikeDialog(nodes, width, height)) return { kind: 'dialog', label: `${label} (Dialog)`, confidence: 0.6 };
  if (hasVideoSurface(nodes)) return { kind: 'video', label, confidence: 0.55 };
  if (hasWebView(nodes)) return { kind: 'webview', label, confidence: 0.6 };
  if (nodes.some(isScrollableNode)) return { kind: 'list', label, confidence: 0.4 };
  if (bestScore > 0) return { kind: best, label, confidence: 0.5 };

  return { kind: 'unknown', label, confidence: 0.2 };
}

/**
 * Structural signature of a screen. Two screens collapse to the same graph
 * node when their interactive skeleton matches — content differences (a
 * different product title in a list) must NOT create infinite new nodes,
 * so free text is deliberately excluded and only stable identity is used.
 */
export function screenSignature(activity: string, nodes: UiNode[]): string {
  const skeleton = nodes
    .filter((n) => n.clickable || n.scrollable || n.checkable || isEditable(n))
    .map((n) => `${n.className.split('.').pop()}:${shortId(n)}:${n.clickable ? 'c' : ''}${n.scrollable ? 's' : ''}${n.checkable ? 'k' : ''}`)
    .sort()
    .join('|');

  // Include a coarse count bucket so genuinely different densities differ.
  const bucket = Math.floor(nodes.length / 12);
  let h = 5381;
  const raw = `${activity}#${bucket}#${skeleton}`;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return `${activity.split('/').pop() ?? 'a'}~${(h >>> 0).toString(36)}`;
}

/**
 * A coarser, capture-oriented fingerprint of a screen used to decide whether a
 * screenshot would be a visual DUPLICATE of one already taken.
 *
 * Unlike {@link screenSignature}, it deliberately drops the node-count bucket
 * and collapses repeated identical controls (list rows, feed items) to a single
 * entry. As a screen loads its content asynchronously — a feed filling in, a
 * spinner resolving, a video's overlay controls toggling — its element count
 * fluctuates and the structural signature churns, which otherwise made the same
 * visible screen register (and get screenshotted) again and again with no user
 * action in between. Keying dedup on this stable fingerprint prevents that,
 * while genuinely different screens still differ because their distinct control
 * set does.
 */
export function perceptualSignature(activity: string, nodes: UiNode[]): string {
  const skeleton = Array.from(new Set(
    nodes
      .filter((n) => n.clickable || n.scrollable || n.checkable || isEditable(n))
      .map((n) => `${n.className.split('.').pop()}:${shortId(n)}:${n.clickable ? 'c' : ''}${n.scrollable ? 's' : ''}${n.checkable ? 'k' : ''}`),
  )).sort().join('|');

  let h = 5381;
  const raw = `${activity}#${skeleton}`;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return `${activity.split('/').pop() ?? 'a'}~${(h >>> 0).toString(36)}`;
}

/** Elements a human would consider "the primary actions" on this screen. */
export function primaryActions(state: ScreenState): UiNode[] {
  return state.nodes
    .filter((n) => n.clickable && n.enabled)
    .filter((n) => labelOf(n).length > 0)
    .slice(0, 12);
}
