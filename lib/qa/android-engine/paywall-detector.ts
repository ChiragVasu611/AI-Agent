import type { UiNode } from './types';
import { centerOf, labelOf, visibleText, area, parseHierarchy } from './ui-parser';
import { dumpHierarchy, tap, pressKey, KEY, swipe } from './device';
import { waitForStableUi, snapshotSignature as snapshotOf } from './smart-wait';

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

/**
 * The unlabelled icon button that closes a subscription sheet.
 *
 * Paywalls overwhelmingly render their dismiss affordance as a bare ImageView
 * with no text, no content-description and no resource-id — so geometry is the
 * only signal available: a SMALL control near a top corner.
 *
 * The vertical band is deliberately generous (top 30%, not 20%). A real
 * measurement on a 720x1600 device found a subscription sheet whose close button
 * sat at y-centre 362px — 22.6% down, below the status bar and the sheet's own
 * top padding. A 20% cut-off missed it by 42px, so every escape strategy fell
 * through to tapping the scrim and pressing BACK, and the paywall was reported
 * as undismissable while a working X sat on screen.
 */
function looksLikeCloseIcon(n: UiNode, w: number, h: number): boolean {
  if (!/ImageButton|ImageView|Button|View/i.test(n.className)) return false;
  if (!n.clickable || !n.enabled) return false;
  const width = n.bounds.right - n.bounds.left;
  const height = n.bounds.bottom - n.bounds.top;
  // Must be icon-sized: a full-width hero image is not a close button.
  if (width <= 0 || height <= 0) return false;
  if (width > w * 0.25 || height > h * 0.12) return false;
  const c = centerOf(n.bounds);
  return c.y < h * 0.3 && (c.x < w * 0.25 || c.x > w * 0.75);
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
    if (!label && looksLikeCloseIcon(n, w, h)) score += 4;
    if (score >= 3) scored.push({ n, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.n);
}

export interface PaywallEscapeResult {
  escaped: boolean;
  attempts: string[];
}

/** Whether an explicit "Not now / Maybe later / Skip / close" control exists now. */
export function hasEscapeControl(nodes: UiNode[], w: number, h: number): boolean {
  return findEscapeControls(nodes, w, h).length > 0;
}

/** Paywalls in a chain (offer → downsell → win-back) before conceding. */
const MAX_PAYWALL_LINKS = 4;

/**
 * Tries, in escalating order: an explicit dismiss control, tapping outside the
 * sheet, swiping a bottom sheet down, then Back. Purchase controls are
 * explicitly excluded from every strategy.
 *
 * Paywalls CHAIN. Closing the headline offer commonly reveals a discounted
 * downsell ("or a world of creativity — ₹5"), which is a different screen with
 * its own close button. Measured on a real device, this ran its escape-control
 * search once, then — because a paywall was still detected — fell through to
 * tapping the scrim, swiping and BACK against the *new* screen, and reported the
 * paywall as undismissable while a working X sat on it. So the control search is
 * re-run for each link of the chain, and the blunt fallbacks are spent only once
 * progress has genuinely stalled.
 */
export async function escapePaywall(
  serial: string,
  appPackage: string,
  w: number,
  h: number,
): Promise<PaywallEscapeResult> {
  const attempts: string[] = [];

  /**
   * Escape succeeded once the surface no longer BLOCKS the app.
   *
   * This used to test `isPaywall`, which stays true for any screen that merely
   * mentions purchase vocabulary — a Settings row reading "Upgrade", or the
   * pricing strip a freemium home screen keeps on display. Dismissing the sheet
   * correctly and landing on such a screen therefore reported "could not
   * dismiss" every time, and the caller recorded a coverage limitation and
   * abandoned the flow it had in fact just unblocked.
   */
  const stillBlocked = async (): Promise<boolean> => {
    const xml = await dumpHierarchy(serial);
    if (!xml) return false;
    const { nodes } = parseHierarchy(xml);
    return detectPaywall(nodes, appPackage, w, h).blocking;
  };

  // 1. Explicit escape controls, re-searched for each link of the chain.
  const triedControls = new Set<string>();
  for (let link = 0; link < MAX_PAYWALL_LINKS; link++) {
    const xml = await dumpHierarchy(serial);
    if (!xml) break;
    const { nodes } = parseHierarchy(xml);
    if (!detectPaywall(nodes, appPackage, w, h).blocking) return { escaped: true, attempts };

    // Identify controls by position so the same dead control isn't tapped twice
    // across links, while a genuinely new screen's control is still eligible.
    const candidates = findEscapeControls(nodes, w, h)
      .filter((c) => !triedControls.has(`${c.bounds.left},${c.bounds.top},${c.bounds.right},${c.bounds.bottom}`));
    if (candidates.length === 0) break;

    let progressed = false;
    for (const c of candidates.slice(0, 3)) {
      const key = `${c.bounds.left},${c.bounds.top},${c.bounds.right},${c.bounds.bottom}`;
      triedControls.add(key);
      const p = centerOf(c.bounds);
      await tap(serial, p.x, p.y);
      attempts.push(`tapped "${labelOf(c) || c.resourceId || c.className}" at ${p.x},${p.y}`);
      await waitForStableUi(serial, { timeoutMs: 3_500 });
      if (!(await stillBlocked())) return { escaped: true, attempts };
      // Still a paywall — but if the SCREEN changed we advanced through the
      // chain, so re-search rather than falling back to blunt gestures.
      const afterXml = await dumpHierarchy(serial);
      if (afterXml && snapshotOf(afterXml) !== snapshotOf(xml)) { progressed = true; break; }
    }
    if (!progressed) break;
    attempts.push('paywall chain advanced — re-searching for a close control');
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
