import type { Interaction, ScreenState, UiNode } from './types';
import {
  centerOf, describeNode, isEditable, isToggle, isScrollableNode,
  labelOf, shortId, width as bw, height as bh,
} from './ui-parser';
import {
  tap, longPress, doubleTap, swipe, inputText, clearText, pressKey, setRotation, KEY,
} from './device';
import { waitForStableUi } from './smart-wait';
import { isAdNode } from './ad-detector';

/**
 * Interaction planning and execution.
 *
 * The planner enumerates every gesture the LIVE hierarchy makes available on
 * the current screen and ranks them by exploration value. Nothing is
 * hardcoded: targets come from the dump, coordinates are computed from each
 * element's own bounds, and text input is generated from the field's detected
 * semantics. Destructive controls are deprioritised so a single run cannot
 * wipe the app's state before the rest of it has been explored.
 */

/** Controls that end the session or destroy data — explored last, or not at all. */
const DESTRUCTIVE = /\b(log ?out|sign out|delete account|delete all|erase|reset|clear data|remove account|unsubscribe|deactivate)\b/i;
/** Controls that leave the app entirely. */
const EXTERNAL = /\b(rate (us|app)|share|open in browser|visit website|contact us|privacy policy|terms|follow us|more apps)\b/i;
/** Purchase controls — never auto-tapped; the engine must not spend money. */
const PURCHASE = /\b(subscribe|buy|purchase|upgrade|start (free )?trial|continue for|pay now|checkout)\b/i;

/** Sample values by field role, so forms can be exercised without real data. */
const SAMPLE = {
  email: 'qa.tester@example.com',
  phone: '5555550123',
  otp: '123456',
  number: '42',
  text: 'QA test input',
};

export function actionKey(screenSig: string, kind: string, node?: UiNode, extra = ''): string {
  const id = node
    ? `${node.className.split('.').pop()}:${shortId(node) || labelOf(node).slice(0, 24) || `${node.bounds.left},${node.bounds.top}`}`
    : 'screen';
  return `${screenSig}|${kind}|${id}${extra ? `|${extra}` : ''}`;
}

function sampleFor(node: UiNode): string {
  const hay = `${shortId(node)} ${node.contentDesc} ${node.text}`.toLowerCase();
  if (node.password) return 'QaTest!2345';
  if (/e-?mail/.test(hay)) return SAMPLE.email;
  if (/phone|mobile/.test(hay)) return SAMPLE.phone;
  if (/otp|code|pin/.test(hay)) return SAMPLE.otp;
  if (/number|qty|quantity|amount|age/.test(hay)) return SAMPLE.number;
  return SAMPLE.text;
}

/**
 * Enumerates candidate interactions for the current screen, best-first.
 * `skipPurchase` keeps the engine away from real billing flows.
 */
export function planInteractions(
  state: ScreenState,
  opts: { allowPurchase?: boolean; appPackage?: string } = {},
): Interaction[] {
  const out: Interaction[] = [];
  const sig = state.signature;
  const seen = new Set<string>();

  const push = (i: Interaction) => {
    if (seen.has(i.key)) return;
    seen.add(i.key);
    out.push(i);
  };

  // Only ever target elements that belong to the app under test. This keeps the
  // agent from tapping the status bar, the navigation bar, an ad SDK's chrome,
  // or content owned by another app — the root cause of "performing actions
  // outside the application". A node with no package is treated as in-app
  // (some custom views report an empty package).
  const inApp = (n: UiNode): boolean => {
    if (!opts.appPackage) return true;
    const p = n.packageName || '';
    return p === '' || p.startsWith(opts.appPackage);
  };

  const visible = state.nodes.filter(
    (n) => n.enabled
      && inApp(n)
      // Never interact with an ad surface: tapping a banner/native ad opens the
      // advertiser's browser or store page and takes the run out of the app.
      && !isAdNode(n)
      && bw(n.bounds) > 0 && bh(n.bounds) > 0
      && n.bounds.top < state.screenHeight && n.bounds.bottom > 0,
  );

  // 1. Text fields first — forms must be filled before their submit is useful.
  for (const n of visible.filter(isEditable)) {
    push({
      kind: 'type',
      target: n,
      text: sampleFor(n),
      key: actionKey(sig, 'type', n),
      reason: `Fill input "${describeNode(n)}"`,
    });
  }

  // 2. Toggles and checkboxes — cheap state changes with high signal.
  for (const n of visible.filter((x) => isToggle(x) && x.enabled)) {
    push({
      kind: 'toggle',
      target: n,
      key: actionKey(sig, 'toggle', n),
      reason: `Toggle "${describeNode(n)}"`,
    });
  }

  // 3. Clickable elements, ranked: safe navigation first, risky last.
  const clickables = visible.filter((n) => n.clickable && n.enabled);
  const ranked = clickables
    .map((n) => {
      const label = labelOf(n);
      let score = 10;
      if (DESTRUCTIVE.test(label)) score -= 30;
      if (EXTERNAL.test(label)) score -= 12;
      if (PURCHASE.test(label)) score -= 25;
      if (label.length > 0) score += 3;             // labelled controls are meaningful
      if (/Button|TextView|ImageButton/i.test(n.className)) score += 2;
      if (n.bounds.top < state.screenHeight * 0.15) score += 1; // toolbars/tabs
      return { n, score, label };
    })
    // Never tap controls that leave the app (share sheets, "open in browser",
    // "rate us", website/social links) or purchase controls — they take the
    // agent out of the app under test.
    .filter(({ label }) => (opts.allowPurchase || !PURCHASE.test(label)) && !EXTERNAL.test(label))
    .sort((a, b) => b.score - a.score);

  for (const { n } of ranked) {
    push({
      kind: 'tap',
      target: n,
      key: actionKey(sig, 'tap', n),
      reason: `Tap "${describeNode(n)}"`,
    });
  }

  // 4. Scrolling containers — reveals off-screen content that adds new actions.
  for (const n of visible.filter(isScrollableNode)) {
    push({
      kind: 'swipe_up',
      target: n,
      key: actionKey(sig, 'swipe_up', n),
      reason: `Scroll down inside "${describeNode(n)}"`,
    });
    push({
      kind: 'swipe_left',
      target: n,
      key: actionKey(sig, 'swipe_left', n),
      reason: `Scroll horizontally inside "${describeNode(n)}"`,
    });
  }

  // 5. Long-press on long-clickable elements (context menus).
  for (const n of visible.filter((x) => x.longClickable && x.enabled).slice(0, 6)) {
    push({
      kind: 'long_press',
      target: n,
      key: actionKey(sig, 'long_press', n),
      reason: `Long-press "${describeNode(n)}"`,
    });
  }

  // 6. Navigation drawer — a swipe from the left edge, only when a drawer exists.
  if (state.nodes.some((n) => /DrawerLayout|NavigationView/i.test(n.className))) {
    push({
      kind: 'swipe_right',
      key: actionKey(sig, 'open_drawer'),
      reason: 'Open the navigation drawer',
    });
  }

  return out;
}

export interface ExecutionResult {
  ok: boolean;
  note: string;
}

/** Executes one planned interaction against the device. */
export async function executeInteraction(
  serial: string,
  state: ScreenState,
  action: Interaction,
): Promise<ExecutionResult> {
  const { target } = action;
  const w = state.screenWidth;
  const h = state.screenHeight;

  try {
    switch (action.kind) {
      case 'tap': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await tap(serial, p.x, p.y);
        return { ok: true, note: `tap(${p.x},${p.y})` };
      }
      case 'toggle': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await tap(serial, p.x, p.y);
        return { ok: true, note: `toggle(${p.x},${p.y})` };
      }
      case 'double_tap': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await doubleTap(serial, p.x, p.y);
        return { ok: true, note: `doubleTap(${p.x},${p.y})` };
      }
      case 'long_press': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await longPress(serial, p.x, p.y);
        return { ok: true, note: `longPress(${p.x},${p.y})` };
      }
      case 'type': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await tap(serial, p.x, p.y);
        await inputText(serial, action.text ?? SAMPLE.text);
        await pressKey(serial, KEY.ESCAPE); // close IME so layout returns to normal
        return { ok: true, note: `type("${action.text}")` };
      }
      case 'clear': {
        if (!target) return { ok: false, note: 'No target' };
        const p = centerOf(target.bounds);
        await tap(serial, p.x, p.y);
        await clearText(serial);
        return { ok: true, note: 'clear()' };
      }
      case 'swipe_up': {
        // Scroll within the target's own bounds, not the whole screen.
        const b = target?.bounds ?? { left: 0, top: 0, right: w, bottom: h };
        const cx = Math.round((b.left + b.right) / 2);
        const y1 = Math.round(b.top + (b.bottom - b.top) * 0.75);
        const y2 = Math.round(b.top + (b.bottom - b.top) * 0.25);
        await swipe(serial, cx, y1, cx, y2, 320);
        return { ok: true, note: `swipeUp(${cx}: ${y1}→${y2})` };
      }
      case 'swipe_down': {
        const b = target?.bounds ?? { left: 0, top: 0, right: w, bottom: h };
        const cx = Math.round((b.left + b.right) / 2);
        const y1 = Math.round(b.top + (b.bottom - b.top) * 0.25);
        const y2 = Math.round(b.top + (b.bottom - b.top) * 0.75);
        await swipe(serial, cx, y1, cx, y2, 320);
        return { ok: true, note: `swipeDown(${cx}: ${y1}→${y2})` };
      }
      case 'swipe_left': {
        const b = target?.bounds ?? { left: 0, top: 0, right: w, bottom: h };
        const cy = Math.round((b.top + b.bottom) / 2);
        const x1 = Math.round(b.left + (b.right - b.left) * 0.8);
        const x2 = Math.round(b.left + (b.right - b.left) * 0.2);
        await swipe(serial, x1, cy, x2, cy, 300);
        return { ok: true, note: `swipeLeft(${cy}: ${x1}→${x2})` };
      }
      case 'swipe_right': {
        // Edge swipe opens a drawer; in-element swipe scrolls back.
        const b = target?.bounds;
        if (b) {
          const cy = Math.round((b.top + b.bottom) / 2);
          await swipe(serial, Math.round(b.left + (b.right - b.left) * 0.2), cy, Math.round(b.left + (b.right - b.left) * 0.8), cy, 300);
          return { ok: true, note: 'swipeRight(element)' };
        }
        const cy = Math.round(h / 2);
        await swipe(serial, 4, cy, Math.round(w * 0.7), cy, 320);
        return { ok: true, note: 'edgeSwipeRight(drawer)' };
      }
      case 'back': {
        await pressKey(serial, KEY.BACK);
        return { ok: true, note: 'BACK' };
      }
      case 'home': {
        await pressKey(serial, KEY.HOME);
        return { ok: true, note: 'HOME' };
      }
      case 'rotate': {
        await setRotation(serial, action.text === 'landscape');
        return { ok: true, note: `rotate(${action.text})` };
      }
      case 'scroll_into_view': {
        const cx = Math.round(w / 2);
        await swipe(serial, cx, Math.round(h * 0.7), cx, Math.round(h * 0.3), 300);
        return { ok: true, note: 'scrollIntoView' };
      }
      default:
        return { ok: false, note: `Unsupported interaction: ${action.kind}` };
    }
  } catch (e) {
    return { ok: false, note: `Interaction error: ${(e as Error)?.message}` };
  }
}

/** Executes an interaction and waits — adaptively — for the UI to settle. */
export async function performAndSettle(
  serial: string,
  state: ScreenState,
  action: Interaction,
): Promise<ExecutionResult> {
  const res = await executeInteraction(serial, state, action);
  if (res.ok) await waitForStableUi(serial, { timeoutMs: 6_000 });
  return res;
}
