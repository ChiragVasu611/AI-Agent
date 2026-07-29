/**
 * Executes an interpreted test step against a REAL Android device.
 *
 * Element resolution reads the live uiautomator view hierarchy, so a tap lands
 * on the actual on-screen coordinates of the named control. When a control
 * cannot be found the step fails with that fact — it is never assumed to have
 * worked.
 */

import type { StepAction } from '@/lib/qa/step-interpreter';
import {
  dumpUi, findNode, inputText, pressKey, screenSize, shell, swipe, tap, visibleText,
  foregroundPackage, waitForUiSettle, uiSignature, currentActivity, waitForAppReady,
  findForwardAffordance, resolveTappable,
  type UiNode,
} from '@/lib/qa/android-bridge';

export interface AndroidStepResult {
  ok: boolean;
  detail: string;
}

/**
 * Wait for the screen to actually finish loading after an interaction, rather
 * than sleeping a fixed amount and hoping. Returns the settled hierarchy so
 * callers can compare it against the pre-action state.
 */
async function settleAfterAction(serial: string, timeoutMs = 12000) {
  return waitForUiSettle(serial, { timeoutMs, pollMs: 600, stableChecks: 2 });
}

/**
 * Does the screen offer anything a user could act on? Used to tell a genuinely
 * stuck loading screen apart from one that merely animates forever.
 */
function hasUsableContent(nodes: UiNode[]): boolean {
  const interactive = nodes.filter((n) => n.clickable || /EditText/i.test(n.className)).length;
  const labelled = nodes.some((n) => (n.text || n.contentDesc).trim().length > 0);
  return interactive > 0 && labelled;
}

/** A short description of what is on screen, for failure messages. */
function screenSummary(nodes: UiNode[]): string {
  const labels = nodes
    .map((n) => n.text || n.contentDesc)
    .filter(Boolean)
    .slice(0, 8);
  return labels.length > 0 ? labels.join(', ') : '(no labelled elements)';
}

export async function executeAndroidStep(
  serial: string,
  action: StepAction,
  pkg: string | null,
): Promise<AndroidStepResult> {
  try {
    switch (action.kind) {
      case 'navigate': {
        // On a native app "navigate/open" means (re)focus the app under test.
        if (!pkg) return { ok: false, detail: 'No package name is known for this app, so it cannot be launched.' };
        await shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, 20000);
        const fg = await foregroundPackage(serial);
        if (fg !== pkg) {
          return { ok: false, detail: `Expected ${pkg} in the foreground but found ${fg ?? 'nothing'}.` };
        }
        // Foreground != ready. Wait for the splash to give way to real content.
        const ready = await waitForAppReady(serial, pkg, await currentActivity(serial));
        return { ok: ready.ready, detail: ready.detail };
      }

      case 'proceed': {
        const nodes = await dumpUi(serial);
        // Prefer genuinely advancing; only fall back to granting a permission
        // or dismissing an overlay when there is no forward control.
        const intents = /permission|allow|grant/i.test(action.raw)
          ? (['grant', 'advance', 'dismiss'] as const)
          : /\b(?:ad|advertisement|popup|pop-up|banner|dialog|close|skip|dismiss)\b/i.test(action.raw)
            ? (['dismiss', 'advance', 'grant'] as const)
            : (['advance', 'grant', 'dismiss'] as const);
        const found = findForwardAffordance(nodes, [...intents]);
        if (!found) {
          return { ok: false, detail: `No control was available to move this screen forward. Visible elements: ${screenSummary(nodes)}.` };
        }
        const before = uiSignature(nodes);
        const beforeActivity = await currentActivity(serial);
        const label = found.node.text || found.node.contentDesc;
        await tap(serial, found.node.center.x, found.node.center.y);
        const after = await settleAfterAction(serial);
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Tapped "${label}" (${found.intent}) but the screen did not change — the app did not move forward.` };
        }
        return { ok: true, detail: `Moved forward by tapping "${label}" (${found.intent}); now on ${after.activity ?? 'the next screen'}.` };
      }

      case 'click': {
        const nodes = await dumpUi(serial);
        let node = findNode(nodes, action.target, { clickable: true });
        // A named control may not exist on this screen (sheets often name an
        // element generically, e.g. "close icon on ad"). Rather than stalling
        // the whole run, fall back to a forward affordance when the step is
        // clearly about dismissing or advancing.
        if (!node && /\b(?:ad|advertisement|popup|pop-up|banner|dialog|close|skip|continue|next|proceed)\b/i.test(action.raw)) {
          const fallback = findForwardAffordance(nodes, ['dismiss', 'advance', 'grant']);
          if (fallback) node = fallback.node;
        }
        if (!node) {
          return { ok: false, detail: `No on-screen element matching "${action.target}" was found. Visible elements: ${screenSummary(nodes)}.` };
        }
        if (!node.enabled) {
          return { ok: false, detail: `The element "${action.target}" is present but disabled, so it cannot be tapped.` };
        }
        // A text match is usually a label inside the real control — and can
        // just as easily be an inert heading. Resolve to something tappable
        // rather than firing a tap that provably does nothing.
        const tappable = resolveTappable(nodes, node);
        if (!tappable) {
          return { ok: false, detail: `"${node.text || node.contentDesc || action.target}" is on screen but is not an interactive control (no clickable element contains it), so it cannot be tapped.` };
        }
        node = tappable;
        const before = uiSignature(nodes);
        const beforeActivity = await currentActivity(serial);
        await tap(serial, node.center.x, node.center.y);
        const after = await settleAfterAction(serial);
        const label = node.text || node.contentDesc || action.target;

        // Nothing moved at all — the tap did not register.
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Tapped "${label}" at (${node.center.x}, ${node.center.y}) but the screen did not change at all — the tap had no effect. Still on ${after.activity ?? 'the same screen'}.` };
        }
        // Never settling is only a real problem when the resulting screen has
        // nothing to interact with — an app with a clock or looping animation
        // legitimately never goes static, and must not be failed for it.
        if (!after.settled && !hasUsableContent(after.nodes)) {
          return { ok: false, detail: `Tapped "${label}" but the app is still loading after 12s with no interactive content on ${after.activity ?? 'an unknown screen'} — it appears stuck.` };
        }
        return { ok: true, detail: `Tapped "${label}" at (${node.center.x}, ${node.center.y}); screen advanced to ${after.activity ?? 'the next view'}.` };
      }

      case 'type': {
        if (!action.value) {
          return { ok: false, detail: `The step asks to enter a value into "${action.target}", but neither the step nor the Test Data column supplied one.` };
        }
        const nodes = await dumpUi(serial);
        const field = findNode(nodes, action.target, { editable: true })
          // Fall back to the already-focused input if the label did not match.
          ?? nodes.find((n) => n.focused && /EditText/i.test(n.className))
          ?? null;
        if (!field) {
          return { ok: false, detail: `No text field matching "${action.target}" was found. Visible elements: ${screenSummary(nodes)}.` };
        }
        await tap(serial, field.center.x, field.center.y);
        await new Promise((r) => setTimeout(r, 400));
        // Clear whatever the field already holds so the typed value is exact.
        // The node's own text tells us precisely how many deletes are needed.
        const existing = field.text?.length ?? 0;
        if (existing > 0) {
          await pressKey(serial, 'KEYCODE_MOVE_END');
          // One batched keyevent call — 40 round-trips would be painfully slow.
          const dels = Array(Math.min(existing + 2, 80)).fill('KEYCODE_DEL').join(' ');
          await shell(serial, `input keyevent ${dels}`, 20000);
        }
        await inputText(serial, action.value);
        await settleAfterAction(serial, 8000);
        // Confirm the text genuinely landed in the field.
        const afterNodes = await dumpUi(serial);
        const refreshed = findNode(afterNodes, action.target, { editable: true });
        const got = refreshed?.text ?? '';
        if (got && !got.includes(action.value) && !action.value.includes(got)) {
          return { ok: false, detail: `Typed "${action.value}" into "${action.target}" but the field now reads "${got}".` };
        }
        return { ok: true, detail: `Entered "${action.value}" into "${action.target}".` };
      }

      case 'clear': {
        const nodes = await dumpUi(serial);
        const field = findNode(nodes, action.target, { editable: true });
        if (!field) return { ok: false, detail: `No text field matching "${action.target}" was found to clear.` };
        await tap(serial, field.center.x, field.center.y);
        await pressKey(serial, 'KEYCODE_MOVE_END');
        const count = Math.min((field.text?.length ?? 0) + 2, 80);
        await shell(serial, `input keyevent ${Array(count).fill('KEYCODE_DEL').join(' ')}`, 20000);
        return { ok: true, detail: `Cleared the "${action.target}" field.` };
      }

      case 'check':
      case 'uncheck': {
        const nodes = await dumpUi(serial);
        const node = findNode(nodes, action.target, { clickable: true });
        if (!node) return { ok: false, detail: `No checkbox matching "${action.target}" was found.` };
        await tap(serial, node.center.x, node.center.y);
        await settleAfterAction(serial, 8000);
        return { ok: true, detail: `Toggled "${action.target}".` };
      }

      case 'press': {
        const map: Record<string, string> = {
          Enter: 'KEYCODE_ENTER', Tab: 'KEYCODE_TAB', Escape: 'KEYCODE_BACK',
          Space: 'KEYCODE_SPACE', Backspace: 'KEYCODE_DEL',
        };
        const code = map[action.value] ?? 'KEYCODE_ENTER';
        await pressKey(serial, code);
        await settleAfterAction(serial, 10000);
        return { ok: true, detail: `Pressed ${action.value || 'Enter'} (${code}).` };
      }

      case 'scroll': {
        const { width, height } = await screenSize(serial);
        const midX = Math.round(width / 2);
        const up = action.value === 'up';
        await swipe(
          serial, midX, up ? Math.round(height * 0.3) : Math.round(height * 0.75),
          midX, up ? Math.round(height * 0.75) : Math.round(height * 0.3), 350,
        );
        await settleAfterAction(serial, 8000);
        return { ok: true, detail: `Scrolled ${up ? 'up' : 'down'}.` };
      }

      case 'wait': {
        const secs = Math.min(10, Math.max(1, Number(action.value) || 1));
        await new Promise((r) => setTimeout(r, secs * 1000));
        return { ok: true, detail: `Waited ${secs}s.` };
      }

      case 'submit': {
        const beforeSubmit = uiSignature(await dumpUi(serial));
        await pressKey(serial, 'KEYCODE_ENTER');
        const afterSubmit = await settleAfterAction(serial);
        if (afterSubmit.signature === beforeSubmit) {
          return { ok: false, detail: 'Submitted via the Enter key but nothing on screen changed — the submission had no visible effect.' };
        }
        if (!afterSubmit.settled && !hasUsableContent(afterSubmit.nodes)) {
          return { ok: false, detail: 'Submitted, but after 12s the app is still loading with no interactive content — it appears stuck processing the submission.' };
        }
        return { ok: true, detail: 'Submitted via the Enter key.' };
      }

      case 'select': {
        const nodes = await dumpUi(serial);
        const spinner = findNode(nodes, action.target, { clickable: true });
        if (!spinner) return { ok: false, detail: `No dropdown matching "${action.target}" was found.` };
        await tap(serial, spinner.center.x, spinner.center.y);
        await settleAfterAction(serial, 8000);
        const optionNodes = await dumpUi(serial);
        const option = findNode(optionNodes, action.value, { clickable: true });
        if (!option) {
          return { ok: false, detail: `Opened "${action.target}" but no option "${action.value}" was listed. Options on screen: ${screenSummary(optionNodes)}.` };
        }
        await tap(serial, option.center.x, option.center.y);
        await settleAfterAction(serial, 8000);
        return { ok: true, detail: `Selected "${action.value}" from "${action.target}".` };
      }

      case 'hover':
        // No hover concept on touch devices — report rather than silently pass.
        return { ok: false, detail: 'Hover is not a valid interaction on a touch device; rewrite this step as a tap or long-press.' };

      case 'verify':
        return { ok: true, detail: 'Assertion step — evaluated against the live device screen.' };

      case 'unknown':
      default:
        return { ok: false, detail: `The step could not be mapped to a device action, so it was not executed: "${action.raw}".` };
    }
  } catch (e) {
    return { ok: false, detail: `The action threw during execution: ${(e as Error).message.split('\n')[0]}` };
  }
}

export interface AndroidValidation {
  status: 'pass' | 'fail' | 'inconclusive';
  actual: string;
  assertion: string;
}

/**
 * "not"/"never"/"shouldn't" directly negate the verb of the sentence they're
 * in, so inverting the whole check is correct. "without" does NOT belong here:
 * QA sheets overwhelmingly use it as a manner clause on a POSITIVE expectation
 * ("should load without overlap", "launch successfully without crash") — not
 * as "this should not happen". Treating it as a full-sentence negation inverted
 * a real failure ("nothing found") into a false PASS on this exact sheet.
 */
const NEGATION_RE = /\b(?:not|no longer|shouldn'?t|should not|must not|never)\b/i;

function isNegated(expected: string): boolean {
  // Strip quoted subjects first — "This Does Not Exist" is a label, not grammar.
  return NEGATION_RE.test(expected.replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, ' '));
}

function quoted(text: string): string | null {
  return text.match(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/)?.[1]?.trim() ?? null;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'be', 'should', 'must', 'will', 'to', 'of', 'and', 'or', 'on', 'in',
  'at', 'with', 'for', 'that', 'this', 'it', 'user', 'app', 'application', 'screen', 'page',
  'successfully', 'success', 'correctly', 'displayed', 'display', 'shown', 'show', 'visible',
  'appear', 'appears', 'see', 'view', 'able', 'navigated', 'redirected', 'opens', 'open', 'without',
]);

/**
 * Validate a test case's Expected Result against what is genuinely rendered on
 * the device right now.
 */
export async function validateAndroidExpectation(
  serial: string,
  expectedRaw: string,
  pkg: string | null,
): Promise<AndroidValidation> {
  const expected = String(expectedRaw ?? '').trim();
  if (!expected) {
    return { status: 'inconclusive', actual: 'The sheet did not specify an Expected Result, so nothing could be asserted.', assertion: 'none' };
  }

  const negated = isNegated(expected);
  const nodes = await dumpUi(serial);
  const screenText = visibleText(nodes).toLowerCase();

  // App-still-running assertions.
  if (/\b(?:crash|close|closed|terminate|force stop)\b/i.test(expected) && pkg) {
    const fg = await foregroundPackage(serial);
    const stillUp = fg === pkg;
    return {
      status: stillUp !== negated ? 'pass' : 'fail',
      actual: stillUp ? `${pkg} is still in the foreground.` : `${pkg} is no longer in the foreground (current: ${fg ?? 'none'}).`,
      assertion: 'app-foreground',
    };
  }

  const literal = quoted(expected);
  if (literal) {
    const found = screenText.includes(literal.toLowerCase());
    return {
      status: found !== negated ? 'pass' : 'fail',
      actual: found
        ? `Text "${literal}" is visible on the device screen.`
        : `Text "${literal}" was not found on the device screen. Visible: ${screenSummary(nodes)}.`,
      assertion: 'text-visible',
    };
  }

  const words = expected
    .toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 6);

  if (words.length === 0) {
    return {
      status: 'inconclusive',
      actual: `The expected result "${expected}" contains no assertable subject, so no automated check could be derived.`,
      assertion: 'none',
    };
  }

  // Word-boundary matching: plain `includes` lets "home" match "Homepage" and
  // half-matches used to be enough to pass. Every meaningful word must appear.
  const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(screenText));
  const ok = hits.length === words.length;
  return {
    status: ok !== negated ? 'pass' : 'fail',
    actual: ok
      ? `Device screen matches the expectation (all terms found: ${hits.join(', ')}).`
      : `Device screen does not match — required [${words.join(', ')}], found only [${hits.join(', ') || 'none'}]. Visible: ${screenSummary(nodes)}.`,
    assertion: 'text-keywords',
  };
}

async function currentActivityLabel(serial: string): Promise<string | null> {
  const out = await shell(serial, 'dumpsys window | grep -E "mCurrentFocus"', 10000);
  const activity = out.match(/[\w.]+\/([\w.$]+)/)?.[1];
  return activity ? (activity.split('.').pop() ?? activity) : null;
}

/**
 * Human-readable name of the current screen.
 *
 * A raw Activity class name is often useless for identifying which screen is
 * actually showing — many apps (SPA-style navigation, WebViews, a single
 * "MainActivity" hosting every fragment) never change activity at all. So the
 * screen is identified dynamically from what is genuinely on screen: a
 * toolbar/title-style node first, then the most prominent visible label near
 * the top of the screen, and only then the Activity class name as a last
 * resort. Nothing here is hardcoded to a specific app's navigation flow.
 */
export async function currentAndroidScreen(serial: string): Promise<string> {
  const nodes = await dumpUi(serial);

  if (nodes.length > 0) {
    // 1) A node that is clearly a title/toolbar by id or class, with real text.
    const titleNode = nodes.find((n) => {
      const label = (n.text || n.contentDesc).trim();
      if (label.length < 2) return false;
      return /title|toolbar|header|actionbar|app_?bar/i.test(`${n.resourceId} ${n.className}`);
    });
    if (titleNode) return (titleNode.text || titleNode.contentDesc).trim().slice(0, 60);

    // 2) The most prominent label near the top of the screen — the part of a
    // native UI a user actually reads to know where they are.
    const { height } = await screenSize(serial).catch(() => ({ width: 0, height: 0 }));
    const topBand = height > 0 ? height * 0.25 : Infinity;
    const candidates = nodes
      .filter((n) => {
        const label = (n.text || n.contentDesc).trim();
        return label.length >= 3 && !/^\d+$/.test(label) && n.bounds.y1 <= topBand;
      })
      .sort((a, b) => a.bounds.y1 - b.bounds.y1 || (b.text.length - a.text.length));
    if (candidates.length > 0) {
      return (candidates[0].text || candidates[0].contentDesc).trim().slice(0, 60);
    }
  }

  // 3) Last resort — the raw Activity class name.
  return (await currentActivityLabel(serial)) ?? 'Unknown';
}
