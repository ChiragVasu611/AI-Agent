import type { Finding, Interaction, ScreenState, UiNode } from './types';
import type { DeviceProfile } from './types';
import { dumpHierarchy, focusedComponent, pressKey, KEY, isAppForeground, startAppTimed } from './device';
import { parseHierarchy } from './ui-parser';
import { classifyScreen, screenSignature, perceptualSignature, labelFromActivity } from './screen-classifier';
import { detectAd } from './ad-detector';
import { clearInterruptions, needsInterruptionHandling, type InterruptionOutcome } from './interruption-handler';
import { attemptLogin, inspectLoginForm, type QaCredentials } from './login-handler';
import { planInteractions, performAndSettle, actionKey } from './interaction-engine';
import { ScreenGraph } from './graph';
import { waitForStableUi, waitUntil } from './smart-wait';
import { CrashMonitor } from './crash-monitor';
import { ScreenshotManager } from './screenshots';
import type { PlanningSession } from './planning';

/**
 * The autonomous explorer — the EXECUTION layer.
 *
 * One loop iteration = observe → interpret → handle blockers → decide → act.
 * All device I/O (dumps, gestures, blocker resolution) lives here. What it does
 * NOT do any more is decide by itself: when a {@link PlanningSession} is
 * supplied, the DECIDE step ranks the enumerated candidate actions through the
 * planner (goals → AI → heuristics) and the STOP decision is made by the
 * coverage engine — so the explorer only ever executes actions the planner
 * chose, and never stops merely because every screen was seen. Without a
 * planner it retains its original graph-driven DFS behaviour (backward
 * compatible). Blockers (ads, paywalls, permission dialogs, login walls,
 * leaving the app) are still resolved inline; unlocking ones additionally
 * trigger adaptive re-exploration.
 */

export interface ExplorerConfig {
  serial: string;
  packageName: string;
  profile: DeviceProfile;
  maxSteps: number;
  deadlineAt: number;
  credentials: QaCredentials | null;
  /** Emits a live log line to the run's console. */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
  /** Reports progress so the UI's polling shows real movement. */
  progress: (screen: string, step: string, screensFound: number) => Promise<void>;
  screenshots: ScreenshotManager;
  crashes: CrashMonitor;
  runId: string;
  /** Invoked with every crash signal the monitor surfaces mid-exploration. */
  onCrash: (screen: ScreenState | null, findings: Finding[]) => Promise<void>;
  /** Invoked for each newly discovered screen so module auditors can inspect it. */
  onNewScreen: (state: ScreenState) => Promise<void>;
  /**
   * The planning layer. When present it drives action selection and the stop
   * decision; when omitted the explorer falls back to graph-driven DFS.
   */
  planner?: PlanningSession;
  /**
   * Cooperative cancellation. Polled between iterations; when it resolves true
   * the loop stops promptly so a user-requested stop takes effect mid-run.
   */
  shouldCancel?: () => Promise<boolean>;
}

/**
 * Most actions a single screen can receive before the explorer moves on. The
 * planner ranks candidates first, so this keeps the highest-value interactions
 * and drops the long tail of near-duplicate taps that would otherwise consume
 * the run's whole time budget on one page.
 */
const MAX_ACTIONS_PER_SCREEN = 10;

/**
 * Consecutive unreadable hierarchies tolerated before the run is declared dead.
 * Each failure triggers recovery (wake the device, answer a system dialog,
 * relaunch), so this is a ceiling on recovery attempts rather than a plain retry
 * count — the app is genuinely gone by the time it is reached.
 */
const MAX_OBSERVE_FAILURES = 5;

/**
 * Attempts to clear an interruption on any one screen. Ads without a close
 * control and hard paywalls exist; after this many tries the screen is tested in
 * whatever state it is in, and the limitation is recorded, so one unclearable
 * blocker cannot consume the run.
 */
const MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN = 3;

/**
 * How long to keep waiting for an app to present its first usable screen.
 *
 * A splash/launch screen is STATIC, so `waitForStableUi` correctly reports it as
 * settled — which is exactly why stability is the wrong signal for "the app is
 * ready". Without this wait the engine observed the splash, found no controls,
 * and ended the run in seconds having tested nothing. Cold starts on real
 * hardware routinely take 5–15s (longer with an app-open ad or a remote-config
 * fetch), so this is generous but bounded.
 */
const APP_READY_TIMEOUT_MS = 40_000;
/** Times a single transient screen may yield no actions before we move on. */
const MAX_TRANSIENT_WAITS = 6;

export interface Blocker {
  kind: 'ad' | 'paywall' | 'permission' | 'login';
  screen: string;
  detail: string;
  resolved: boolean;
}

export interface ExplorationResult {
  graph: ScreenGraph;
  statesVisited: ScreenState[];
  steps: number;
  blockers: Blocker[];
  /** Screens the engine could not get past — reported as coverage limits. */
  coverageLimits: string[];
  terminationReason: 'explored' | 'steps' | 'deadline' | 'app_gone' | 'coverage_met' | 'cancelled';
  adsDismissed: number;
  permissionsHandled: number;
  paywallsDismissed: number;
  popupsDismissed: number;
  /** Interruption chains cleared, and how much wall-clock they cost. */
  interruptionsCleared: number;
  interruptionMs: number;
  /** Successful returns to the screen an interruption had pulled us away from. */
  resumes: number;
  /** Recovery actions taken after a transient failure (dump/interaction/app gone). */
  recoveries: number;
  /** Why the run ended, in words, for the report. */
  terminationDetail: string;
}

/** Builds a full ScreenState from a live dump. */
export async function observeScreen(
  serial: string,
  appPackage: string,
  profile: DeviceProfile,
): Promise<ScreenState | null> {
  const stable = await waitForStableUi(serial, { timeoutMs: 5_000 });
  const xml = stable.xml || (await dumpHierarchy(serial));
  if (!xml) return null;
  const activity = stable.activity || (await focusedComponent(serial));
  return buildScreenState(xml, activity, appPackage, profile);
}

/**
 * Builds a ScreenState from a hierarchy that has ALREADY been dumped.
 *
 * Interactions settle the UI as part of executing, and that settle returns the
 * hierarchy it used to decide the screen was stable. Re-dumping it just to build
 * a ScreenState would pay the ~2s `uiautomator dump` cost twice per step, so the
 * explorer reuses the settle's own output instead.
 */
export function buildScreenState(
  xml: string,
  activityIn: string,
  appPackage: string,
  profile: DeviceProfile,
): ScreenState | null {
  if (!xml) return null;

  const { root, nodes, rotation } = parseHierarchy(xml);
  const activity = activityIn;
  const pkg = nodes[0]?.packageName || appPackage;

  const adVerdict = detectAd(nodes, activity, appPackage, profile.width, profile.height);
  const cls = classifyScreen({
    nodes,
    activity,
    packageName: pkg,
    width: profile.width,
    height: profile.height,
    // Only a blocking ad makes the SCREEN an ad; a banner inside a real screen
    // must not relabel that screen (it would distort the feature map too).
    adDetected: adVerdict.blocking,
  });

  return {
    signature: screenSignature(activity || pkg, nodes),
    activity: activity || '',
    packageName: pkg,
    kind: cls.kind,
    label: cls.label || labelFromActivity(activity),
    root,
    nodes,
    screenWidth: profile.width,
    screenHeight: profile.height,
    rotation,
    capturedAt: Date.now(),
  };
}

export async function explore(cfg: ExplorerConfig): Promise<ExplorationResult> {
  const graph = new ScreenGraph();
  const statesVisited: ScreenState[] = [];
  const blockers: Blocker[] = [];
  const coverageLimits: string[] = [];
  const seenSignatures = new Set<string>();
  /**
   * Perceptual fingerprints of screens already screenshotted. Guards against
   * capturing the same visible screen repeatedly while it settles/animates
   * (its structural signature churns but it looks identical to the user).
   */
  const capturedScreens = new Set<string>();
  /** Screens whose inline (non-blocking) ad was already recorded — log once. */
  const inlineAdsSeen = new Set<string>();
  /** Post-action observation reused as the next iteration's state (saves a dump). */
  let carried: ScreenState | null = null;
  /** Actions spent on each screen, so one busy page can't consume the whole run. */
  const actionsOnScreen = new Map<string, number>();
  /**
   * Interruption-clearing attempts per screen. Some blockers genuinely cannot be
   * cleared (an interstitial with no close control, a hard paywall); without a
   * cap the engine would retry on every visit and spend the run on one screen.
   */
  const interruptionAttempts = new Map<string, number>();
  const interruptionGaveUp = new Set<string>();
  /** Waits already spent on each transient (splash/loading) screen. */
  const transientWaits = new Map<string, number>();

  let steps = 0;
  let adsDismissed = 0;
  let permissionsHandled = 0;
  let paywallsDismissed = 0;
  let popupsDismissed = 0;
  let interruptionsCleared = 0;
  let interruptionMs = 0;
  let resumes = 0;
  let recoveries = 0;
  let externalReturns = 0;
  let externalNoted = false;
  let loginAttempted = false;
  let terminationReason: ExplorationResult['terminationReason'] = 'explored';
  let terminationDetail = 'Every discovered screen and action was exercised.';
  /** Consecutive iterations that produced no new screen and no new action. */
  let barrenStreak = 0;
  /** Consecutive failures to read the hierarchy, for bounded retry/recovery. */
  let observeFailures = 0;

  /**
   * The screen we were working on before an interruption pulled us elsewhere.
   * Dismissing an ad or paywall frequently lands somewhere other than where it
   * appeared (the ad's parent activity finishes, or BACK unwinds a level), so
   * the flow under test has to be re-entered rather than abandoned.
   */
  let resumeTarget: { signature: string; label: string } | null = null;

  const interruptionCtx = {
    serial: cfg.serial,
    packageName: cfg.packageName,
    profile: cfg.profile,
    log: cfg.log,
    capture: async (screenName: string, reason: 'ad' | 'paywall' | 'permission' | 'failure' | 'state_change', step?: string) =>
      cfg.screenshots.capture({ runId: cfg.runId, screenName, reason, step }),
  };

  /** Folds an interruption outcome into the run's counters, blockers and limits. */
  const absorb = (outcome: InterruptionOutcome, screenLabel: string) => {
    interruptionMs += outcome.totalMs;
    if (outcome.events.length > 0) interruptionsCleared += 1;
    for (const e of outcome.events) {
      if (e.resolved) {
        if (e.kind === 'ad') adsDismissed += 1;
        if (e.kind === 'paywall') paywallsDismissed += 1;
        if (e.kind === 'popup') popupsDismissed += 1;
        if (e.kind === 'permission') permissionsHandled += 1;
        if (e.kind === 'left_app') externalReturns += 1;
        if (e.kind === 'system_dialog' || e.kind === 'device_asleep' || e.kind === 'offline') recoveries += 1;
      }
      if (e.kind === 'ad' || e.kind === 'paywall' || e.kind === 'permission') {
        blockers.push({
          kind: e.kind === 'permission' ? 'permission' : e.kind,
          screen: e.screen,
          detail: `${e.detail}; ${e.attempts.join(' → ')}`,
          resolved: e.resolved,
        });
      }
      if (e.kind === 'ad' || e.kind === 'paywall') cfg.planner?.recordBlocker(e.kind, e.screen);
    }
    for (const e of outcome.unresolved) {
      coverageLimits.push(
        e.kind === 'ad'
          ? `An advertisement on "${e.screen}" could not be dismissed automatically (${e.detail}).`
          : e.kind === 'paywall'
            ? `A subscription paywall on "${e.screen}" blocked that flow; no purchase was attempted (${e.detail}).`
            : `${e.detail} on "${e.screen}" could not be cleared (${e.attempts.join(' → ') || 'no control found'}).`,
      );
    }
    if (outcome.events.some((e) => e.resolved && (e.kind === 'permission'))) {
      cfg.planner?.noteStateChange('permission', cfg.log);
    }
    void screenLabel;
  };

  /**
   * Walks a recorded edge path from the current screen back to `target`.
   * Replays real, previously-successful interactions instead of pressing BACK
   * blindly, which is what makes resuming a flow (and reaching deferred work)
   * actually land where intended.
   */
  const navigateTo = async (targetSig: string, why: string): Promise<boolean> => {
    const here = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
    if (!here) return false;
    if (here.signature === targetSig) { carried = here; return true; }

    const path = graph.pathBetween(here.signature, targetSig);
    if (!path || path.length === 0) return false;

    await cfg.log('debug', `${why}: replaying ${path.length} recorded step(s) back to the target screen.`);
    let state = here;
    for (const actionKey of path) {
      const actions = planInteractions(state, { appPackage: cfg.packageName });
      const match = actions.find((a) => a.key === actionKey);
      if (!match) return false;
      const exec = await performAndSettle(cfg.serial, state, match);
      if (!exec.ok) return false;
      const next = exec.settledXml && exec.settledActivity
        ? buildScreenState(exec.settledXml, exec.settledActivity, cfg.packageName, cfg.profile)
        : await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
      if (!next) return false;
      state = next;
    }
    carried = state;
    return state.signature === targetSig;
  };

  while (steps < cfg.maxSteps) {
    if (Date.now() > cfg.deadlineAt) {
      terminationReason = 'deadline';
      terminationDetail = 'The exploration time budget was reached.';
      break;
    }
    if (cfg.shouldCancel && (await cfg.shouldCancel())) {
      terminationReason = 'cancelled';
      terminationDetail = 'The run was cancelled by the user.';
      break;
    }

    // ---------------------------------------------------------- OBSERVE
    // A `uiautomator dump` costs ~2s on a real device, so we never observe the
    // same screen twice: the observation taken right after the previous action
    // IS this iteration's state. Only paths that change the screen behind our
    // back (blocker handling, backtracking) clear it and force a fresh dump.
    let state = carried ?? await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
    carried = null;

    // A missing hierarchy is usually transient (mid-transition, a secure window,
    // a dozing screen, or the app briefly gone). Retry with escalating recovery
    // instead of burning a step per failure and eventually running the whole
    // budget out against a blank screen.
    if (!state) {
      observeFailures += 1;
      if (observeFailures > MAX_OBSERVE_FAILURES) {
        terminationReason = 'app_gone';
        terminationDetail = `The UI hierarchy was unreadable ${observeFailures} times in a row; the device or app stopped responding.`;
        await cfg.screenshots.capture({
          runId: cfg.runId, screenName: 'Unreadable screen', reason: 'failure',
          step: `hierarchy unavailable ×${observeFailures}`,
        });
        break;
      }
      await cfg.log('warn',
        `UI hierarchy unavailable (attempt ${observeFailures}/${MAX_OBSERVE_FAILURES}) — attempting recovery.`);
      recoveries += 1;
      // Let the interruption handler wake a sleeping device, answer a system
      // dialog, or relaunch the app; then try to read the screen again.
      const outcome = await clearInterruptions(interruptionCtx, null);
      absorb(outcome, 'Unreadable screen');
      if (!outcome.usable) {
        const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
        if (!relaunch.ok) {
          terminationReason = 'app_gone';
          terminationDetail = 'The app could not be relaunched after the screen became unreadable.';
          break;
        }
        await waitForStableUi(cfg.serial, { timeoutMs: 5_000 });
      }
      continue; // recovery iterations don't consume the interaction budget
    }
    observeFailures = 0;

    // -------------------------------------------------- HANDLE INTERRUPTIONS
    // One call clears the entire chain in front of us — ads, paywalls,
    // permission prompts, product pop-ups, platform ANR/crash dialogs, loading
    // and offline states, and navigation that left the app. Handling them here,
    // together and before anything else, is what stops a chain of blockers from
    // consuming one exploration step (and one full dump) per link.
    const priorAttempts = interruptionAttempts.get(state.signature) ?? 0;
    if (
      needsInterruptionHandling(state, cfg.packageName, cfg.profile.width, cfg.profile.height)
      && priorAttempts < MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN
    ) {
      interruptionAttempts.set(state.signature, priorAttempts + 1);
      // Remember where the flow was so it can be resumed afterwards.
      if (graph.has(state.signature)) resumeTarget = { signature: state.signature, label: state.label };

      // Never spend more on one chain than the run has left.
      const remainingMs = cfg.deadlineAt - Date.now();
      const outcome = await clearInterruptions(
        { ...interruptionCtx, budgetMs: Math.max(10_000, Math.min(120_000, remainingMs - 15_000)) },
        state,
      );
      absorb(outcome, state.label);

      // Nothing was actionable on this screen after all. Fall through and test
      // it as an ordinary screen: re-running detection on an unchanged screen
      // and `continue`-ing would spin without ever consuming a step, leaving the
      // run stuck here until its deadline.
      if (outcome.events.length === 0) {
        await cfg.log('debug',
          `"${state.label}" looked interrupted but nothing was actionable — testing it as an ordinary screen.`);
        interruptionAttempts.set(state.signature, MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN);
        resumeTarget = null;
      } else {
        if (!outcome.usable) {
          const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
          if (!relaunch.ok) {
            terminationReason = 'app_gone';
            terminationDetail = 'The app left the foreground during interruption handling and could not be relaunched.';
            await cfg.screenshots.capture({
              runId: cfg.runId, screenName: state.label, reason: 'failure', step: 'app gone after interruption',
            });
            break;
          }
          recoveries += 1;
          await waitForStableUi(cfg.serial, { timeoutMs: 5_000 });
        }

        // ---------------------------------------------------------- RESUME
        // Return to the interrupted screen so the flow continues from where it
        // was, rather than restarting from whatever the dismissal revealed.
        if (resumeTarget) {
          const back = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
          if (back && back.signature === resumeTarget.signature) {
            carried = back;
            await cfg.log('debug', `Resumed "${resumeTarget.label}" — the interruption cleared in place.`);
          } else if (back) {
            const returned = await navigateTo(
              resumeTarget.signature, `Resuming "${resumeTarget.label}" after an interruption`);
            if (returned) {
              resumes += 1;
              await cfg.log('info', `Resumed the interrupted flow on "${resumeTarget.label}".`);
            } else {
              carried = back;
              await cfg.log('info',
                `Could not navigate back to "${resumeTarget.label}" after the interruption — continuing from "${back.label}".`);
            }
          }
          resumeTarget = null;
        }
        continue; // interruption handling doesn't consume the interaction budget
      }
    } else if (priorAttempts >= MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN && !interruptionGaveUp.has(state.signature)) {
      // Tried and failed the allowed number of times on this exact screen. Stop
      // re-attempting — otherwise a blocker that simply cannot be cleared (an ad
      // with no close control, a hard paywall) would be retried on every visit,
      // spending the remaining run on it — and record the limitation once.
      interruptionGaveUp.add(state.signature);
      coverageLimits.push(
        `An interruption on "${state.label}" could not be cleared after ${MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN} attempts; `
        + 'the screen was tested in the state it was left in.',
      );
      await cfg.log('warn',
        `Giving up on clearing the interruption on "${state.label}" after ${MAX_INTERRUPTION_ATTEMPTS_PER_SCREEN} attempts — `
        + 'continuing so the rest of the app is still covered.');
      await cfg.screenshots.capture({
        runId: cfg.runId, screenName: state.label, reason: 'failure', step: 'interruption could not be cleared',
      });
    }
    resumeTarget = null;

    // Inline (non-blocking, non-closable) ads are recorded once as evidence.
    // The interruption handler above already closed any ad offering a dismiss
    // control; what reaches here is a banner baked into a usable screen, which
    // is explored around rather than fought with.
    const ad = detectAd(state.nodes, state.activity, cfg.packageName, cfg.profile.width, cfg.profile.height);
    if (ad.isAd && !ad.blocking && !inlineAdsSeen.has(state.signature)) {
      inlineAdsSeen.add(state.signature);
      cfg.planner?.recordBlocker('ad', state.label);
      await cfg.log('info', `Inline ad on "${state.label}" (${ad.reason}) — no close control; testing the screen around it.`);
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: `Ad — ${state.label}`, reason: 'ad', step: ad.reason });
    }

    // Login walls — use configured credentials, else a guest path.
    if (!loginAttempted && (state.kind === 'login' || inspectLoginForm(state.nodes).present)) {
      loginAttempted = true;
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: state.label, reason: 'state_change', step: 'login screen' });
      const res = await attemptLogin(cfg.serial, cfg.credentials);
      blockers.push({ kind: 'login', screen: state.label, detail: res.note, resolved: res.attempted });
      await cfg.log(res.attempted ? 'info' : 'warn', `Login handling: ${res.note}`);
      if (!res.attempted) {
        coverageLimits.push(`Login is required on "${state.label}" and no QA credentials are configured — authenticated flows were not covered.`);
      } else {
        // Authentication typically reveals a whole authenticated app — revisit everything.
        cfg.planner?.noteStateChange('login', cfg.log);
      }
      steps += 1;
      continue;
    }

    // Leaving the app (external browser, launcher, another app, an ad SDK's own
    // activity) is handled by clearInterruptions above, which presses BACK and
    // relaunches if needed — a screen not owned by the app under test never
    // reaches this point, and is never registered or acted on.
    if (externalReturns >= 8 && !externalNoted) {
      externalNoted = true;
      coverageLimits.push('The app repeatedly navigated outside itself (external links/ads); the agent was kept in-app.');
    }

    // ------------------------------------- WAIT FOR THE APP TO BECOME USABLE
    // A launch/splash screen offers nothing to interact with, and because it is
    // static the settle logic reports it as a finished screen. Acting on that
    // conclusion ended runs in seconds with the app barely open: no actions →
    // backtrack → BACK exits the app → "nothing left to do".
    //
    // So when a transient screen yields no actions, WAIT for the app to render
    // its real first screen instead of concluding there is nothing to test.
    // Bounded per screen, and it never consumes an interaction step.
    const provisionalActions = planInteractions(state, { appPackage: cfg.packageName });
    const transient = state.kind === 'splash' || state.kind === 'unknown';
    if (provisionalActions.length === 0 && transient) {
      const waited = transientWaits.get(state.signature) ?? 0;
      if (waited < MAX_TRANSIENT_WAITS) {
        transientWaits.set(state.signature, waited + 1);
        await cfg.log(waited === 0 ? 'info' : 'debug',
          `"${state.label}" [${state.kind}] has no interactive controls yet — waiting for the app to finish `
          + `presenting its first screen (attempt ${waited + 1}/${MAX_TRANSIENT_WAITS}).`);

        // Poll for a screen that actually offers something to do. An app-open ad
        // or a permission prompt arriving during startup is cleared by the
        // interruption handler on the next iteration.
        const waitingOn = state; // non-null capture for the predicate below
        const appeared = await waitUntil(
          cfg.serial,
          (xml) => {
            const next = buildScreenState(xml, waitingOn.activity, cfg.packageName, cfg.profile);
            if (!next) return false;
            if (next.signature !== waitingOn.signature) return true; // the screen moved on
            return planInteractions(next, { appPackage: cfg.packageName }).length > 0;
          },
          Math.min(APP_READY_TIMEOUT_MS, Math.max(5_000, cfg.deadlineAt - Date.now() - 20_000)),
        );

        if (appeared) {
          const ready = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
          if (ready) {
            await cfg.log('info', `App is ready — now on "${ready.label}" [${ready.kind}].`);
            carried = ready;
            continue;
          }
        }
        await cfg.log('warn',
          `"${state.label}" still offers no interactive controls after waiting — recording it and moving on.`);
        // Fall through: register the screen so the modules audit it honestly.
      }
    }

    // ------------------------------------------------- REGISTER + REPORT
    const isNew = !seenSignatures.has(state.signature);
    const actions = provisionalActions;
    const node = graph.observe(state, actions.map((a) => a.key));

    // Planning layer: grow the feature map and (re)activate goals for this screen.
    const planned = cfg.planner?.onScreen(state, steps);

    if (isNew) {
      seenSignatures.add(state.signature);
      statesVisited.push(state);
      barrenStreak = 0;
      const featureNote = planned && planned.features.length
        ? ` — features: ${planned.features.map((f) => f.name).slice(0, 4).join(', ')}`
        : '';
      await cfg.log('info', `New screen: "${state.label}" [${state.kind}] — ${actions.length} action(s) available${featureNote}.`);
      const perceptual = perceptualSignature(state.activity || state.packageName, state.nodes);
      if (!capturedScreens.has(perceptual)) {
        capturedScreens.add(perceptual);
        await cfg.screenshots.capture({
          runId: cfg.runId, screenName: state.label, reason: 'navigation', step: state.activity,
        });
      }
      await cfg.onNewScreen(state);
    } else {
      barrenStreak += 1;
    }

    await cfg.progress(state.label, `Exploring "${state.label}"`, graph.size);

    // Crash signals surface asynchronously — check every iteration.
    const fresh = await cfg.crashes.poll();
    if (fresh.length > 0) {
      const crashScreen = state; // non-null capture for the closure below
      const shot = await cfg.screenshots.capture({
        runId: cfg.runId, screenName: crashScreen.label, reason: 'crash', step: fresh[0].title,
      });
      const findings: Finding[] = fresh.map((c) => ({
        type: c.kind === 'anr' ? 'anr' : 'crash',
        module: c.kind === 'anr' ? 'ANR Detection' : 'Crash Detection',
        severity: 'critical',
        title: c.title,
        description: `A ${c.kind === 'anr' ? 'application-not-responding event' : 'fatal crash'} was captured from logcat while exercising "${crashScreen.label}".`,
        screenName: crashScreen.label,
        activity: crashScreen.activity,
        stepsToReproduce: [
          `Launch ${cfg.packageName}`,
          `Navigate to "${crashScreen.label}"`,
          'Interact with the screen as the automated run did',
          'Observe the failure in logcat',
        ],
        expectedResult: 'The app remains responsive and does not terminate.',
        actualResult: c.kind === 'anr' ? 'The app stopped responding (ANR).' : 'The app crashed with a fatal exception.',
        evidence: c.evidence,
        rootCause: c.kind === 'anr'
          ? 'The main thread was blocked beyond the ANR threshold — typically synchronous I/O, a long computation, or lock contention on the UI thread.'
          : 'An unhandled exception propagated to the top of the stack; see the attached trace for the throwing frame.',
        suggestedFix: c.kind === 'anr'
          ? 'Move blocking work off the main thread (coroutines/WorkManager) and profile with StrictMode to find main-thread I/O.'
          : 'Fix the defect at the throwing frame and add defensive handling for the null/invalid state that triggered it.',
        stackTrace: c.stackTrace,
        screenshotDataUrl: shot,
      }));
      await cfg.onCrash(crashScreen, findings);
      // Remember this crash location so future runs revisit the failing feature first.
      cfg.planner?.recordCrashLocation(crashScreen.signature, crashScreen.label, fresh[0].title);

      // After a crash the app may be gone — bring it back so exploration continues.
      if (!(await isAppForeground(cfg.serial, cfg.packageName))) {
        await cfg.log('warn', 'App is no longer foreground after the failure — relaunching.');
        const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
        if (!relaunch.ok) { terminationReason = 'app_gone'; break; }
        steps += 1;
        continue;
      }
    }

    // ----------------------------------------------------------- DECIDE
    // The planner is the SINGLE decision maker: given this screen and the
    // enumerated candidates it returns act / backtrack / stop. The explorer
    // only performs the mechanical device work each decision implies. Without a
    // planner it falls back to the original graph-driven DFS.
    // Returning to a screen whose long tail was parked restores it, so the
    // budget is per VISIT rather than a one-time cap on the screen.
    const spentHere = actionsOnScreen.get(state.signature) ?? 0;
    if (spentHere === 0 && node.deferredActions.size > 0) {
      const restored = graph.restoreDeferred(state.signature);
      if (restored > 0) {
        await cfg.log('debug', `"${state.label}": restored ${restored} deferred action(s) for this visit.`);
      }
    }

    let pending = actions.filter((a) => node.pendingActions.has(a.key));

    // Per-visit action budget. Exhaustively tapping every control on a busy page
    // (feeds and settings screens routinely expose 30–50) would consume the
    // entire run on one screen and never reach the app's other features. Once
    // the budget is spent the remainder is DEFERRED — parked for a later visit,
    // not retired. Retiring them (which is what markTried did here) recorded
    // untried controls as tried: the screen went `exhausted`, the graph frontier
    // emptied, and the planner concluded the whole run was finished while most
    // of the app had never been touched. The highest-value actions still run
    // first, because the planner ranks before any budget is spent.
    if (pending.length > 0 && spentHere >= MAX_ACTIONS_PER_SCREEN) {
      for (const a of pending) graph.defer(state.signature, a.key);
      await cfg.log('debug',
        `"${state.label}": per-visit budget of ${MAX_ACTIONS_PER_SCREEN} action(s) spent — `
        + `deferring ${pending.length} action(s) and moving on to unmet goals.`);
      pending = [];
      // A new visit gets a fresh budget.
      actionsOnScreen.delete(state.signature);
    }

    let action: Interaction | null = null;
    let decisionNote = '';
    let doBacktrack = false;

    if (cfg.planner) {
      const decision = await cfg.planner.decide(state, pending, graph);
      if (decision.kind === 'stop') {
        await cfg.log('info', `Planner: stopping — ${decision.reason}`);
        terminationReason = 'coverage_met';
        terminationDetail = decision.reason;
        break;
      }
      if (decision.kind === 'backtrack') { doBacktrack = true; decisionNote = decision.reason; }
      else { action = decision.interaction ?? pending[0]; decisionNote = `[${decision.source}] ${decision.reason}`; }
    } else if (pending.length === 0) {
      if (graph.isFullyExplored()) { terminationReason = 'explored'; break; }
      doBacktrack = true;
    } else {
      action = pending[0];
      decisionNote = action.reason;
    }

    // ------------------------------------------------------- BACKTRACK
    if (doBacktrack) {
      await cfg.log('debug', `"${state.label}" exhausted — ${decisionNote || 'backtracking to find unexplored screens.'}`);

      // Navigate to a screen that still has work, by REPLAYING the recorded
      // route to it. Blind BACK presses (all this used to do) unwind the stack
      // without any idea of where the remaining work is, so the agent would
      // wander, exit the app, and hit the barren-backtrack limit with whole
      // features untouched. The route is real: every edge in it was executed
      // successfully earlier in this run.
      let navigated = false;
      const hereSig = state.signature;
      const targets = [...graph.frontier(), ...graph.deferredFrontier()]
        .filter((n) => n.signature !== hereSig);
      const route = graph.pathToWork(hereSig);
      if (route && route.path.length > 0) {
        navigated = await navigateTo(route.target, 'Navigating to a screen with outstanding work');
        if (navigated) {
          await cfg.log('debug', `Reached "${graph.get(route.target)?.label ?? route.target}" with work remaining.`);
        }
      }

      // No recorded route (or the replay diverged) — fall back to BACK, which
      // still reliably unwinds toward earlier screens.
      //
      // But BACK from the app's FIRST screen leaves the app entirely. Doing that
      // when nothing has been explored yet is how a run ended having tested
      // nothing: the launch screen offered no actions, BACK closed the app, and
      // "no screen has outstanding work" was read as a completed run. When there
      // is nowhere to go and nothing has been explored, relaunch and let the
      // app-ready wait above try again instead.
      const nowhereToGo = targets.length === 0 && !cfg.planner?.reexplorePending;
      if (!navigated && nowhereToGo && graph.size <= 1) {
        await cfg.log('warn',
          `Nothing is reachable from "${state.label}" and no other screen has work — `
          + 'relaunching the app rather than pressing BACK out of it.');
        recoveries += 1;
        await startAppTimed(cfg.serial, cfg.packageName);
        await waitForStableUi(cfg.serial, { timeoutMs: 6_000 });
        steps += 1;
        // Allow the app-ready wait to run again on the relaunched session.
        transientWaits.clear();
        continue;
      }

      if (!navigated) {
        await pressKey(cfg.serial, KEY.BACK);
        await waitForStableUi(cfg.serial, { timeoutMs: 4_000 });
        if (nowhereToGo) {
          await cfg.log('debug', 'No screen with outstanding work remains to navigate to.');
        }
      }
      steps += 1;

      // If we ended up outside the app, relaunch to resume from a known state.
      if (!(await isAppForeground(cfg.serial, cfg.packageName))) {
        if (targets.length === 0 && !cfg.planner?.reexplorePending) {
          terminationReason = cfg.planner ? 'coverage_met' : 'explored';
          terminationDetail = 'Backtracking left the app and no screen with outstanding work remained.';
          break;
        }
        await cfg.log('debug', 'Backtracking exited the app — relaunching to continue exploration.');
        const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
        if (!relaunch.ok) {
          terminationReason = 'app_gone';
          terminationDetail = 'The app could not be relaunched after backtracking exited it.';
          break;
        }
        recoveries += 1;
      }

      // Legacy safety guard only — the planner has its own barren-backtrack limit.
      if (!cfg.planner && barrenStreak > 14) {
        await cfg.log('warn', 'No new screens reachable after repeated backtracking — ending exploration.');
        terminationReason = 'explored';
        terminationDetail = 'No new screens were reachable after repeated backtracking.';
        break;
      }
      continue;
    }

    // ------------------------------------------------------------- ACT
    if (!action) continue; // unreachable, but keeps the type checker honest
    graph.markTried(state.signature, action.key);
    actionsOnScreen.set(state.signature, (actionsOnScreen.get(state.signature) ?? 0) + 1);

    await cfg.log('debug', `${decisionNote} → ${action.reason} on "${state.label}"`);
    const before = state.signature;
    const exec = await performAndSettle(cfg.serial, state, action);
    steps += 1;

    if (!exec.ok) {
      // A gesture can fail transiently: the target moved as the screen settled,
      // the IME covered it, or an interruption appeared between planning and
      // execution. Capture evidence, clear anything that has appeared, and retry
      // the same action once before giving up on it.
      await cfg.log('warn', `Interaction failed on "${state.label}": ${exec.note} — attempting recovery.`);
      await cfg.screenshots.capture({
        runId: cfg.runId, screenName: state.label, reason: 'failure', step: `${action.reason} — ${exec.note}`,
      });
      recoveries += 1;

      const outcome = await clearInterruptions(interruptionCtx, null);
      absorb(outcome, state.label);

      const recheck = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
      if (recheck && recheck.signature === state.signature) {
        const retryAction = planInteractions(recheck, { appPackage: cfg.packageName })
          .find((a) => a.key === action!.key);
        if (retryAction) {
          const retry = await performAndSettle(cfg.serial, recheck, retryAction);
          if (retry.ok) {
            await cfg.log('info', `Retry of "${action.reason}" succeeded after recovery.`);
            const afterRetry = retry.settledXml && retry.settledActivity
              ? buildScreenState(retry.settledXml, retry.settledActivity, cfg.packageName, cfg.profile)
              : await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
            const movedOn = !!afterRetry && afterRetry.signature !== state.signature;
            graph.addEdge(state.signature, afterRetry?.signature ?? state.signature, action.key, movedOn);
            cfg.planner?.recordResult(state, action, movedOn);
            carried = afterRetry;
            continue;
          }
        }
      }
      await cfg.log('warn', `"${action.reason}" could not be executed after recovery — moving on.`);
      cfg.planner?.recordResult(state, action, false);
      carried = recheck;
      continue;
    }

    // ------------------------------------------------------- OBSERVE RESULT
    // The interaction already settled the UI and handed back the hierarchy it
    // settled on — build the post-action state from that rather than paying for
    // another dump. Only fall back to a fresh observation if it wasn't captured.
    // Both parts are required: screen signatures are keyed on the activity, so
    // reusing a settle that timed out before resolving one would collapse
    // distinct screens onto the same graph node.
    const after = exec.settledXml && exec.settledActivity
      ? buildScreenState(exec.settledXml, exec.settledActivity, cfg.packageName, cfg.profile)
      : await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
    const navigated = !!after && after.signature !== before;
    graph.addEdge(before, after?.signature ?? before, action.key, navigated);
    cfg.planner?.recordResult(state, action, navigated);
    // Reuse this observation next iteration instead of dumping the screen again.
    carried = after;

    if (navigated && after) {
      const perceptual = perceptualSignature(after.activity || after.packageName, after.nodes);
      if (!capturedScreens.has(perceptual)) {
        capturedScreens.add(perceptual);
        await cfg.screenshots.capture({
          runId: cfg.runId,
          screenName: after.label,
          reason: 'after_interaction',
          step: action.reason,
        });
      }
    }
  }

  if (steps >= cfg.maxSteps && terminationReason === 'explored') {
    terminationReason = 'steps';
    terminationDetail = `The interaction budget of ${cfg.maxSteps} step(s) was spent.`;
  }

  return {
    graph,
    statesVisited,
    steps,
    blockers,
    coverageLimits,
    terminationReason,
    terminationDetail,
    adsDismissed,
    permissionsHandled,
    paywallsDismissed,
    popupsDismissed,
    interruptionsCleared,
    interruptionMs,
    resumes,
    recoveries,
  };
}
