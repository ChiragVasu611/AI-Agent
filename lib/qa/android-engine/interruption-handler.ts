import type { DeviceProfile, ScreenState, UiNode } from './types';
import { centerOf, labelOf, parseHierarchy, visibleText, area } from './ui-parser';
import {
  dumpHierarchy, focusedComponent, tap, pressKey, KEY, isAppForeground, startAppTimed,
  isScreenAwake, isKeyguardLocked, wakeAndUnlock,
} from './device';
import { waitForStableUi, waitUntil } from './smart-wait';
import { detectAd, dismissAd, hasCountdown, hasDismissControl } from './ad-detector';
import { detectPaywall, escapePaywall, hasEscapeControl } from './paywall-detector';
import { handleAllPermissions } from './permission-handler';
import { isPermissionDialog } from './screen-classifier';

/**
 * Interruption handling — one place that makes the screen usable again.
 *
 * Everything that can come between the agent and the app it is testing is
 * resolved here, in a single bounded loop: a dozing device, the platform's
 * ANR/crash dialogs, runtime permission prompts, advertisements, subscription
 * paywalls, one-off product pop-ups (rate-us, update-available, cookie/consent),
 * loading screens, offline/error states, and navigation that left the app.
 *
 * Why a loop rather than a cascade: these arrive in CHAINS. An app-open
 * interstitial closes onto a rate-us dialog, which closes onto a paywall, which
 * closes onto a permission prompt. Handling one blocker per exploration step (as
 * the explorer used to) meant each link in the chain consumed a step from the
 * interaction budget and a fresh ~2s dump, and any chain longer than a few links
 * ate the run. This clears the whole chain in one call and reports exactly what
 * it did, so the caller can log it and resume the flow it was on.
 *
 * Two invariants:
 *  • It NEVER purchases, subscribes, or taps a billing control.
 *  • It NEVER leaves the app under test — BACK is used sparingly and always
 *    followed by a foreground check with a relaunch if the app was exited.
 */

export type InterruptionKind =
  | 'device_asleep' | 'system_dialog' | 'permission' | 'ad' | 'paywall'
  | 'popup' | 'loading' | 'offline' | 'left_app';

export interface InterruptionEvent {
  kind: InterruptionKind;
  /** What was detected, from real signals — never invented. */
  detail: string;
  /** Ordered record of what the handler actually did about it. */
  attempts: string[];
  resolved: boolean;
  screen: string;
  waitedMs: number;
}

export interface InterruptionOutcome {
  events: InterruptionEvent[];
  /** True when the app is foreground and no blocker remains. */
  usable: boolean;
  /** The app had to be relaunched — the caller's screen context is stale. */
  relaunched: boolean;
  /** Blockers that could not be cleared, for the run's coverage limitations. */
  unresolved: InterruptionEvent[];
  /** Total wall-clock spent clearing interruptions. */
  totalMs: number;
}

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;

export interface InterruptionContext {
  serial: string;
  packageName: string;
  profile: DeviceProfile;
  log: Logger;
  /** Captures a screenshot as evidence; returns the data URL when it succeeded. */
  capture: (screenName: string, reason: 'ad' | 'paywall' | 'permission' | 'failure' | 'state_change', step?: string) => Promise<string | null>;
  /** Budget for the whole chain, so a hostile ad loop can't consume the run. */
  budgetMs?: number;
  /** Upper bound on chain length. */
  maxLinks?: number;
}

/** Chain links to clear before conceding the screen is stuck. */
const DEFAULT_MAX_LINKS = 8;
/** Wall-clock ceiling for one clearInterruptions() call. */
const DEFAULT_BUDGET_MS = 120_000;

// --------------------------------------------------------- system dialogs

/**
 * The platform's own failure dialogs. These are rendered by `android` /
 * `com.android.systemui`, not the app, and they block everything until
 * answered. "Wait" is preferred over "Close app" for an ANR so a slow-but-alive
 * app is given the chance to finish what it was doing; a crash dialog only
 * offers acknowledgement.
 */
const SYSTEM_DIALOG_TEXT = /\b(isn'?t responding|is not responding|has stopped|keeps stopping|stopped working|close app|wait|app not responding)\b/i;
const SYSTEM_DIALOG_PKG = /^(android|com\.android\.systemui|com\.google\.android\.gms)$/i;
/** Ordered preference: keep the app alive if the platform offers that choice. */
const SYSTEM_DIALOG_ACTIONS = [/^wait$/i, /^ok$/i, /^close app$/i, /^close$/i, /^got it$/i];

function detectSystemDialog(nodes: UiNode[], appPackage: string): { present: boolean; detail: string } {
  const text = visibleText(nodes);
  if (!SYSTEM_DIALOG_TEXT.test(text)) return { present: false, detail: '' };
  // Must be owned by the platform — an app screen may legitimately say "Wait".
  const platformOwned = nodes.some(
    (n) => n.packageName && n.packageName !== appPackage && SYSTEM_DIALOG_PKG.test(n.packageName),
  );
  if (!platformOwned) return { present: false, detail: '' };
  const m = /(isn'?t responding|is not responding|has stopped|keeps stopping|stopped working)/i.exec(text);
  return { present: true, detail: `Platform dialog: "${m?.[0] ?? 'system dialog'}"` };
}

// ---------------------------------------------------------------- pop-ups

/**
 * One-off product pop-ups that are neither ads nor paywalls: rate-this-app
 * prompts, "update available", cookie/consent notices, newsletter and
 * push-permission soft asks, "what's new" sheets.
 *
 * These are dismissed only through an explicit negative/neutral affordance
 * found in the live hierarchy. There is deliberately no BACK fallback: a
 * false positive on a real app screen would navigate the app backwards and
 * corrupt the flow under test.
 */
const POPUP_SIGNALS = /\b(rate (us|this app|the app)|enjoying the app|update available|new version|please update|what'?s new|we use cookies|cookie|consent|accept all|privacy (choices|options)|allow notifications|turn on notifications|enable notifications|stay updated|subscribe to (our )?newsletter|join our|follow us)\b/i;
const POPUP_DISMISS = /^(later|maybe later|not now|no thanks|no,? thanks|skip|skip for now|dismiss|cancel|close|remind me later|got it|ok|okay|continue|done|accept necessary|reject all|decline|only essential|deny)$/i;
const POPUP_DISMISS_LOOSE = /\b(maybe later|not now|no thanks|remind me|skip|dismiss|later)\b/i;
/** Anything that commits the user — never tapped as a "dismissal". */
const POPUP_COMMIT = /\b(rate|review|update|install|accept all|allow|enable|turn on|subscribe|sign up|buy|upgrade)\b/i;

function detectPopup(nodes: UiNode[], appPackage: string, w: number, h: number): { present: boolean; detail: string } {
  const text = visibleText(nodes);
  const m = POPUP_SIGNALS.exec(text);
  if (!m) return { present: false, detail: '' };

  // Require a dialog-ish surface: something substantial but not the whole
  // screen, or an explicit dialog/alert container. A page that merely mentions
  // "cookie" in body copy must not be treated as a pop-up.
  const screenArea = Math.max(1, w * h);
  const dialogish = nodes.some(
    (n) => /Dialog|AlertDialog|BottomSheet|PopupWindow|ModalBottomSheet/i.test(n.className)
      || (area(n.bounds) > screenArea * 0.2 && area(n.bounds) < screenArea * 0.95 && n.depth <= 12),
  );
  if (!dialogish) return { present: false, detail: '' };
  if (!findPopupDismiss(nodes)) return { present: false, detail: '' };

  return { present: true, detail: `Pop-up: "${m[0]}"` };
}

function findPopupDismiss(nodes: UiNode[]): UiNode | null {
  const scored: Array<{ n: UiNode; score: number }> = [];
  for (const n of nodes) {
    if (!n.enabled || !n.clickable) continue;
    const label = labelOf(n).trim();
    if (!label) continue;
    let score = 0;
    if (POPUP_DISMISS.test(label)) score += 6;
    else if (POPUP_DISMISS_LOOSE.test(label)) score += 4;
    // A commit control that isn't also an explicit decline is disqualifying.
    if (POPUP_COMMIT.test(label) && !POPUP_DISMISS.test(label)) score -= 12;
    if (score >= 4) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.n ?? null;
}

// ------------------------------------------------------- loading / offline

/**
 * Network-specific wording only. "Try again" and "Retry" are deliberately NOT
 * signals on their own — they appear on validation errors ("Wrong password, try
 * again"), which are app behaviour under test, not connectivity failures.
 */
const OFFLINE_SIGNALS = /\b(no internet|no network|not connected|check your (internet|connection|network)|connection (error|failed|lost|timed out)|network (error|unavailable)|you'?re offline|currently offline|unable to connect|couldn'?t (load|connect)|failed to load)\b/i;
const RETRY_LABEL = /^(retry|try again|reload|refresh)$/i;

function detectOffline(nodes: UiNode[]): { present: boolean; detail: string; retry: UiNode | null } {
  const text = visibleText(nodes);
  const m = OFFLINE_SIGNALS.exec(text);
  if (!m) return { present: false, detail: '', retry: null };
  const retry = nodes.find((n) => n.enabled && n.clickable && RETRY_LABEL.test(labelOf(n).trim())) ?? null;
  // Without a retry control there is nothing to act on; the screen is reported
  // by the module auditors instead of being handled here.
  if (!retry) return { present: false, detail: '', retry: null };
  return { present: true, detail: `Network/error state: "${m[0]}"`, retry };
}

const LOADING_CLASS = /ProgressBar|CircularProgress|LoadingView|Shimmer|SkeletonView/i;
const LOADING_TEXT = /\b(loading|please wait|buffering|fetching|syncing|one moment)\b/i;

/**
 * A BLOCKING loading screen — a spinner with nothing usable around it.
 *
 * The "no usable controls" requirement applies to both signals on purpose. Many
 * perfectly interactive screens contain a ProgressBar (a determinate download
 * row, a rating bar, a toolbar loader that never leaves), and treating those as
 * loading would make the engine wait out its timeout on every single visit.
 */
function looksLoading(nodes: UiNode[]): boolean {
  const interactive = nodes.filter((n) => n.enabled && (n.clickable || n.scrollable)).length;
  if (interactive > 0) return false;
  if (nodes.some((n) => LOADING_CLASS.test(n.className))) return true;
  return LOADING_TEXT.test(visibleText(nodes).slice(0, 300));
}

// ------------------------------------------------------------------- main

/**
 * Clears every interruption currently standing between the agent and the app,
 * in a bounded chain. Returns once the screen is usable, the budget is spent,
 * or a blocker proved unclearable.
 *
 * `state` is the caller's already-observed screen, reused for the first link so
 * this costs no extra dump when it is called speculatively.
 */
export async function clearInterruptions(
  ctx: InterruptionContext,
  state: ScreenState | null,
): Promise<InterruptionOutcome> {
  const { serial, packageName, profile, log } = ctx;
  const w = profile.width;
  const h = profile.height;
  const budgetMs = ctx.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxLinks = ctx.maxLinks ?? DEFAULT_MAX_LINKS;
  const startedAt = Date.now();

  const events: InterruptionEvent[] = [];
  let relaunched = false;
  let nodes: UiNode[] = state?.nodes ?? [];
  let activity = state?.activity ?? '';
  let screenLabel = state?.label ?? 'Screen';
  let pkgOnScreen = state?.packageName ?? packageName;
  let haveFreshObservation = Boolean(state);

  /** Re-reads the screen between chain links. */
  const reobserve = async (): Promise<boolean> => {
    const settled = await waitForStableUi(serial, { timeoutMs: 5_000 });
    const xml = settled.xml || (await dumpHierarchy(serial));
    if (!xml) { nodes = []; return false; }
    const parsed = parseHierarchy(xml);
    nodes = parsed.nodes;
    activity = settled.activity || (await focusedComponent(serial));
    pkgOnScreen = parsed.nodes[0]?.packageName || packageName;
    haveFreshObservation = true;
    return true;
  };

  const record = (e: InterruptionEvent) => { events.push(e); };
  const outOfBudget = () => Date.now() - startedAt > budgetMs;

  for (let link = 0; link < maxLinks; link++) {
    if (outOfBudget()) {
      await log('warn', `Interruption handling hit its ${Math.round(budgetMs / 1000)}s budget — continuing with the screen as-is.`);
      break;
    }

    if (!haveFreshObservation && !(await reobserve())) {
      // No hierarchy at all: the device may be asleep or the window is secure.
      const awake = await isScreenAwake(serial);
      const locked = await isKeyguardLocked(serial);
      if (!awake || locked) {
        const t0 = Date.now();
        const ok = await wakeAndUnlock(serial, w, h);
        record({
          kind: 'device_asleep',
          detail: awake ? 'Lock screen was showing' : 'Device screen was off',
          attempts: ['pressed WAKEUP', locked ? 'swiped up to dismiss the keyguard' : 'screen already unlocked'],
          resolved: ok,
          screen: 'Lock screen',
          waitedMs: Date.now() - t0,
        });
        await log(ok ? 'info' : 'warn',
          ok ? 'Device was asleep/locked — woken and unlocked; resuming.'
            : 'Device is locked with a credential and cannot be unlocked automatically.');
        if (!ok) break;
        haveFreshObservation = false;
        continue;
      }
      break; // hierarchy genuinely unavailable; caller's retry logic takes over
    }

    // 1. Device asleep (detected even when a stale hierarchy was still returned).
    if (!(await isScreenAwake(serial))) {
      const t0 = Date.now();
      const ok = await wakeAndUnlock(serial, w, h);
      record({
        kind: 'device_asleep', detail: 'Device screen turned off mid-run',
        attempts: ['pressed WAKEUP'], resolved: ok, screen: screenLabel, waitedMs: Date.now() - t0,
      });
      await log(ok ? 'info' : 'warn', ok ? 'Device woken — resuming exploration.' : 'Could not wake the device.');
      if (!ok) break;
      haveFreshObservation = false;
      continue;
    }

    // 2. Platform ANR / crash dialogs — these block every other interaction.
    const sys = detectSystemDialog(nodes, packageName);
    if (sys.present) {
      const t0 = Date.now();
      const attempts: string[] = [];
      await ctx.capture(`System dialog — ${screenLabel}`, 'failure', sys.detail);
      let acted = false;
      for (const re of SYSTEM_DIALOG_ACTIONS) {
        const btn = nodes.find((n) => n.enabled && re.test(labelOf(n).trim()));
        if (!btn) continue;
        const p = centerOf(btn.bounds);
        await tap(serial, p.x, p.y);
        attempts.push(`tapped "${labelOf(btn)}"`);
        acted = true;
        break;
      }
      if (!acted) { await pressKey(serial, KEY.BACK); attempts.push('pressed BACK'); }
      await waitForStableUi(serial, { timeoutMs: 4_000 });

      // The app is frequently dead after its own crash dialog — bring it back.
      if (!(await isAppForeground(serial, packageName))) {
        const rl = await startAppTimed(serial, packageName);
        attempts.push(rl.ok ? 'relaunched the app' : 'relaunch failed');
        relaunched = relaunched || rl.ok;
      }
      const resolved = await isAppForeground(serial, packageName);
      record({ kind: 'system_dialog', detail: sys.detail, attempts, resolved, screen: screenLabel, waitedMs: Date.now() - t0 });
      await log(resolved ? 'warn' : 'error',
        `${sys.detail} — ${attempts.join(' → ')}. ${resolved ? 'App is foreground again.' : 'App could not be recovered.'}`);
      if (!resolved) break;
      haveFreshObservation = false;
      continue;
    }

    // 3. Runtime permission prompts — grant so gated features stay reachable.
    if (isPermissionDialog(nodes, pkgOnScreen)) {
      const t0 = Date.now();
      const perms = await handleAllPermissions(serial, true);
      await ctx.capture('Permission Dialog', 'permission');
      // One event per prompt, not per chain: apps commonly request several in a
      // row, and the run's counters and logs should reflect each of them.
      for (const p of perms) {
        record({
          kind: 'permission',
          detail: p.message.slice(0, 120) || 'Permission dialog',
          attempts: [`${p.action} via "${p.control}"`],
          resolved: p.action !== 'unhandled',
          screen: screenLabel,
          waitedMs: Date.now() - t0,
        });
        await log('info', `Permission ${p.action}: ${p.message.slice(0, 90)}`);
      }
      if (perms.length === 0) {
        // Classified as a permission dialog but the drain found nothing to do —
        // don't spin on it.
        record({
          kind: 'permission', detail: 'Permission dialog with no recognised controls',
          attempts: [], resolved: false, screen: screenLabel, waitedMs: Date.now() - t0,
        });
        break;
      }
      haveFreshObservation = false;
      continue;
    }

    // 4. Advertisements. A blocking interstitial/rewarded/app-open ad must be
    //    dismissed to continue. A non-blocking banner or native ad is ALSO
    //    dismissed when it offers a close control — the screen is usable either
    //    way, but a closed ad means fewer mis-taps and a cleaner screenshot —
    //    just without the BACK fallback, which would navigate a usable screen.
    const ad = detectAd(nodes, activity, packageName, w, h);
    if (ad.isAd && (ad.blocking || hasDismissControl(nodes, w, h, { withinAdOnly: true }))) {
      const t0 = Date.now();
      await ctx.capture(`Ad — ${screenLabel}`, 'ad', ad.reason);
      const countdown = hasCountdown(nodes);
      await log('info',
        `Ad detected on "${screenLabel}" (${ad.reason})${ad.blocking ? ' — blocking' : ' — overlaid'}`
        + `${countdown ? ', countdown present; polling for the skip control' : ''}.`);

      const res = await dismissAd(
        serial, packageName, w, h,
        // Only a blocking ad is worth waiting out a countdown for.
        ad.blocking ? (countdown ? 45_000 : 20_000) : 2_000,
        // An overlaid ad gets neither BACK (it would navigate the usable screen
        // behind it) nor taps outside its own container.
        { allowBack: ad.blocking, withinAdOnly: !ad.blocking },
      );
      record({
        kind: 'ad',
        detail: `${ad.reason}${ad.blocking ? ' (blocking)' : ' (overlaid)'}`,
        attempts: res.attempts, resolved: res.dismissed, screen: screenLabel, waitedMs: res.waitedMs,
      });
      await log(res.dismissed ? 'info' : 'warn',
        res.dismissed
          ? `Ad dismissed after ${Math.round(res.waitedMs / 1000)}s via ${res.attempts[res.attempts.length - 1] ?? 'dismiss control'}.`
          : `Could not dismiss the ad on "${screenLabel}" (${res.attempts.join(' → ')}).`);

      if (!(await isAppForeground(serial, packageName))) {
        const rl = await startAppTimed(serial, packageName);
        relaunched = relaunched || rl.ok;
        await log(rl.ok ? 'info' : 'error',
          rl.ok ? 'The ad had pushed the app to the background — relaunched to continue.' : 'App could not be relaunched after the ad.');
        if (!rl.ok) break;
      }
      // A non-blocking ad we failed to close is not a blocker: stop looping on
      // it and let exploration proceed around it.
      if (!res.dismissed && !ad.blocking) { haveFreshObservation = false; break; }
      if (!res.dismissed) break;
      haveFreshObservation = false;
      continue;
    }

    // 5. Paywalls / subscription walls. Escape is attempted for non-blocking
    //    sheets too whenever an explicit "Not now / Maybe later / Skip / close"
    //    control exists, so a partially-covering sheet stops shadowing the flow.
    //    No purchase is ever attempted.
    const paywall = detectPaywall(nodes, packageName, w, h);
    if (paywall.isPaywall && (paywall.blocking || hasEscapeControl(nodes, w, h))) {
      const t0 = Date.now();
      await ctx.capture(`Paywall — ${screenLabel}`, 'paywall', paywall.reason);
      await log('info', `Paywall detected on "${screenLabel}" (${paywall.reason}) — dismissing without purchasing.`);
      const esc = await escapePaywall(serial, packageName, w, h);
      record({
        kind: 'paywall',
        detail: `${paywall.reason}${paywall.blocking ? ' (blocking)' : ' (overlaid)'}`,
        attempts: esc.attempts, resolved: esc.escaped, screen: screenLabel, waitedMs: Date.now() - t0,
      });
      await log(esc.escaped ? 'info' : 'warn',
        esc.escaped
          ? `Paywall dismissed via ${esc.attempts[esc.attempts.length - 1] ?? 'an escape control'}; no purchase was made.`
          : `Paywall on "${screenLabel}" could not be dismissed (${esc.attempts.join(' → ')}).`);

      // escapePaywall's last resort is BACK, which can exit the app.
      if (!(await isAppForeground(serial, packageName))) {
        const rl = await startAppTimed(serial, packageName);
        relaunched = relaunched || rl.ok;
        await log(rl.ok ? 'info' : 'error',
          rl.ok ? 'Escaping the paywall exited the app — relaunched to continue.' : 'App could not be relaunched after the paywall.');
        if (!rl.ok) break;
      }
      if (!esc.escaped && !paywall.blocking) { haveFreshObservation = false; break; }
      if (!esc.escaped) break;
      haveFreshObservation = false;
      continue;
    }

    // 6. Product pop-ups (rate-us, update, consent, notification soft-ask).
    const popup = detectPopup(nodes, packageName, w, h);
    if (popup.present) {
      const t0 = Date.now();
      const btn = findPopupDismiss(nodes);
      const attempts: string[] = [];
      let resolved = false;
      if (btn) {
        const p = centerOf(btn.bounds);
        await tap(serial, p.x, p.y);
        attempts.push(`tapped "${labelOf(btn)}"`);
        const settled = await waitForStableUi(serial, { timeoutMs: 3_500 });
        const after = settled.xml ? parseHierarchy(settled.xml).nodes : [];
        resolved = after.length === 0 || !detectPopup(after, packageName, w, h).present;
      }
      record({ kind: 'popup', detail: popup.detail, attempts, resolved, screen: screenLabel, waitedMs: Date.now() - t0 });
      await log(resolved ? 'info' : 'debug',
        resolved ? `${popup.detail} dismissed via ${attempts[0] ?? 'a dismiss control'}.`
          : `${popup.detail} could not be dismissed cleanly — continuing around it.`);
      // Never press BACK for a suspected pop-up: a false positive would
      // navigate the real app backwards and corrupt the flow under test.
      if (!resolved) { haveFreshObservation = false; break; }
      haveFreshObservation = false;
      continue;
    }

    // 7. Blocking loading screen — wait for real content rather than treating an
    //    empty spinner screen as a finished (and defective) screen.
    if (looksLoading(nodes)) {
      const t0 = Date.now();
      const finished = await waitUntil(
        serial,
        (xml) => !looksLoading(parseHierarchy(xml).nodes),
        20_000,
      );
      record({
        kind: 'loading', detail: 'Blocking loading indicator with no usable controls',
        attempts: [finished ? 'content finished loading' : 'still loading after 20s'],
        resolved: finished, screen: screenLabel, waitedMs: Date.now() - t0,
      });
      await log(finished ? 'debug' : 'warn',
        finished ? `"${screenLabel}" finished loading after ${Math.round((Date.now() - t0) / 1000)}s.`
          : `"${screenLabel}" was still loading after 20s — proceeding so the run isn't stalled.`);
      if (!finished) { haveFreshObservation = false; break; }
      haveFreshObservation = false;
      continue;
    }

    // 8. Offline / error state — retry once through the app's own control.
    const offline = detectOffline(nodes);
    if (offline.present && offline.retry) {
      const t0 = Date.now();
      const p = centerOf(offline.retry.bounds);
      await tap(serial, p.x, p.y);
      const settled = await waitForStableUi(serial, { timeoutMs: 8_000 });
      const after = settled.xml ? parseHierarchy(settled.xml).nodes : [];
      const resolved = after.length > 0 && !detectOffline(after).present;
      record({
        kind: 'offline', detail: offline.detail,
        attempts: [`tapped "${labelOf(offline.retry)}"`], resolved, screen: screenLabel, waitedMs: Date.now() - t0,
      });
      await log(resolved ? 'info' : 'warn',
        resolved ? `${offline.detail} cleared after retrying.`
          : `${offline.detail} persisted after retrying — the device may have no connectivity.`);
      if (!resolved) { haveFreshObservation = false; break; }
      haveFreshObservation = false;
      continue;
    }

    // 9. Navigation left the app under test (external browser, launcher, an ad
    //    SDK's own activity, another app).
    if (pkgOnScreen && packageName && !pkgOnScreen.startsWith(packageName)) {
      const t0 = Date.now();
      const attempts = ['pressed BACK'];
      await pressKey(serial, KEY.BACK);
      await waitForStableUi(serial, { timeoutMs: 4_000 });
      let resolved = await isAppForeground(serial, packageName);
      if (!resolved) {
        const rl = await startAppTimed(serial, packageName);
        attempts.push(rl.ok ? 'relaunched the app' : 'relaunch failed');
        relaunched = relaunched || rl.ok;
        resolved = rl.ok;
      }
      record({
        kind: 'left_app', detail: `Foreground package was ${pkgOnScreen}`,
        attempts, resolved, screen: screenLabel, waitedMs: Date.now() - t0,
      });
      await log(resolved ? 'debug' : 'error',
        resolved ? `Navigation left the app (${pkgOnScreen}) — returned to ${packageName}.`
          : `Left the app (${pkgOnScreen}) and could not get back to ${packageName}.`);
      if (!resolved) break;
      haveFreshObservation = false;
      continue;
    }

    // Nothing left to clear.
    break;
  }

  const usable = await isAppForeground(serial, packageName);
  const unresolved = events.filter((e) => !e.resolved);

  if (events.length > 0) {
    const summary = events
      .map((e) => `${e.kind}${e.resolved ? '✓' : '✗'}`)
      .join(', ');
    await log('info',
      `Interruptions cleared on the way through: ${summary} `
      + `(${Math.round((Date.now() - startedAt) / 1000)}s${relaunched ? ', app relaunched' : ''}).`);
  }

  return { events, usable, relaunched, unresolved, totalMs: Date.now() - startedAt };
}

/**
 * Cheap pre-check: does this screen look like it needs interruption handling at
 * all? Lets the explorer skip the (dump-costing) handler on ordinary screens.
 * Deliberately conservative — a false positive only costs one extra check.
 */
export function needsInterruptionHandling(
  state: ScreenState,
  appPackage: string,
  w: number,
  h: number,
): boolean {
  if (state.kind === 'permission_dialog') return true;
  if (state.packageName && appPackage && !state.packageName.startsWith(appPackage)) return true;
  if (detectSystemDialog(state.nodes, appPackage).present) return true;
  const ad = detectAd(state.nodes, state.activity, appPackage, w, h);
  if (ad.isAd && (ad.blocking || hasDismissControl(state.nodes, w, h, { withinAdOnly: true }))) return true;
  const paywall = detectPaywall(state.nodes, appPackage, w, h);
  if (paywall.isPaywall && (paywall.blocking || hasEscapeControl(state.nodes, w, h))) return true;
  if (detectPopup(state.nodes, appPackage, w, h).present) return true;
  if (looksLoading(state.nodes)) return true;
  if (detectOffline(state.nodes).present) return true;
  return false;
}
