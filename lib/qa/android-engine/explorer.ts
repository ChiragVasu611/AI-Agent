import type { Finding, Interaction, ScreenState, UiNode } from './types';
import type { DeviceProfile } from './types';
import { dumpHierarchy, focusedComponent, pressKey, KEY, isAppForeground, startAppTimed } from './device';
import { parseHierarchy } from './ui-parser';
import { classifyScreen, screenSignature, labelFromActivity } from './screen-classifier';
import { detectAd, dismissAd, hasCountdown } from './ad-detector';
import { detectPaywall, escapePaywall } from './paywall-detector';
import { handleAllPermissions } from './permission-handler';
import { attemptLogin, inspectLoginForm, type QaCredentials } from './login-handler';
import { planInteractions, performAndSettle, actionKey } from './interaction-engine';
import { ScreenGraph } from './graph';
import { waitForStableUi } from './smart-wait';
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

  const { root, nodes, rotation } = parseHierarchy(xml);
  const activity = stable.activity || (await focusedComponent(serial));
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
  /** Screens whose inline (non-blocking) ad was already recorded — log once. */
  const inlineAdsSeen = new Set<string>();

  let steps = 0;
  let adsDismissed = 0;
  let permissionsHandled = 0;
  let externalReturns = 0;
  let loginAttempted = false;
  let terminationReason: ExplorationResult['terminationReason'] = 'explored';
  /** Consecutive iterations that produced no new screen and no new action. */
  let barrenStreak = 0;

  while (steps < cfg.maxSteps) {
    if (Date.now() > cfg.deadlineAt) { terminationReason = 'deadline'; break; }
    if (cfg.shouldCancel && (await cfg.shouldCancel())) { terminationReason = 'cancelled'; break; }

    // ---------------------------------------------------------- OBSERVE
    let state = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
    if (!state) {
      await cfg.log('warn', 'UI hierarchy unavailable — retrying.');
      steps += 1;
      continue;
    }

    // -------------------------------------------------- HANDLE BLOCKERS
    // 1. Permission dialogs — grant so gated features stay reachable.
    if (state.kind === 'permission_dialog') {
      const events = await handleAllPermissions(cfg.serial, true);
      permissionsHandled += events.length;
      for (const ev of events) {
        await cfg.log('info', `Permission ${ev.action}: ${ev.message.slice(0, 80)}`);
        blockers.push({ kind: 'permission', screen: state.label, detail: ev.message, resolved: ev.action !== 'unhandled' });
      }
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: 'Permission Dialog', reason: 'permission' });
      // Granting a permission can unlock camera/location/storage features — revisit.
      if (events.some((ev) => ev.action !== 'unhandled')) cfg.planner?.noteStateChange('permission', cfg.log);
      steps += 1;
      continue;
    }

    // 2. Advertisements — only a BLOCKING ad (full-screen interstitial/rewarded
    //    /app-open) is dismissed. An inline banner or native ad on an otherwise
    //    usable screen is recorded and skipped over, and exploration continues
    //    normally; treating those as blocking used to make the engine press
    //    BACK until it left the app and sat on the home screen doing nothing.
    const ad = detectAd(state.nodes, state.activity, cfg.packageName, cfg.profile.width, cfg.profile.height);
    if (ad.isAd && !ad.blocking && !inlineAdsSeen.has(state.signature)) {
      inlineAdsSeen.add(state.signature);
      cfg.planner?.recordBlocker('ad', state.label);
      await cfg.log('info', `Inline ad on "${state.label}" (${ad.reason}) — continuing to test the screen around it.`);
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: `Ad — ${state.label}`, reason: 'ad', step: ad.reason });
    }
    if (ad.blocking) {
      await cfg.log('info', `Advertisement detected (${ad.reason}). Waiting for a dismiss control…`);
      cfg.planner?.recordBlocker('ad', state.label);
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: `Ad — ${state.label}`, reason: 'ad', step: ad.reason });
      const countdown = hasCountdown(state.nodes);
      const res = await dismissAd(
        cfg.serial, cfg.packageName, cfg.profile.width, cfg.profile.height,
        countdown ? 45_000 : 20_000,
      );
      if (res.dismissed) adsDismissed += 1;
      blockers.push({
        kind: 'ad',
        screen: state.label,
        detail: `${ad.reason}; ${res.attempts.join(' → ')}`,
        resolved: res.dismissed,
      });
      await cfg.log(res.dismissed ? 'info' : 'warn',
        res.dismissed ? `Ad dismissed after ${Math.round(res.waitedMs / 1000)}s.` : 'Could not dismiss the advertisement.');
      if (!res.dismissed) {
        // dismissAd already tried BACK (and relaunched if that exited the app).
        // Pressing BACK again here is what used to walk the agent out to the
        // launcher — instead, make sure the app is foreground and carry on.
        coverageLimits.push(`An advertisement on "${state.label}" could not be dismissed automatically.`);
        if (!(await isAppForeground(cfg.serial, cfg.packageName))) {
          await cfg.log('warn', 'Ad left the app in the background — relaunching to continue testing.');
          const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
          if (!relaunch.ok) { terminationReason = 'app_gone'; break; }
        }
      }
      steps += 1;
      continue;
    }

    // 3. Paywalls — try to escape; never purchase.
    const paywall = detectPaywall(state.nodes, cfg.packageName, cfg.profile.width, cfg.profile.height);
    if (paywall.isPaywall && paywall.blocking) {
      await cfg.log('info', `Paywall detected (${paywall.reason}). Attempting to continue without purchasing…`);
      cfg.planner?.recordBlocker('paywall', state.label);
      await cfg.screenshots.capture({ runId: cfg.runId, screenName: `Paywall — ${state.label}`, reason: 'paywall', step: paywall.reason });
      const esc = await escapePaywall(cfg.serial, cfg.packageName, cfg.profile.width, cfg.profile.height);
      blockers.push({
        kind: 'paywall',
        screen: state.label,
        detail: `${paywall.reason}; ${esc.attempts.join(' → ')}`,
        resolved: esc.escaped,
      });
      if (!esc.escaped) {
        coverageLimits.push(`A subscription paywall on "${state.label}" blocked further exploration of that flow (no purchase was attempted).`);
        await cfg.log('warn', 'Paywall could not be dismissed — recording the limitation and continuing elsewhere.');
        // Mark this screen exhausted so the planner stops returning to it.
        graph.observe(state, []);
        await pressKey(cfg.serial, KEY.BACK);
        await waitForStableUi(cfg.serial, { timeoutMs: 4_000 });
      } else {
        await cfg.log('info', 'Paywall dismissed.');
      }
      steps += 1;
      continue;
    }

    // 4. Login walls — use configured credentials, else a guest path.
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

    // 5. Left the app entirely (external browser, launcher, another app, an ad
    //    SDK's own activity, system UI). Any screen NOT owned by the app under
    //    test is off-limits: we immediately navigate back, relaunching if Back
    //    didn't return us, and never register or act on it. This is what keeps
    //    the agent inside the application instead of driving other apps.
    if (state.packageName && cfg.packageName && !state.packageName.startsWith(cfg.packageName)) {
      await cfg.log('debug', `Outside the app (now showing ${state.packageName}) — returning to ${cfg.packageName}.`);
      await pressKey(cfg.serial, KEY.BACK);
      await waitForStableUi(cfg.serial, { timeoutMs: 4_000 });
      if (!(await isAppForeground(cfg.serial, cfg.packageName))) {
        const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
        if (!relaunch.ok) { terminationReason = 'app_gone'; break; }
      }
      externalReturns += 1;
      if (externalReturns === 8) {
        coverageLimits.push('The app repeatedly navigated outside itself (external links/ads); the agent was kept in-app.');
      }
      steps += 1;
      continue;
    }

    // ------------------------------------------------- REGISTER + REPORT
    const isNew = !seenSignatures.has(state.signature);
    const actions = planInteractions(state, { appPackage: cfg.packageName });
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
      await cfg.screenshots.capture({
        runId: cfg.runId, screenName: state.label, reason: 'navigation', step: state.activity,
      });
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
    const pending = actions.filter((a) => node.pendingActions.has(a.key));

    let action: Interaction | null = null;
    let decisionNote = '';
    let doBacktrack = false;

    if (cfg.planner) {
      const decision = await cfg.planner.decide(state, pending, graph);
      if (decision.kind === 'stop') {
        await cfg.log('info', `Planner: stopping — ${decision.reason}`);
        terminationReason = 'coverage_met';
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
      await pressKey(cfg.serial, KEY.BACK);
      await waitForStableUi(cfg.serial, { timeoutMs: 4_000 });
      steps += 1;

      // If Back left the app, relaunch to resume from a known state.
      if (!(await isAppForeground(cfg.serial, cfg.packageName))) {
        if (graph.frontier().length === 0 && !cfg.planner?.reexplorePending) {
          terminationReason = cfg.planner ? 'coverage_met' : 'explored';
          break;
        }
        await cfg.log('debug', 'Back exited the app — relaunching to continue exploration.');
        const relaunch = await startAppTimed(cfg.serial, cfg.packageName);
        if (!relaunch.ok) { terminationReason = 'app_gone'; break; }
      }

      // Legacy safety guard only — the planner has its own barren-backtrack limit.
      if (!cfg.planner && barrenStreak > 14) {
        await cfg.log('warn', 'No new screens reachable after repeated backtracking — ending exploration.');
        terminationReason = 'explored';
        break;
      }
      continue;
    }

    // ------------------------------------------------------------- ACT
    if (!action) continue; // unreachable, but keeps the type checker honest
    graph.markTried(state.signature, action.key);

    await cfg.log('debug', `${decisionNote} → ${action.reason} on "${state.label}"`);
    const before = state.signature;
    const exec = await performAndSettle(cfg.serial, state, action);
    steps += 1;

    if (!exec.ok) {
      await cfg.log('warn', `Interaction failed: ${exec.note}`);
      cfg.planner?.recordResult(state, action, false);
      continue;
    }

    // ------------------------------------------------------- OBSERVE RESULT
    const after = await observeScreen(cfg.serial, cfg.packageName, cfg.profile);
    const navigated = !!after && after.signature !== before;
    graph.addEdge(before, after?.signature ?? before, action.key, navigated);
    cfg.planner?.recordResult(state, action, navigated);

    if (navigated && after) {
      await cfg.screenshots.capture({
        runId: cfg.runId,
        screenName: after.label,
        reason: 'after_interaction',
        step: action.reason,
      });
    }
  }

  if (steps >= cfg.maxSteps && terminationReason === 'explored') terminationReason = 'steps';

  return {
    graph,
    statesVisited,
    steps,
    blockers,
    coverageLimits,
    terminationReason,
    adsDismissed,
    permissionsHandled,
  };
}
