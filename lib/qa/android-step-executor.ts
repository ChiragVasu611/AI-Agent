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
  findForwardAffordance, resolveTappable, waitForUiChange,
  type UiNode,
} from '@/lib/qa/android-bridge';

export interface AndroidStepResult {
  ok: boolean;
  detail: string;
  /**
   * Screen state either side of the interaction, when the branch computed it.
   * Lets an Expected Result like "user should move to Onboarding 2" be asserted
   * on whether the screen genuinely advanced, rather than by hunting for the
   * words "user"/"move" in the on-screen text.
   */
  beforeSignature?: string;
  beforeActivity?: string | null;
  afterSignature?: string;
  afterActivity?: string | null;
}

/**
 * Wait for the screen to actually finish loading after an interaction, rather
 * than sleeping a fixed amount and hoping. Returns the settled hierarchy so
 * callers can compare it against the pre-action state.
 */
async function settleAfterAction(serial: string, timeoutMs = 12000) {
  return waitForUiSettle(serial, { timeoutMs });
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
        const transition = {
          beforeSignature: before, beforeActivity,
          afterSignature: after.signature, afterActivity: after.activity,
        };
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Tapped "${label}" (${found.intent}) but the screen did not change — the app did not move forward.`, ...transition };
        }
        return { ok: true, detail: `Moved forward by tapping "${label}" (${found.intent}); now on ${after.activity ?? 'the next screen'}.`, ...transition };
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

        const transition = {
          beforeSignature: before, beforeActivity,
          afterSignature: after.signature, afterActivity: after.activity,
        };
        // Nothing moved at all — the tap did not register.
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Tapped "${label}" at (${node.center.x}, ${node.center.y}) but the screen did not change at all — the tap had no effect. Still on ${after.activity ?? 'the same screen'}.`, ...transition };
        }
        // Never settling is only a real problem when the resulting screen has
        // nothing to interact with — an app with a clock or looping animation
        // legitimately never goes static, and must not be failed for it.
        if (!after.settled && !hasUsableContent(after.nodes)) {
          return { ok: false, detail: `Tapped "${label}" but the app is still loading after 12s with no interactive content on ${after.activity ?? 'an unknown screen'} — it appears stuck.`, ...transition };
        }
        return { ok: true, detail: `Tapped "${label}" at (${node.center.x}, ${node.center.y}); screen advanced to ${after.activity ?? 'the next view'}.`, ...transition };
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
        // Proceed as soon as the field takes focus (keyboard/cursor changes the
        // hierarchy) rather than always pausing for the worst case.
        await waitForUiChange(serial, uiSignature(nodes), 900);
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
        const midY = Math.round(height / 2);
        const dir = action.value === 'up' || action.value === 'left' || action.value === 'right'
          ? action.value : 'down';
        // Horizontal gestures are how carousels and template rails are browsed;
        // a vertical-only swipe silently did nothing on those screens.
        const path = dir === 'left'
          ? [Math.round(width * 0.8), midY, Math.round(width * 0.2), midY]
          : dir === 'right'
            ? [Math.round(width * 0.2), midY, Math.round(width * 0.8), midY]
            : dir === 'up'
              ? [midX, Math.round(height * 0.3), midX, Math.round(height * 0.75)]
              : [midX, Math.round(height * 0.75), midX, Math.round(height * 0.3)];
        await swipe(serial, path[0], path[1], path[2], path[3], 350);
        await settleAfterAction(serial, 8000);
        return { ok: true, detail: `Swiped ${dir}.` };
      }

      case 'volume': {
        // A genuine hardware key press, repeated so the change is audible
        // rather than a single imperceptible increment.
        const code = action.value === 'down' ? 'KEYCODE_VOLUME_DOWN' : 'KEYCODE_VOLUME_UP';
        await shell(serial, `input keyevent ${Array(5).fill(code).join(' ')}`, 20000);
        return { ok: true, detail: `Pressed ${code} five times to turn the volume ${action.value === 'down' ? 'down' : 'up'}.` };
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

/**
 * Interrogative idioms that contain "not" but assert nothing either way:
 * "check if the button is cut off or not", "verify the icon is true or false".
 * These are the sheet asking *whether*, not asserting a negative — so they must
 * never flip the verdict. Left in, "...is cut off or not" inverted a genuine
 * "element not found" failure into a PASS.
 */
/**
 * Global on purpose: a single sheet step routinely asks twice ("check the button
 * is cut off or not and also check the GIF loads or not"). Stripping only the
 * first phrase leaves a stray "not" behind, which reads as a negation and
 * inverts a genuine failure into a PASS. Used only with .replace(), never
 * .test(), because a /g regex carries lastIndex between test() calls.
 */
const INTERROGATIVE_RE = /\b(?:or\s+not|whether(?:\s+or\s+not)?|true\s+or\s+false|yes\s+or\s+no)\b/gi;

function isNegated(expected: string): boolean {
  // Strip quoted subjects first — "This Does Not Exist" is a label, not grammar.
  const bare = expected.replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, ' ');
  // Remove interrogative idioms before looking for a real negation, so the
  // "not" inside "or not" cannot be mistaken for one.
  const withoutIdioms = bare.replace(INTERROGATIVE_RE, ' ');
  return NEGATION_RE.test(withoutIdioms);
}

function quoted(text: string): string | null {
  return text.match(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/)?.[1]?.trim() ?? null;
}

/**
 * Words that describe the *act of testing* or generic UI furniture rather than
 * anything that could literally be rendered on screen. A sheet writes "Title,
 * description and Next button should display" — the words "title",
 * "description" and "button" are describing the layout, they are not label text
 * to search for. Requiring them verbatim is what made almost every case fail.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'be', 'been', 'was', 'were', 'should', 'must', 'will', 'would',
  'can', 'could', 'to', 'of', 'and', 'or', 'on', 'in', 'at', 'with', 'for', 'from', 'that', 'this',
  'it', 'its', 'they', 'them', 'their', 'user', 'users', 'app', 'application', 'screen', 'page',
  'view', 'successfully', 'success', 'correctly', 'correct', 'properly', 'proper', 'perfectly',
  'displayed', 'display', 'displays', 'shown', 'show', 'shows', 'visible', 'appear', 'appears',
  'appere', 'see', 'watch', 'able', 'navigated', 'redirected', 'opens', 'open', 'without', 'any',
  'issues', 'issue', 'also', 'again', 'after', 'before', 'then', 'when', 'while', 'each', 'every',
  // The act of testing — never on-screen text.
  'verify', 'verified', 'check', 'checked', 'validate', 'validated', 'assert', 'confirm', 'ensure',
  'observe', 'expect', 'expected', 'test', 'testing',
  // Generic UI furniture / layout vocabulary.
  'title', 'titles', 'description', 'descriptions', 'button', 'buttons', 'btn', 'icon', 'icons',
  'image', 'images', 'text', 'texts', 'label', 'labels', 'ui', 'element', 'elements', 'control',
  'field', 'layout', 'design', 'content',
  // Lifecycle / motion verbs that describe behaviour, not labels.
  'launch', 'launches', 'launched', 'launching', 'load', 'loads', 'loaded', 'loading', 'laod',
  'move', 'moves', 'moved', 'stay', 'stays', 'work', 'works', 'working', 'function', 'functions',
  'play', 'plays', 'playing', 'scroll', 'scrolls', 'scrollable', 'slide', 'slides', 'select',
  'selected', 'selection', 'randomly', 'random', 'click', 'clicking', 'clickable', 'tap', 'time',
  'configured', 'automatically', 'smoothly', 'easily', 'directly', 'first', 'next', 'cut', 'off',
  'stuck', 'crash', 'crashing', 'crashes', 'close', 'closed', 'name', 'names',
]);

/**
 * Claims about qualities a UI hierarchy simply does not expose: video playback,
 * audio, animation smoothness, elapsed timing, and pixel-level visual defects.
 * These are honestly reported as not-machine-verifiable rather than guessed —
 * asserting them either way would be fabricating a result.
 */
const UNVERIFIABLE_RE = /\b(?:video|audio|sound|audible|volume|gif|animation|animate|smooth(?:ly)?|duration|second|seconds|fps|frame\s*rate|blurry|overlap|cut\s*off|pixel|colour|color\s+(?:match|correct))\b/i;

/** Structural claims that CAN be checked against the live hierarchy. */
const SCROLLABLE_RE = /\bscroll(?:able|ing)?\b/i;
const PROGRESSION_RE = /\b(?:move|moves|moved|navigate[ds]?|redirect(?:ed)?|go(?:es)?\s+to|proceed|next\s+screen|following\s+screen|new\s+screen|should\s+appear|should\s+open)\b/i;
const CLICKABLE_CLAIM_RE = /\b(?:clickable|tappable|enabled|be\s+able\s+to\s+(?:click|tap|press))\b/i;

export interface ValidationContext {
  /** UI signature captured immediately before the step ran, for progression. */
  beforeSignature?: string;
  beforeActivity?: string | null;
  /** Signature/activity after the step settled. */
  afterSignature?: string;
  afterActivity?: string | null;
}

interface ClauseVerdict {
  status: 'pass' | 'fail' | 'inconclusive';
  detail: string;
  assertion: string;
}

/** Split "1. foo\n2. bar" or "foo, and bar" into independently checkable claims. */
function splitClauses(expected: string): string[] {
  const byNumber = expected
    .split(/(?:^|\n)\s*\d+[.)]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byNumber.length > 1) return byNumber;
  return [expected.trim()];
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Validate a test case's Expected Result against what is genuinely rendered on
 * the device right now.
 */
export async function validateAndroidExpectation(
  serial: string,
  expectedRaw: string,
  pkg: string | null,
  context: ValidationContext = {},
): Promise<AndroidValidation> {
  const expected = String(expectedRaw ?? '').trim();
  if (!expected) {
    return { status: 'inconclusive', actual: 'The sheet did not specify an Expected Result, so nothing could be asserted.', assertion: 'none' };
  }

  const nodes = await dumpUi(serial);
  const screenText = visibleText(nodes).toLowerCase();
  const fg = pkg ? await foregroundPackage(serial) : null;

  const verdicts: ClauseVerdict[] = [];
  for (const clause of splitClauses(expected)) {
    verdicts.push(await evaluateClause(clause, { serial, nodes, screenText, pkg, fg, context }));
  }

  // A definitive failure anywhere means the expected result was not met. Only
  // when nothing failed and at least one clause was genuinely verified is the
  // whole expectation a PASS — an all-inconclusive expectation is never
  // upgraded to PASS, because nothing about it was actually proven.
  const failed = verdicts.filter((v) => v.status === 'fail');
  const passed = verdicts.filter((v) => v.status === 'pass');
  const unknown = verdicts.filter((v) => v.status === 'inconclusive');
  const describe = (list: ClauseVerdict[]) => list.map((v) => v.detail).join(' ');

  if (failed.length > 0) {
    return {
      status: 'fail',
      actual: describe(failed) + (passed.length > 0 ? ` (Verified separately: ${describe(passed)})` : ''),
      assertion: failed.map((v) => v.assertion).join('+'),
    };
  }
  if (passed.length > 0) {
    return {
      status: 'pass',
      actual: describe(passed) + (unknown.length > 0 ? ` Not machine-verifiable: ${describe(unknown)}` : ''),
      assertion: passed.map((v) => v.assertion).join('+'),
    };
  }
  return {
    status: 'inconclusive',
    actual: describe(unknown),
    assertion: unknown.map((v) => v.assertion).join('+') || 'none',
  };
}

/**
 * Evaluate one claim from an Expected Result against the live screen, choosing
 * the assertion class from the claim's own wording. Nothing here encodes a
 * specific app's screens or flow — every check reads the live hierarchy.
 */
async function evaluateClause(
  clause: string,
  ctx: {
    serial: string; nodes: UiNode[]; screenText: string;
    pkg: string | null; fg: string | null; context: ValidationContext;
  },
): Promise<ClauseVerdict> {
  const { nodes, screenText, pkg, fg, context } = ctx;
  const negated = isNegated(clause);

  // 1) Crash / app-alive claims. Stemmed, so "crashing" and "crashes" match too
  //    — an unstemmed \bcrash\b missed "without crashing" and fell through to
  //    keyword matching, which then demanded the word "crashing" on screen.
  if (/\b(?:crash\w*|terminate\w*|force[\s-]?stop\w*|close[ds]?|exit\w*)\b/i.test(clause) && pkg) {
    const stillUp = fg === pkg;
    // "should launch without crashing" is satisfied by the app being alive;
    // the negation is on "crashing", so a live app is the positive outcome.
    return {
      status: stillUp ? 'pass' : 'fail',
      detail: stillUp
        ? `The application is running in the foreground (${pkg}) with no crash.`
        : `The application is not in the foreground (current: ${fg ?? 'none'}), so it did not stay running.`,
      assertion: 'app-foreground',
    };
  }

  // 2) A quoted literal is the one thing a sheet states unambiguously.
  const literal = quoted(clause);
  if (literal) {
    const found = screenText.includes(literal.toLowerCase());
    return {
      status: found !== negated ? 'pass' : 'fail',
      detail: found
        ? `Text "${literal}" is visible on screen.`
        : `Text "${literal}" was not found on screen. Visible: ${screenSummary(nodes)}.`,
      assertion: 'text-visible',
    };
  }

  // 3) Progression claims ("user should move to Onboarding 2"): the provable
  //    part is that the screen actually advanced.
  if (PROGRESSION_RE.test(clause) && context.beforeSignature !== undefined) {
    const changed = context.afterSignature !== context.beforeSignature
      || context.afterActivity !== context.beforeActivity;
    return {
      status: changed !== negated ? 'pass' : 'fail',
      detail: changed
        ? `The screen advanced after the interaction (now showing: ${screenSummary(nodes)}).`
        : `The screen did not change after the interaction, so no navigation occurred. Still showing: ${screenSummary(nodes)}.`,
      assertion: 'screen-progressed',
    };
  }

  // 4) Scrollability is a real hierarchy attribute.
  if (SCROLLABLE_RE.test(clause) && !UNVERIFIABLE_RE.test(clause)) {
    const scrollable = nodes.some((n) => n.scrollable);
    return {
      status: scrollable !== negated ? 'pass' : 'fail',
      detail: scrollable
        ? 'The screen contains a scrollable container.'
        : 'No scrollable container was present in the view hierarchy.',
      assertion: 'scrollable',
    };
  }

  // 5) "Close button should be clickable" — an enabled, tappable control.
  if (CLICKABLE_CLAIM_RE.test(clause)) {
    const target = contentWords(clause).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(screenText));
    const hit = target ? findNode(nodes, target, { clickable: true }) : null;
    const anyClickable = nodes.some((n) => n.clickable && n.enabled);
    const ok = hit ? hit.enabled : anyClickable;
    return {
      status: ok !== negated ? 'pass' : 'fail',
      detail: ok
        ? `An enabled, tappable control is present${hit ? ` ("${(hit.text || hit.contentDesc).trim()}")` : ''}.`
        : 'No enabled, tappable control was found on screen.',
      assertion: 'clickable',
    };
  }

  // 6) Layout claims ("Title, description and Next button should display"):
  //    assert the structure the sheet is describing actually exists — heading
  //    text, body text, and a way forward — instead of hunting for the literal
  //    words "title" and "button", which are never rendered.
  if (/\b(?:title|description|button)\b/i.test(clause) && contentWords(clause).length === 0) {
    const labels = nodes.map((n) => (n.text || n.contentDesc).trim()).filter((s) => s.length > 0);
    const forward = findForwardAffordance(nodes, ['advance', 'dismiss', 'grant']);
    const ok = labels.length >= 2 && !!forward;
    return {
      status: ok !== negated ? 'pass' : 'fail',
      detail: ok
        ? `The screen shows ${labels.length} text element(s) and a forward control ("${(forward!.node.text || forward!.node.contentDesc).trim() || forward!.intent}").`
        : `The described layout is incomplete — found ${labels.length} text element(s)${forward ? '' : ' and no forward control'}. Visible: ${screenSummary(nodes)}.`,
      assertion: 'layout-structure',
    };
  }

  // 7) Qualities a view hierarchy cannot expose. Reported honestly: neither a
  //    PASS (which would be fabricated) nor an Issue (which would be false).
  if (UNVERIFIABLE_RE.test(clause)) {
    return {
      status: 'inconclusive',
      detail: `"${clause.trim()}" describes playback/timing/visual quality, which cannot be verified from the device's view hierarchy — it needs manual confirmation.`,
      assertion: 'not-machine-verifiable',
    };
  }

  // 8) Fall back to on-screen subject matching. Proportional, not all-or-
  //    nothing: sheets pad expectations with prose, so demanding every word
  //    made real matches fail.
  const words = contentWords(clause).slice(0, 6);
  if (words.length === 0) {
    return {
      status: 'inconclusive',
      detail: `"${clause.trim()}" contains no assertable on-screen subject, so no automated check could be derived.`,
      assertion: 'none',
    };
  }
  const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(screenText));
  const ok = hits.length > 0 && hits.length * 2 >= words.length;
  return {
    status: ok !== negated ? 'pass' : 'fail',
    detail: ok
      ? `The screen shows the expected subject(s): ${hits.join(', ')}.`
      : `The screen does not show the expected subject(s) — looked for [${words.join(', ')}], found [${hits.join(', ') || 'none'}]. Visible: ${screenSummary(nodes)}.`,
    assertion: 'text-subjects',
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
