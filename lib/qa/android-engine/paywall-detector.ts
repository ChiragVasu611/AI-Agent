import type { UiNode } from './types';
import { centerOf, labelOf, visibleText, area, parseHierarchy } from './ui-parser';
import { dumpHierarchy, tap, pressKey, KEY, swipe } from './device';
import { waitForStableUi } from './smart-wait';

/**
 * Paywall / subscription-wall detection and escape.
 *
 * A paywall is recognised by commerce vocabulary that is universal across the
 * Play ecosystem (billing terms, price cadence, trial/restore wording) plus
 * structural evidence — Google Play Billing surfaces, or a blocking overlay
 * whose only actions are purchase actions. The engine NEVER attempts a real
 * purchase. If it cannot escape, it records the paywall as a coverage
 * limitation and continues exploring everything still reachable.
 */

const BILLING_PKGS = /com\.android\.vending|com\.google\.android\.finsky|billing/i;

const PURCHASE_WORDS = /\b(subscribe|subscription|start (free )?trial|free trial|upgrade|go premium|go pro|unlock (all|full|premium)|restore (purchase|purchases)|continue for|per (month|year|week)|\/(mo|month|yr|year)\b|monthly|yearly|annual|buy now|purchase|redeem)\b/i;

const PRICE = /(?:[$€£₹¥]\s?\d+(?:[.,]\d{2})?)|(?:\d+(?:[.,]\d{2})?\s?(?:usd|eur|gbp|inr|rs\.?))/i;

/** Escape affordances, in the order a person would try them. */
const ESCAPE_LABELS = /^(x|✕|✖|×|close|dismiss|cancel|not now|no thanks|maybe later|skip|later|continue (free|with ads|without)|use free version|back)$/i;
const ESCAPE_LOOSE = /\b(no thanks|not now|maybe later|continue free|skip|close|dismiss|cancel)\b/i;
const ESCAPE_ID = /(close|skip|dismiss|cancel|later|back)(_?(btn|button|icon))?$/i;

export interface PaywallVerdict {
  isPaywall: boolean;
  reason: string;
  /** True when the surface blocks the whole screen (no way around it in-place). */
  blocking: boolean;
}

export function detectPaywall(nodes: UiNode[], appPackage: string, w: number, h: number): PaywallVerdict {
  const screenArea = Math.max(1, w * h);
  const text = visibleText(nodes);

  // Google Play Billing sheet is unambiguous.
  const billing = nodes.find((n) => BILLING_PKGS.test(n.packageName) && area(n.bounds) > screenArea * 0.2);
  if (billing) {
    return { isPaywall: true, reason: `Google Play Billing surface (${billing.packageName})`, blocking: true };
  }

  const hasPurchaseWords = PURCHASE_WORDS.test(text);
  const hasPrice = PRICE.test(text);

  if (!hasPurchaseWords) return { isPaywall: false, reason: '', blocking: false };

  // Vocabulary alone is weak (a Settings row can say "Upgrade"). Require the
  // surface to be substantial, or to also show pricing.
  const bigSurface = nodes.some((n) =>
    n.packageName === appPackage
    && area(n.bounds) > screenArea * 0.55
    && n.depth <= 10);

  if (hasPrice && (bigSurface || hasPurchaseWords)) {
    return {
      isPaywall: true,
      reason: `Purchase vocabulary with pricing detected${bigSurface ? ' on a blocking surface' : ''}`,
      blocking: bigSurface,
    };
  }

  if (bigSurface) {
    return { isPaywall: true, reason: 'Purchase vocabulary on a full-screen surface', blocking: true };
  }

  return { isPaywall: false, reason: '', blocking: false };
}

function findEscapeControls(nodes: UiNode[], w: number, h: number): UiNode[] {
  const scored: Array<{ n: UiNode; score: number }> = [];
  for (const n of nodes) {
    if (!n.enabled) continue;
    const label = labelOf(n);
    let score = 0;
    if (ESCAPE_LABELS.test(label)) score += 6;
    else if (ESCAPE_LOOSE.test(label)) score += 4;
    if (ESCAPE_ID.test(n.resourceId)) score += 4;
    // Never treat a purchase control as an escape.
    if (PURCHASE_WORDS.test(label)) score -= 10;
    if (!n.clickable) score -= 2;
    if (/ImageButton|ImageView/i.test(n.className) && !label && n.clickable) {
      const c = centerOf(n.bounds);
      if (c.y < h * 0.2 && (c.x < w * 0.2 || c.x > w * 0.8)) score += 3;
    }
    if (score >= 3) scored.push({ n, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.n);
}

export interface PaywallEscapeResult {
  escaped: boolean;
  attempts: string[];
}

/**
 * Tries, in escalating order: an explicit dismiss control, tapping outside the
 * sheet, swiping a bottom sheet down, then Back. Purchase controls are
 * explicitly excluded from every strategy.
 */
export async function escapePaywall(
  serial: string,
  appPackage: string,
  w: number,
  h: number,
): Promise<PaywallEscapeResult> {
  const attempts: string[] = [];

  const stillBlocked = async (): Promise<boolean> => {
    const xml = await dumpHierarchy(serial);
    if (!xml) return false;
    const { nodes } = parseHierarchy(xml);
    return detectPaywall(nodes, appPackage, w, h).isPaywall;
  };

  // 1. Explicit escape controls from the live hierarchy.
  const xml = await dumpHierarchy(serial);
  const { nodes } = parseHierarchy(xml);
  for (const c of findEscapeControls(nodes, w, h).slice(0, 4)) {
    const p = centerOf(c.bounds);
    await tap(serial, p.x, p.y);
    attempts.push(`tapped "${labelOf(c) || c.resourceId || c.className}"`);
    await waitForStableUi(serial, { timeoutMs: 3_500 });
    if (!(await stillBlocked())) return { escaped: true, attempts };
  }

  // 2. Tap outside the sheet (top strip is almost always scrim).
  await tap(serial, Math.round(w / 2), Math.max(8, Math.round(h * 0.04)));
  attempts.push('tapped outside the surface');
  await waitForStableUi(serial, { timeoutMs: 3_000 });
  if (!(await stillBlocked())) return { escaped: true, attempts };

  // 3. Swipe a bottom sheet away.
  await swipe(serial, Math.round(w / 2), Math.round(h * 0.6), Math.round(w / 2), Math.round(h * 0.97), 300);
  attempts.push('swiped the sheet down');
  await waitForStableUi(serial, { timeoutMs: 3_000 });
  if (!(await stillBlocked())) return { escaped: true, attempts };

  // 4. System Back.
  await pressKey(serial, KEY.BACK);
  attempts.push('pressed BACK');
  await waitForStableUi(serial, { timeoutMs: 3_500 });
  if (!(await stillBlocked())) return { escaped: true, attempts };

  return { escaped: false, attempts };
}
