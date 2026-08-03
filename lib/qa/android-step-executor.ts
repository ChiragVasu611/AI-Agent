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
  findForwardAffordance, resolveTappable, waitForUiChange, findSelectableChoice,
  waitForElement, isTreeUnreadable,
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
async function settleAfterAction(serial: string, timeoutMs = 12000, changedFrom?: string) {
  // Forwarding the pre-action signature lets the settle finish on ONE hierarchy
  // dump when the screen has demonstrably changed and is idle, instead of always
  // paying two (~4.8s). A dump is by far the most expensive device call, so this
  // is the single biggest saving per step — and it cannot return a half-drawn
  // frame, because the bridge still rejects a screen that is mid-load.
  return waitForUiSettle(serial, { timeoutMs, changedFrom });
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
    // Never interact with a screen that is not the app under test.
    //
    // If the app dies part way through a case, every remaining step was
    // resolving its target against whatever WAS on screen — the launcher. That
    // produced results far worse than a failure: a step tapped the app's own
    // home-screen icon, the screen "advanced" (it launched the app), and the
    // step was recorded as PASS. A green step that never touched the feature it
    // names is the most damaging thing this engine can output.
    //
    // `navigate` is exempt because launching the app is exactly how it gets
    // back; the keypress/wait/verify kinds are exempt because they either do
    // not resolve an element or report their own foreground state.
    const NEEDS_APP_ON_SCREEN = new Set([
      'click', 'type', 'clear', 'check', 'uncheck', 'select', 'scroll', 'proceed', 'submit', 'hover',
    ]);
    if (pkg && NEEDS_APP_ON_SCREEN.has(action.kind)) {
      const fg = await foregroundPackage(serial);
      if (fg !== pkg) {
        return {
          ok: false,
          detail: `Not executed: "${fg ?? 'another screen'}" was in the foreground instead of the app under test (${pkg}), so this step would have acted on a different application. The app left the foreground earlier in this test case.`,
        };
      }
    }

    switch (action.kind) {
      case 'navigate': {
        // On a native app "navigate/open" means (re)focus the app under test.
        if (!pkg) return { ok: false, detail: 'No package name is known for this app, so it cannot be launched.' };

        // Almost every sheet opens a test case with "Launch the application".
        // The app is launched ONCE during run preparation and the same session is
        // kept for the whole suite, so when it is already on screen this step is
        // already satisfied — re-sending the launcher intent would at best be
        // wasted work and at worst pop the app back to its root activity,
        // discarding the place the previous test case had navigated to.
        if ((await foregroundPackage(serial)) === pkg) {
          return {
            ok: true,
            detail: `The application under test (${pkg}) is already running and in the foreground, so the existing session was kept rather than relaunched.`,
          };
        }

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
        const after = await settleAfterAction(serial, 12000, before);
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
        // Give the control a chance to appear rather than demanding it already
        // be present — a list still binding or a dialog still animating in is
        // lateness, not a defect, and a one-shot lookup reported it as one.
        const waited = await waitForElement(serial, action.target, { clickable: true });
        const nodes = waited.nodes;
        let node = waited.node;
        // A named control may not exist on this screen (sheets often name an
        // element generically, e.g. "close icon on ad"). Rather than stalling
        // the whole run, fall back to a forward affordance when the step is
        // clearly about dismissing or advancing.
        if (!node && /\b(?:ad|advertisement|popup|pop-up|banner|dialog|close|skip|continue|next|proceed)\b/i.test(action.raw)) {
          const fallback = findForwardAffordance(nodes, ['dismiss', 'advance', 'grant']);
          if (fallback) node = fallback.node;
        }
        // "Select a random language", "pick any option" — the sheet is naming a
        // CHOICE, not a control. There is no element literally labelled "random
        // language", so a label lookup can only ever fail and file an Issue for
        // an app that is behaving perfectly. Pick a genuine item out of the list
        // instead, which is what a tester would do.
        if (!node && /\b(?:random|randomly|any\s+(?:one|item|option|value)?)\b/i.test(action.raw)) {
          const choice = findSelectableChoice(nodes);
          if (choice) node = choice;
        }
        if (!node) {
          // Distinguish "the app never rendered this control" from "this screen
          // exposes nothing to the accessibility tree at all" (a canvas/game/
          // video surface). Blaming the app for the second is a false failure.
          if (isTreeUnreadable(nodes)) {
            return { ok: false, detail: `The current screen exposes no readable elements to the accessibility tree, so "${action.target}" could not be located. This is typical of canvas-rendered, game, or video surfaces and needs manual verification rather than indicating a defect.` };
          }
          return { ok: false, detail: `No on-screen element matching "${action.target}" appeared within ${Math.round(waited.waitedMs / 100) / 10}s. Visible elements: ${screenSummary(nodes)}.` };
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
        const after = await settleAfterAction(serial, 12000, before);
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
        const waited = await waitForElement(serial, action.target, { editable: true });
        const nodes = waited.nodes;
        const field = waited.node
          // Fall back to the already-focused input if the label did not match.
          ?? nodes.find((n) => n.focused && /EditText/i.test(n.className))
          ?? null;
        if (!field) {
          return { ok: false, detail: `No text field matching "${action.target}" appeared within ${Math.round(waited.waitedMs / 100) / 10}s. Visible elements: ${screenSummary(nodes)}.` };
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
        const field = (await waitForElement(serial, action.target, { editable: true })).node;
        if (!field) return { ok: false, detail: `No text field matching "${action.target}" was found to clear.` };
        await tap(serial, field.center.x, field.center.y);
        await pressKey(serial, 'KEYCODE_MOVE_END');
        const count = Math.min((field.text?.length ?? 0) + 2, 80);
        await shell(serial, `input keyevent ${Array(count).fill('KEYCODE_DEL').join(' ')}`, 20000);
        // Observe the result rather than asserting it. Every other input branch
        // checks what the screen did; this one used to report "Cleared" without
        // ever looking, so a field that refused to clear still passed.
        await settleAfterAction(serial, 6000);
        const afterClear = findNode(await dumpUi(serial, { fresh: true }), action.target, { editable: true });
        const leftover = afterClear?.text?.trim() ?? '';
        if (leftover.length > 0) {
          return { ok: false, detail: `Tried to clear "${action.target}" but it still reads "${leftover}".` };
        }
        return { ok: true, detail: `Cleared the "${action.target}" field; it is now empty.` };
      }

      case 'check':
      case 'uncheck': {
        const node = (await waitForElement(serial, action.target, { clickable: true })).node;
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
        // Read the stream volume either side of the press, so the step reports
        // what actually changed on the device instead of only what was sent.
        const readVol = async () => {
          const out = await shell(serial, 'dumpsys audio | grep -m1 -A2 "STREAM_MUSIC"', 10000).catch(() => '');
          return out.match(/(?:streamVolume|Current):?\s*(\d+)/i)?.[1] ?? null;
        };
        const volBefore = await readVol();
        await shell(serial, `input keyevent ${Array(5).fill(code).join(' ')}`, 20000);
        await settleAfterAction(serial, 4000);
        const volAfter = await readVol();
        const moved = volBefore !== null && volAfter !== null && volBefore !== volAfter;
        return {
          ok: true,
          detail: moved
            ? `Turned the volume ${action.value === 'down' ? 'down' : 'up'} — the music stream moved from ${volBefore} to ${volAfter}.`
            : `Pressed ${code} five times to turn the volume ${action.value === 'down' ? 'down' : 'up'}${volAfter !== null ? ` (music stream reads ${volAfter}${volBefore === volAfter ? ', already at its limit' : ''})` : ''}.`,
        };
      }

      case 'longpress': {
        const node = (await waitForElement(serial, action.target, { clickable: true })).node;
        if (!node) return { ok: false, detail: `No on-screen element matching "${action.target}" was found to long-press.` };
        const target = resolveTappable(await dumpUi(serial), node) ?? node;
        const before = uiSignature(await dumpUi(serial));
        const beforeActivity = await currentActivity(serial);
        // A long press is a zero-distance swipe with a hold duration.
        await swipe(serial, target.center.x, target.center.y, target.center.x, target.center.y, 900);
        const after = await settleAfterAction(serial, 12000, before);
        const transition = { beforeSignature: before, beforeActivity, afterSignature: after.signature, afterActivity: after.activity };
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Long-pressed "${action.target}" but nothing on screen changed — the gesture had no effect.`, ...transition };
        }
        return { ok: true, detail: `Long-pressed "${action.target}"; the screen responded.`, ...transition };
      }

      case 'doubletap': {
        const node = (await waitForElement(serial, action.target, { clickable: true })).node;
        if (!node) return { ok: false, detail: `No on-screen element matching "${action.target}" was found to double-tap.` };
        const target = resolveTappable(await dumpUi(serial), node) ?? node;
        const before = uiSignature(await dumpUi(serial));
        const beforeActivity = await currentActivity(serial);
        await tap(serial, target.center.x, target.center.y);
        await tap(serial, target.center.x, target.center.y);
        const after = await settleAfterAction(serial, 12000, before);
        const transition = { beforeSignature: before, beforeActivity, afterSignature: after.signature, afterActivity: after.activity };
        if (after.signature === before && after.activity === beforeActivity) {
          return { ok: false, detail: `Double-tapped "${action.target}" but nothing on screen changed.`, ...transition };
        }
        return { ok: true, detail: `Double-tapped "${action.target}"; the screen responded.`, ...transition };
      }

      case 'home': {
        if (!pkg) return { ok: false, detail: 'No package name is known, so backgrounding cannot be verified.' };
        await pressKey(serial, 'KEYCODE_HOME');
        let left = false;
        for (let i = 0; i < 10 && !left; i++) {
          await new Promise((r) => setTimeout(r, 400));
          left = (await foregroundPackage(serial)) !== pkg;
        }
        return left
          ? { ok: true, detail: 'Sent the app to the background with the HOME key.' }
          : { ok: false, detail: 'Pressed HOME but the app is still in the foreground.' };
      }

      case 'restart': {
        // Only ever reached because the SHEET asked for it. The engine never
        // restarts the app on its own — that is what made it open and close
        // repeatedly — but a step that explicitly says "kill and reopen" is a
        // legitimate test of cold-start behaviour.
        if (!pkg) return { ok: false, detail: 'No package name is known for this app, so it cannot be restarted.' };
        await shell(serial, `am force-stop ${pkg}`, 15000);
        for (let i = 0; i < 12; i++) {
          if (!(await shell(serial, `pidof ${pkg}`, 8000)).trim()) break;
          await new Promise((r) => setTimeout(r, 350));
        }
        await shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, 20000);
        const ready = await waitForAppReady(serial, pkg, await currentActivity(serial));
        return ready.ready
          ? { ok: true, detail: `Restarted the app as the step requested. ${ready.detail}` }
          : { ok: false, detail: `Restarted the app as the step requested, but it did not come back to a usable state: ${ready.detail}` };
      }

      case 'screenshot': {
        // The engine already captures a real device frame after every step, so
        // the step's intent is satisfied by that evidence.
        const screen = await currentActivity(serial);
        return { ok: true, detail: `Screen captured on ${screen ?? 'the current screen'} — the frame is attached to this step as evidence.` };
      }

      case 'wait': {
        // "Wait until the list loads" — no duration given, so wait for the
        // screen to actually stop changing instead of guessing a number.
        if (action.value === 'settle') {
          const settled = await waitForUiSettle(serial, { timeoutMs: 15000 });
          return {
            ok: true,
            detail: settled.settled
              ? `Waited for the screen to finish loading (${Math.round(settled.waitedMs / 100) / 10}s).`
              : `Waited ${Math.round(settled.waitedMs / 100) / 10}s but the screen was still changing.`,
          };
        }
        const secs = Math.min(10, Math.max(1, Number(action.value) || 1));
        await new Promise((r) => setTimeout(r, secs * 1000));
        return { ok: true, detail: `Waited ${secs}s.` };
      }

      case 'submit': {
        const beforeSubmit = uiSignature(await dumpUi(serial));
        await pressKey(serial, 'KEYCODE_ENTER');
        const afterSubmit = await settleAfterAction(serial, 12000, beforeSubmit);
        if (afterSubmit.signature === beforeSubmit) {
          return { ok: false, detail: 'Submitted via the Enter key but nothing on screen changed — the submission had no visible effect.' };
        }
        if (!afterSubmit.settled && !hasUsableContent(afterSubmit.nodes)) {
          return { ok: false, detail: 'Submitted, but after 12s the app is still loading with no interactive content — it appears stuck processing the submission.' };
        }
        return { ok: true, detail: 'Submitted via the Enter key.' };
      }

      case 'select': {
        const spinner = (await waitForElement(serial, action.target, { clickable: true })).node;
        if (!spinner) return { ok: false, detail: `No dropdown matching "${action.target}" was found.` };
        await tap(serial, spinner.center.x, spinner.center.y);
        await settleAfterAction(serial, 8000);
        // The option list is populated asynchronously on many pickers, so the
        // option genuinely may not exist in the frame right after the tap.
        const opened = await waitForElement(serial, action.value, { clickable: true });
        const optionNodes = opened.nodes;
        const option = opened.node;
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
  /**
   * True when the expectation could not be checked because something genuinely
   * BLOCKED the check — currently: the app under test was not on screen, so
   * nothing visible belonged to it.
   *
   * This is what lets the engine tell a real blocker apart from an expectation
   * that simply is not machine-verifiable ("the animation is smooth", "the logo
   * is centred"). Both come back `inconclusive`, but only the former is a
   * BLOCKED result — the latter means the step ran fine and a human needs to
   * confirm the wording, which must not be reported as a blocker.
   */
  blocker: boolean;
}

/** Assertion classes that represent a genuine blocker rather than a soft "cannot judge". */
const BLOCKING_ASSERTIONS = new Set(['app-not-foreground']);

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

/**
 * Clauses that ask for a judgement rather than for a fact.
 *
 * "should be correct", "is true or false", "matches the name", "displays
 * properly", "looks right" — none of these can be answered from a view
 * hierarchy, because the hierarchy reports what exists, not whether it is
 * *right*. A human tester compares a flag to a language name; software cannot,
 * and pretending otherwise is how the engine produced failures for apps that
 * were behaving perfectly.
 *
 * Kept separate from UNVERIFIABLE_RE, which is about media and timing: this is
 * about the KIND of question, so it generalises to any sheet's wording instead
 * of needing a new noun added every time one is discovered.
 */
const JUDGEMENT_RE = /\b(?:true\s+or\s+false|correct(?:ly|ness)?|incorrect|match(?:es|ing|ed)?|mismatch|appropriate|accurate|proper(?:ly)?|proper|proportion\w*|proportionate|legible|readable|aligned|alignment|consistent|as\s+expected|look(?:s|ed)?\s+(?:good|right|fine|ok)|should\s+be\s+(?:same|identical)|same\s+as)\b/i;

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

/**
 * Nouns that name UI furniture or a visual artifact rather than any text the
 * app renders. An app *shows* a splash screen and *shows* a logo; it does not
 * print the words "splash" or "logo" anywhere, so demanding them on screen is
 * guaranteed to fail and to file an Issue for a defect that does not exist.
 *
 * This is the same trap rule 6 already sidesteps for "title"/"description"/
 * "button" — generalised, because "A splash screen should be displayed with the
 * logo and the app name" hit the keyword fallback instead and failed a
 * perfectly healthy launch.
 *
 * When the sheet genuinely means literal on-screen text it can quote it, and
 * the quoted-literal rule above handles that exactly.
 */
const CHROME_NOUNS = new Set([
  'splash', 'logo', 'image', 'images', 'icon', 'icons', 'banner', 'background',
  'thumbnail', 'avatar', 'graphic', 'illustration', 'picture', 'photo',
  'animation', 'spinner', 'loader', 'layout', 'interface', 'design', 'theme',
  'font', 'alignment', 'placeholder', 'element', 'elements', 'component',
  // Surface nouns. "The home screen is displayed" names WHICH surface the user
  // should be looking at — it is not a promise that the word "home" appears
  // anywhere on it. Left out of this list, that expectation went to the keyword
  // fallback, searched the rendered text for "home", and failed an app that was
  // sitting correctly on its home screen showing "HOTSPOT READY". Observed on a
  // real run; a screen's NAME is almost never text the screen renders.
  'home', 'screen', 'screens', 'page', 'pages', 'view', 'window', 'dashboard',
  'main', 'app', 'application', 'section', 'panel', 'tab', 'menu', 'popup',
  'dialog', 'modal', 'toast', 'snackbar', 'notification',
  // Words naming WHEN to look, or the abstract thing being judged, rather than
  // anything rendered. "Verify the screen displayed after reopening" is an
  // instruction to inspect the screen; it does not promise the word "reopening"
  // is on it. Observed on a real run: that single word became the assertion and
  // failed a case whose app had reopened perfectly, and the resulting Issue told
  // a developer only that "reopening" was not found on screen. Filtering these
  // leaves the clause unassertable, so the case-level Expected Result — where
  // the real expectation lives — is used instead.
  'reopening', 'reopen', 'reopened', 'reopens', 'relaunch', 'relaunching',
  'launch', 'launching', 'launched', 'opening', 'closing', 'restart',
  'restarting', 'foreground', 'navigation', 'transition', 'duration', 'timing',
  'behaviour', 'behavior', 'functionality', 'state', 'status',
  'result', 'results', 'output', 'response',
]);

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
    // No expectation in the sheet is not a blocker — there was simply nothing
    // to assert. The step's own execution still decides its verdict.
    return { status: 'inconclusive', actual: 'The sheet did not specify an Expected Result, so nothing could be asserted.', assertion: 'none', blocker: false };
  }

  // Read-only on purpose. An earlier version called ensureAppForeground() from
  // here to restore a drifted app before asserting — but that helper's recovery
  // ladder ends in force-stop + cold launch, and this function runs on every
  // verify step AND once per case. On an app that self-exits (ad SDK teardown,
  // OEM background killer) that turned every assertion into another launch, so
  // the app visibly opened and closed over and over.
  //
  // Restoring the app is the engine's job, and it already does it: it re-anchors
  // with ensureAppForeground once per case. A validator's only job is to report
  // what is on screen — including, honestly, that the app was not on it.
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
      blocker: false,
    };
  }
  if (passed.length > 0) {
    return {
      status: 'pass',
      actual: describe(passed) + (unknown.length > 0 ? ` Not machine-verifiable: ${describe(unknown)}` : ''),
      assertion: passed.map((v) => v.assertion).join('+'),
      blocker: false,
    };
  }
  return {
    status: 'inconclusive',
    actual: describe(unknown),
    assertion: unknown.map((v) => v.assertion).join('+') || 'none',
    // Only a genuine obstruction counts. An expectation that is merely
    // unprovable from a view hierarchy is not a blocker.
    blocker: unknown.some((v) => BLOCKING_ASSERTIONS.has(v.assertion)),
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

  // 1) Crash / app-alive claims — "without crashing", "the app remains open",
  //    "the screen scrolls without the app closing".
  //
  //    Every one of these is really the same checkable question: is the app
  //    still alive and in front? Answering it from the live device is exact,
  //    which is why it must be caught HERE rather than falling through to the
  //    keyword fallback at the bottom — that fallback hunts for the clause's own
  //    words on screen, so "without the app closing" went looking for the
  //    literal text "closing", never found it, and reported the app's perfectly
  //    healthy survival as a FAILURE. Verified against a real run: three cases
  //    failed this way, one of them semantically inverted.
  //
  //    `clos\w*` rather than `close[ds]?`: the old form matched close/closed/
  //    closes but NOT "closing", which is the participle sheets actually use.
  const LIVENESS_VOCAB = /\b(?:crash\w*|terminate\w*|force[\s-]?stop\w*|clos\w*|exit\w*|freez\w*|hang\w*|kill\w*|quit\w*|dismiss(?:ed|es)?\s+itself)\b/i;
  //    Phrases that assert liveness without naming a failure mode at all.
  const LIVENESS_PHRASE = /\b(?:remain\w*|stay\w*|still|contin\w*|keep\w*)\s+(?:\w+\s+){0,2}?(?:open|running|active|visible|alive|foreground)\b|\b(?:remains?|stays?)\s+(?:open|running|active)\b/i;
  //    A control literally labelled "Close" is not a liveness claim, so the
  //    vocabulary only counts when the clause is talking about the app itself.
  const APP_SUBJECT = /\b(?:app|application|apk|it|screen|page|activity|session)\b/i;
  const isLivenessClaim = pkg
    && ((LIVENESS_VOCAB.test(clause) && APP_SUBJECT.test(clause)) || LIVENESS_PHRASE.test(clause));

  if (isLivenessClaim) {
    // "The app crashed" is too serious a verdict to hang on one reading. A
    // window transition can briefly report the launcher (dumpsys falls back to
    // mFocusedApp while focus is null), so confirm the app is really gone
    // before saying so. Read-only by design — no relaunching from a validator.
    let stillUp = fg === pkg;
    for (let recheck = 0; !stillUp && recheck < 3; recheck++) {
      await new Promise((r) => setTimeout(r, 400));
      stillUp = (await foregroundPackage(ctx.serial).catch(() => null)) === pkg;
    }
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
  // A clause asking for a HUMAN JUDGEMENT, recognised by what it asks rather
  // than by which nouns it happens to contain.
  //
  // "The country icon with the name should be correct" and "verify the language
  // name with the country icon is true or false" ask whether two things agree —
  // a comparison only a person can make. Keyword-matching them searched the
  // screen for "country"/"true"/"false", found none, and failed an app whose
  // language list was rendering perfectly. Chasing that one noun at a time
  // (splash, logo, reopening, country…) never converges; the durable fix is to
  // recognise the QUESTION being asked. Reported as needing manual confirmation,
  // which is honest — and it deliberately does not suppress the checkable parts
  // of the same expectation, because splitClauses judges each clause separately.
  if (JUDGEMENT_RE.test(clause)) {
    return {
      status: 'inconclusive',
      detail: `"${clause.trim()}" asks whether something is correct, matching or acceptable — a comparison that needs human eyes. The step was executed; this part of the expectation needs manual confirmation rather than being passed or failed automatically.`,
      assertion: 'needs-human-judgement',
    };
  }

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
  // Matching the sheet's words against a screen that is not the app under test
  // compares the expectation to the launcher (or whatever else drifted into
  // view) and calls the mismatch an app defect. It is not one — we simply never
  // got to look at the app.
  if (pkg && fg && fg !== pkg) {
    return {
      status: 'inconclusive',
      detail: `The expected result could not be checked: "${fg}" was in the foreground instead of the app under test (${pkg}), so nothing on screen belonged to it.`,
      assertion: 'app-not-foreground',
    };
  }

  const words = contentWords(clause).slice(0, 6);
  // Drop the words that describe UI furniture rather than rendered text. If
  // that leaves nothing, the clause is a visual description — real, but not
  // something a view hierarchy can prove either way.
  const assertable = words.filter((w) => !CHROME_NOUNS.has(w));
  if (words.length === 0 || assertable.length === 0) {
    return {
      status: 'inconclusive',
      detail: words.length === 0
        ? `"${clause.trim()}" contains no assertable on-screen subject, so no automated check could be derived.`
        : `"${clause.trim()}" describes visual presentation (${words.filter((w) => CHROME_NOUNS.has(w)).join(', ')}) rather than any text the app renders, so it cannot be proven from the view hierarchy and needs manual confirmation.`,
      assertion: words.length === 0 ? 'none' : 'not-machine-verifiable',
    };
  }
  const hits = assertable.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(screenText));
  // Scored against the words actually asserted, not the raw list — counting
  // dropped chrome nouns in the denominator would make the threshold
  // unreachable for any clause that mentioned one.
  const ok = hits.length > 0 && hits.length * 2 >= assertable.length;
  return {
    status: ok !== negated ? 'pass' : 'fail',
    detail: ok
      ? `The screen shows the expected subject(s): ${hits.join(', ')}.`
      : `The screen does not show the expected subject(s) — looked for [${assertable.join(', ')}], found [${hits.join(', ') || 'none'}]. Visible: ${screenSummary(nodes)}.`,
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
