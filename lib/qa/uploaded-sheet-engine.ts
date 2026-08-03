/**
 * Real step-by-step execution of an uploaded test sheet against a physically
 * connected Android device.
 *
 * The app is installed, launched, and confirmed in the foreground before the
 * first step runs. Every step performs a genuine tap/type/scroll resolved from
 * the live view hierarchy, every screenshot is a real device capture, and every
 * PASS is backed by an assertion against what is actually on screen.
 */

import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { interpretStepParts } from '@/lib/qa/step-interpreter';
import {
  captureDeviceScreen, detectCrashes, crashSignature, readLogcat, stopApp, ensureAppForeground,
  dismissBlockingOverlay, advancePastGateScreen, escapeAdSurface, foregroundPackage, launchApp,
  type CrashSignal,
} from '@/lib/qa/android-bridge';
import { planExpectations } from '@/lib/qa/expected-results';
import {
  executeAndroidStep, validateAndroidExpectation, currentAndroidScreen,
  type ValidationContext,
} from '@/lib/qa/android-step-executor';
import type { PreparationResult } from '@/lib/qa/app-preparation';
import { log } from '@/lib/qa/runtime-helpers';
import type { QaPriority, QaSeverity } from '@/lib/types';

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_PRIORITIES = new Set(['p1', 'p2', 'p3', 'p4']);

/**
 * How many intermediate screens the engine will walk forward through while
 * looking for the control a step names. Enough to clear a realistic first-run
 * gauntlet (language → onboarding slides → consent), bounded so a genuinely
 * missing control still fails instead of clicking through the whole app.
 */
const MAX_GATE_HOPS = 6;

/**
 * Did the step fail purely because the element it names is not on this screen?
 * Only those failures justify walking forward to look for it — a disabled
 * control, a stuck loading screen, or a tap that had no effect are real defects
 * and must be reported, not navigated away from.
 */
function isTargetMissing(detail: string): boolean {
  return /No on-screen element matching|No text field matching|No control was available|No checkbox matching|No dropdown matching|is on screen but is not an interactive control/i.test(detail);
}

function normalizeSeverity(raw: string): QaSeverity {
  const s = String(raw ?? '').toLowerCase();
  return (VALID_SEVERITIES.has(s) ? s : 'medium') as QaSeverity;
}

function normalizePriority(raw: string, severity: QaSeverity): QaPriority {
  const p = String(raw ?? '').toLowerCase();
  if (VALID_PRIORITIES.has(p)) return p as QaPriority;
  return (severity === 'critical' || severity === 'high' ? 'p1' : severity === 'medium' ? 'p2' : 'p3') as QaPriority;
}

interface StepRecord {
  stepNumber: number;
  action: string;
  instruction: string;
  status: 'pass' | 'fail' | 'blocked' | 'skipped';
  actual: string;
  assertion: string;
  durationMs: number;
  url: string;
  screenshotDataUrl: string | null;
  /** The expectation this step was judged against, when the sheet gave it one. */
  expected?: string;
  /**
   * True only when the expectation was actually asserted against the screen.
   * A PASS with verified:false means the step executed successfully but its
   * expected result was not machine-checkable — real, but needing a human eye.
   */
  verified?: boolean;
}

/**
 * The application is launched ONCE, during preparation, and the same session is
 * kept for the whole suite. Between cases and between steps the app is only ever
 * *re-fronted* — never force-stopped — because restarting discards the very
 * session the sheet is walking through, and doing it per case is what made the
 * app visibly close and reopen throughout a run.
 *
 * `allowColdRestart` is therefore false here. The single exception is a genuine
 * crash, handled by `recoverFromCrash` below.
 */
async function refocusApp(serial: string, pkg: string, avoidAds: boolean) {
  return ensureAppForeground(serial, pkg, avoidAds, { allowColdRestart: false });
}

/**
 * The one legitimate reason to restart the app mid-suite: its process actually
 * died. A crashed process cannot be re-fronted, so here — and only here — the
 * cold-restart rung is unlocked.
 */
async function recoverFromCrash(serial: string, pkg: string, avoidAds: boolean) {
  return ensureAppForeground(serial, pkg, avoidAds, { allowColdRestart: true });
}

export interface AndroidRunTotals {
  passed: number; failed: number; blocked: number; skipped: number; bugSeq: number;
  severityCounts: Record<string, number>;
  /** True when the user's Stop Execution request ended the run early — the
   *  caller must record the run as 'cancelled' rather than compute pass/fail
   *  from whatever partial totals were collected. */
  cancelled: boolean;
  /**
   * Step-level accounting, so completion is a MEASUREMENT rather than a
   * constant. `run.progress = 100` used to be written unconditionally at the
   * end of every path, so a run that stopped after 3 of 40 cases — device
   * unplugged, user cancelled, preparation blocked — still reported 100%
   * Complete. The caller now derives progress from these.
   */
  executedSteps: number;
  totalSteps: number;
  /** Cases that reached a verdict of their own (pass/fail/blocked/skipped). */
  verdictedCases: number;
}

export async function executeAndroidSuite(opts: {
  runId: string;
  run: any;
  project: any;
  cases: any[];
  serial: string;
  deviceLabel: string;
  prep: PreparationResult;
}): Promise<AndroidRunTotals> {
  const { runId, run, project, serial, deviceLabel, prep } = opts;
  const pkg = prep.packageName;
  const total = opts.cases.length;

  // Execute Module-wise: every case for a module runs together, in the order
  // modules first appear in the sheet — a stable sort, so within a module the
  // original row order (and therefore TC ID order) is untouched.
  const moduleOrder: string[] = [];
  for (const tc of opts.cases) {
    const m = String(tc.module ?? '');
    if (!moduleOrder.includes(m)) moduleOrder.push(m);
  }
  const cases = opts.cases
    .map((tc, index) => ({ tc, index }))
    .sort((a, b) => {
      const ma = moduleOrder.indexOf(String(a.tc.module ?? ''));
      const mb = moduleOrder.indexOf(String(b.tc.module ?? ''));
      return ma !== mb ? ma - mb : a.index - b.index;
    })
    .map(({ tc }) => tc);

  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  // Progress is reported against the steps the sheet actually contains, so it
  // advances WITHIN a long test case and so a run that stops early can never
  // round up to 100%.
  const totalSteps = cases.reduce((n: number, tc: any) => n + (tc.steps?.length ?? 0), 0);
  let executedSteps = 0;
  let verdictedCases = 0;
  let bugSeq = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const nextBugNumber = () => `BUG-${run.runNumber}-${String(++bugSeq).padStart(3, '0')}`;
  const caseElapsedMs: number[] = [];

  // Crashes already seen this run. `detectCrashes` reads a trailing log window
  // and never clears it, so one FATAL EXCEPTION reappears on every subsequent
  // call — without this, a single early crash would restart the app on every
  // step for the rest of the suite and file the same bug over and over.
  const seenCrashes = new Set<string>();
  const newCrashes = async (): Promise<CrashSignal[]> => {
    const found = await detectCrashes(serial, pkg).catch(() => [] as CrashSignal[]);
    const fresh = found.filter((c) => !seenCrashes.has(crashSignature(c)));
    fresh.forEach((c) => seenCrashes.add(crashSignature(c)));
    return fresh;
  };

  /**
   * File one Issue for one failure, with the evidence that proves it.
   *
   * Called per FAILED STEP rather than once per failed case, so a case whose
   * step 2 and step 5 both fail produces two Issues describing two different
   * defects instead of one that mentions only the first. The AI Issue Board
   * picks these up unchanged — its card seeds already key on
   * `bug:<id>` and dedupe against failed steps by `testCaseId#failedStepNumber`
   * (see lib/issue-boards/sync.ts), so per-step bugs land as per-step cards with
   * no change to that workflow.
   */
  async function fileBug(args: {
    tc: any;
    stepNumber: number | null;
    instruction: string | null;
    expected: string;
    actual: string;
    screen: string;
    evidence: string | null;
    crashes: CrashSignal[];
    stepRecords: StepRecord[];
  }) {
    const { tc, stepNumber, instruction, expected, actual, screen, evidence, crashes, stepRecords } = args;
    const severity = crashes.length > 0 ? 'critical' : normalizeSeverity(tc.severity);
    const priority = normalizePriority(tc.priority, severity);
    const deviceLog = await readLogcat(serial, 120);

    const bug = await QaBug.create({
      userId: run.userId, projectId: run.projectId, runId,
      type: crashes.some((c) => c.type === 'crash') ? 'crash' : crashes.some((c) => c.type === 'anr') ? 'anr' : 'functional',
      module: tc.module, feature: tc.feature,
      severity, priority, bugNumber: nextBugNumber(),
      testCaseId: tc.testCaseId, failedStepNumber: stepNumber,
      title: stepNumber != null
        ? `${tc.testCaseId} step ${stepNumber}: ${instruction ?? tc.scenario}`
        : `${tc.testCaseId}: ${tc.scenario} — expected result not achieved`,
      description: stepNumber != null
        ? `Step ${stepNumber} of "${tc.scenario}" was executed on ${deviceLabel} but its expected result was not met. ${actual}`
        : `Execution on the physical device ${deviceLabel} diverged from the sheet's expected result. ${actual}`,
      screenName: screen,
      stepsToReproduce: tc.steps.length > 0 ? tc.steps : [tc.scenario],
      expectedResult: expected,
      actualResult: actual,
      screenshotDataUrl: evidence,
      logs: [
        `Device: ${deviceLabel} · package: ${pkg ?? 'unknown'} · screen: ${screen}`,
        ...stepRecords.map((s) => `Step ${s.stepNumber} [${s.status}] ${s.instruction} → ${s.actual}`),
        '', '--- logcat (last 120 lines) ---', deviceLog.slice(0, 6000),
      ].join('\n'),
      stackTrace: crashes.find((c) => c.type === 'crash')?.detail ?? null,
      apiRequest: null, apiResponse: null,
      deviceInfo: deviceLabel,
      osVersion: run.currentDevice ?? '',
      appVersion: run.buildVersion,
      aiRootCause: crashes.length > 0
        ? `The application ${crashes[0].type === 'crash' ? 'crashed' : 'became unresponsive (ANR)'} during this step. The captured stack trace is attached.`
        : 'The step executed but the resulting device screen did not satisfy the expected result. The element or state the test depends on was not present in the view hierarchy at assertion time.',
      suggestedFix: crashes.length > 0
        ? 'Fix the exception in the attached stack trace, then re-run this test case.'
        : 'Confirm the expected element still exists and is rendered before the assertion point; if the UI changed, update the test case, otherwise fix the regression.',
    });

    severityCounts[severity] += 1;
    return bug;
  }

  // Cooperative cancellation: the Stop Execution button flips the run's
  // status to 'cancelled' in the DB; this engine polls that (throttled, so it
  // costs one extra query every ~2.5s rather than one per step) and stops
  // promptly instead of running every remaining case on the device.
  let lastCancelCheck = 0;
  let cancelled = false;
  const checkCancelled = async (): Promise<boolean> => {
    if (cancelled) return true;
    const now = Date.now();
    if (now - lastCancelCheck < 2_500) return false;
    lastCancelCheck = now;
    const doc = await QaTestRun.findById(runId).select('status').lean<{ status: string } | null>();
    cancelled = doc?.status === 'cancelled';
    return cancelled;
  };

  // The very first real frame, so the Live Device Preview is populated before
  // step 1 rather than showing an empty panel. Deliberately NOT awaited: a
  // device screencap costs ~3s and step 1 does not depend on the image, so it
  // is stored whenever it lands.
  const launchFrame = prep.pendingScreenshot ?? (prep.screenshot ? Promise.resolve(prep.screenshot) : null);
  if (launchFrame) {
    void launchFrame
      .then((shot) => (shot
        ? QaScreenshot.create({
          runId, screenName: 'App launched', testStep: 'Preparation', imageDataUrl: shot,
        })
        : null))
      .catch(() => null);
  }

  caseLoop:
  for (let i = 0; i < cases.length; i++) {
    if (await checkCancelled()) {
      await log(runId, 'automation', 'warn', `Execution stopped by user request before test case ${i + 1}/${cases.length}. Partial results are saved.`);
      break;
    }

    const tc = cases[i];
    const caseStart = Date.now();

    // A case whose own module/feature/scenario is about ad behaviour must
    // never have its interstitial auto-dismissed out from under it — the
    // sheet's own steps are the ones allowed to interact with it.
    const isAdCase = /\bads?\b|advert(?:isement|ising)?/i.test(`${tc.module} ${tc.feature} ${tc.scenario}`);

    run.currentSuite = tc.module;
    run.currentModule = tc.module;
    run.currentFeature = tc.feature;
    run.currentTestCaseId = tc.testCaseId;
    run.currentScenario = tc.scenario;
    run.currentCase = `${tc.testCaseId}: ${tc.scenario}`;
    run.currentExpected = tc.expectedResult ?? '';
    // Explicit in-progress values rather than blanks. The re-anchor below is
    // seconds of adb work, and leaving these stale meant the panel showed the
    // PREVIOUS case's step text and actual result under the new case's heading;
    // blanking them instead made the UI fall through to an unrelated case's
    // stored result. Both told the user something untrue about right now.
    run.currentStep = 'Preparing test case…';
    run.currentActual = 'Executing…';
    run.currentScreen = '';
    run.currentStepNumber = null;
    run.currentStepStatus = 'running';
    // Measured against steps, not cases, so a 20-step case does not sit at the
    // same percentage for minutes. Capped below 100 here: only the caller, after
    // confirming every case was verdicted, may write 100.
    run.progress = totalSteps > 0
      ? Math.min(99, Math.round((executedSteps / totalSteps) * 100))
      : Math.min(99, Math.round((i / Math.max(total, 1)) * 100));
    await run.save();
    await log(runId, 'automation', 'info', `[${tc.testCaseId}] ${tc.scenario} — executing ${tc.steps.length} step(s) on ${deviceLabel}.`);

    // Re-anchor on the app under test before every case. A single stray tap
    // can open a browser, the Play Store, or a settings page — without this,
    // every remaining case would keep "executing" against the wrong app and
    // the sheet would look like it silently stopped progressing.
    if (pkg) {
      // Warm re-front only. If the app is already showing, this is a no-op; if a
      // stray tap opened a browser or a share sheet, it backs out and re-fronts
      // the SAME task, preserving where the sheet had got to.
      let anchor = await refocusApp(serial, pkg, !isAdCase);

      // A warm re-front cannot rescue a process that died. Check whether that is
      // what happened, and only then restart — this is the sole restart path.
      if (!anchor.ok && !anchor.deviceLost) {
        const crashed = await newCrashes();
        if (crashed.length > 0) {
          await log(runId, 'automation', 'warn',
            `[${tc.testCaseId}] The app under test ${crashed[0].type === 'crash' ? 'crashed' : 'stopped responding (ANR)'} — restarting it, which is the only condition that authorises a restart.`);
          anchor = await recoverFromCrash(serial, pkg, !isAdCase);
        }
      }

      if (anchor.recovered || !anchor.ok) {
        await log(runId, 'automation', anchor.ok ? 'warn' : 'error', `[${tc.testCaseId}] ${anchor.detail}`);
      }
      // The app under test could not be put back on screen. Executing the case
      // anyway would assert the sheet's steps against whatever else is showing
      // (the launcher, a browser) and file Issues describing that other app —
      // which is exactly how a run produced 15 bogus failures. Block the case
      // with the real reason instead of testing the wrong application.
      if (!anchor.ok) {
        const shot = anchor.deviceLost ? null : await captureDeviceScreen(serial);
        tc.result = 'blocked';
        tc.actualResult = anchor.deviceLost
          ? `Blocked: ${anchor.detail}`
          : `Blocked: ${anchor.detail} The steps were not executed, because they would have run against a different application.`;
        tc.failedStepIndex = null;
        tc.screenName = anchor.deviceLost ? 'Device disconnected' : await currentAndroidScreen(serial);
        tc.stepResults = [];
        await tc.save();
        blocked += 1;
        run.blockedCases = blocked;
        await run.save();
        if (shot) {
          await QaScreenshot.create({ runId, screenName: 'App not in foreground', testStep: tc.scenario, imageDataUrl: shot });
        }
        await log(runId, 'automation', anchor.deviceLost ? 'error' : 'warn',
          `[${tc.testCaseId}] BLOCKED — ${anchor.deviceLost ? anchor.detail : 'the app under test could not be restored to the foreground.'}`);

        // A lost device will not come back on its own, so grinding through every
        // remaining case to block it individually is pointless and slow. Mark the
        // rest with the same honest reason and end the run.
        if (anchor.deviceLost) {
          for (let rest = i + 1; rest < cases.length; rest++) {
            const other = cases[rest];
            other.result = 'blocked';
            other.actualResult = `Blocked: ${anchor.detail}`;
            other.failedStepIndex = null;
            other.screenName = 'Device disconnected';
            other.stepResults = [];
            await other.save();
            blocked += 1;
          }
          run.blockedCases = blocked;
          await run.save();
          await log(runId, 'automation', 'error', `Execution stopped after ${i + 1}/${cases.length} test case(s): the device is no longer reachable. Partial results are saved.`);
          break;
        }
        continue;
      }
    }

    const stepRecords: StepRecord[] = [];
    let firstFailedStepIndex: number | null = null;
    // Issues raised while executing this case's steps, so the case-level verdict
    // does not file a duplicate for a failure already reported per-step.
    let caseBugCount = 0;
    // Screen state around the most recent interaction, so a case-level
    // expectation like "user should move to the next screen" can be asserted on
    // whether the screen actually advanced.
    let lastTransition: ValidationContext = {};

    // How this case's Expected Results column maps onto its Steps: one
    // expectation per step, or a single one describing the end state. Inferred
    // structurally from the sheet — see lib/qa/expected-results.ts.
    const plan = planExpectations(tc.steps, tc.expectedResult ?? '');
    if (plan.mode === 'per-step') {
      await log(runId, 'automation', 'debug',
        `[${tc.testCaseId}] The Expected Results column lists ${tc.steps.length} expectations, one per step — each step will be validated against its own.`);
    }

    // A case with no steps executes nothing, so it cannot be evidence of
    // anything. Passing it would report success for work never performed.
    //
    // SKIPPED, not blocked: nothing obstructed the device or the app — the
    // sheet simply did not say what to do. Reporting it as blocked put an
    // environment-shaped problem in front of the user for what is a one-line
    // authoring fix.
    if (tc.steps.length === 0) {
      tc.result = 'skipped';
      tc.actualResult = 'Not executed: the Steps column is empty for this test case, so there was nothing to perform. Add the step-by-step actions to the sheet and re-run.';
      tc.failedStepIndex = null;
      tc.screenName = await currentAndroidScreen(serial);
      tc.stepResults = [];
      await tc.save();
      skipped += 1;
      run.skippedCases = skipped;
      run.currentStep = 'Skipped — the sheet lists no steps for this test case';
      run.currentActual = tc.actualResult;
      run.currentStepStatus = 'skipped';
      await run.save();
      await log(runId, 'automation', 'warn', `[${tc.testCaseId}] SKIPPED — the sheet's Steps column is empty for this case.`);
      continue;
    }

    for (let si = 0; si < tc.steps.length; si++) {
      if (await checkCancelled()) {
        await log(runId, 'automation', 'warn', `[${tc.testCaseId}] Execution stopped by user request at step ${si + 1}/${tc.steps.length}. Partial results are saved.`);
        break caseLoop;
      }

      const instruction = tc.steps[si];
      // A compound instruction ("Increase volume and slide review manually") is
      // executed as each action it asks for, in written order, rather than being
      // written off as unmappable. Ordinary steps yield exactly one action.
      const actionParts = interpretStepParts(instruction, tc.testData);
      const action = actionParts[0];

      // The expectation for THIS step, when the sheet enumerated one per step.
      const stepExpected = plan.perStep[si] ?? '';
      const isLastStep = si === tc.steps.length - 1;

      run.currentStep = `Step ${si + 1}/${tc.steps.length}: ${instruction}`;
      // Live Tracking shows the expectation actually in force for this step, so
      // a per-step sheet reads step-by-step instead of repeating the case's
      // end-state expectation on every row.
      run.currentExpected = stepExpected || (tc.expectedResult ?? '');
      // Never blank: an empty value makes the panel fall back to some other
      // case's stored result, which reads as this step having already produced
      // an outcome it has not.
      run.currentActual = 'Executing…';
      run.currentStepNumber = si + 1;
      run.currentStepStatus = 'running';
      await run.save();

      // Every step in the sheet is executed. A previous failure does NOT skip
      // the rest of the case: the sheet is the source of truth about what must
      // be exercised, and skipping steps hides whether they work. What a failure
      // does mean is that the app may no longer be where the next step expects,
      // so the app is re-fronted between steps (below) and each step reports its
      // own verdict independently.
      if (pkg && si > 0) {
        const prior = stepRecords[si - 1];
        if (prior && prior.status !== 'pass') {
          const back = await refocusApp(serial, pkg, !isAdCase);
          if (!back.ok && !back.deviceLost) {
            const crashed = await newCrashes();
            if (crashed.length > 0) {
              await log(runId, 'automation', 'warn',
                `[${tc.testCaseId}] Step ${si + 1}: the app ${crashed[0].type === 'crash' ? 'crashed' : 'became unresponsive'} during the previous step — restarting before continuing.`);
              await recoverFromCrash(serial, pkg, !isAdCase);
            }
          } else if (back.recovered) {
            await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1}: ${back.detail}`);
          }
        }
      }

      // Proactively clear an ad/promo/onboarding interstitial before even
      // attempting the step — these are never what the sheet's step is about,
      // so they must never be allowed to fail it. Cheap: one UI dump when
      // nothing is blocking, since the dismiss helper no-ops immediately.
      const preDismiss = await dismissBlockingOverlay(serial).catch(() => ({ handled: [] as string[] }));
      if (preDismiss.handled.length > 0) {
        await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1}: ${preDismiss.handled.join('; ')} before executing.`);
      }
      // A full-screen ad SDK Activity is a separate case from an in-app
      // overlay above: it replaces the content entirely and lives inside the
      // app's own package, so plain package-based checks never catch it. Only
      // checked when this case is not itself testing ad behaviour.
      if (!isAdCase) {
        const adEscape = await escapeAdSurface(serial, 5, pkg ?? undefined).catch(() => ({ escaped: true, detail: '' }));
        if (!adEscape.escaped) {
          await log(runId, 'automation', 'warn', `[${tc.testCaseId}] Step ${si + 1}: ${adEscape.detail}`);
        } else if (adEscape.detail && !adEscape.detail.startsWith('No advertisement')) {
          await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1}: ${adEscape.detail}`);
        }
      }

      const stepStart = Date.now();
      let exec = await executeAndroidStep(serial, action, pkg);

      // Remaining clauses of a compound instruction. The step's verdict is the
      // conjunction: it only passes if every part it asked for succeeded.
      for (const part of actionParts.slice(1)) {
        if (!exec.ok) break;
        const partExec = await executeAndroidStep(serial, part, pkg);
        exec = {
          ...partExec,
          detail: `${exec.detail} ${partExec.detail}`,
          // Keep the transition spanning the whole compound step.
          beforeSignature: exec.beforeSignature ?? partExec.beforeSignature,
          beforeActivity: exec.beforeActivity ?? partExec.beforeActivity,
        };
      }

      // The step's own failure can itself be an overlay the tap surfaced
      // (e.g. an interstitial ad triggered by the previous step). Clear it and
      // retry exactly once before accepting the step as genuinely failed —
      // this is what keeps the run going past Ads/Onboarding/permission nags
      // instead of stopping on them.
      if (!exec.ok) {
        const postDismiss = await dismissBlockingOverlay(serial).catch(() => ({ handled: [] as string[] }));
        let retried = false;
        if (postDismiss.handled.length > 0) {
          await log(runId, 'automation', 'warn', `[${tc.testCaseId}] Step ${si + 1} initially failed; ${postDismiss.handled.join('; ')} and retrying.`);
          exec = await executeAndroidStep(serial, action, pkg);
          retried = true;
        }
        // The step's own failure can itself be an interstitial the previous
        // step's tap surfaced. Clear it and retry once, same discipline as
        // the overlay case above.
        if (!exec.ok && !retried && !isAdCase) {
          const adEscape = await escapeAdSurface(serial, 5, pkg ?? undefined).catch(() => ({ escaped: true, detail: '' }));
          if (adEscape.detail && !adEscape.detail.startsWith('No advertisement')) {
            await log(runId, 'automation', 'warn', `[${tc.testCaseId}] Step ${si + 1} initially failed; ${adEscape.detail} Retrying.`);
            exec = await executeAndroidStep(serial, action, pkg);
          }
        }
      }

      // Still failing because the control the step names simply is not on this
      // screen: the app is most likely sitting on an intermediate gate the sheet
      // never mentions (language picker, onboarding slide, consent notice).
      // Walk forward through those gates and retry, so a first-run flow cannot
      // strand the rest of the sheet. Bounded, and only ever entered after the
      // step's own target was genuinely absent.
      if (!exec.ok && isTargetMissing(exec.detail)) {
        for (let hop = 0; hop < MAX_GATE_HOPS && !exec.ok; hop++) {
          const hopResult = await advancePastGateScreen(serial, pkg).catch(
            (e) => ({ advanced: false, detail: (e as Error).message }),
          );
          if (!hopResult.advanced) {
            await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1}: ${hopResult.detail}`);
            break;
          }
          await log(runId, 'automation', 'info', `[${tc.testCaseId}] Step ${si + 1}: ${hopResult.detail} Retrying the step.`);
          exec = await executeAndroidStep(serial, action, pkg);
        }
      }
      const durationMs = Date.now() - stepStart;

      let status: StepRecord['status'] = exec.ok ? 'pass' : 'fail';
      let actual = exec.detail;
      let assertion: string = action.kind;
      const transition: ValidationContext = {
        beforeSignature: exec.beforeSignature,
        beforeActivity: exec.beforeActivity,
        afterSignature: exec.afterSignature,
        afterActivity: exec.afterActivity,
      };
      if (transition.beforeSignature !== undefined) lastTransition = transition;

      // ---- Validate this step against the Expected Result that governs it ----
      //
      // Three sources, in priority order:
      //  1. an explicit per-step expectation from the sheet;
      //  2. a `verify` step's own object ("Verify the home screen is shown");
      //  3. for the FINAL step of a case-level sheet, the case's expectation.
      //
      // An early step is deliberately NOT judged against a case-level
      // expectation: the end state legitimately is not reached yet, so doing so
      // would fail a perfectly healthy app on step 1.
      let judgedExpectation = '';
      if (exec.ok && stepExpected) {
        judgedExpectation = stepExpected;
      } else if (exec.ok && action.kind === 'verify') {
        // The verify step's own object when it names one, otherwise the case's
        // Expected Result column. Passing the step's own prose made the check
        // demand its instruction verbs ("verify", "check") be visible on screen,
        // which no app ever renders.
        judgedExpectation = action.target?.trim() ? action.target : (plan.caseLevel || tc.expectedResult || '');
      } else if (exec.ok && isLastStep && plan.caseLevel) {
        judgedExpectation = plan.caseLevel;
      }

      // BLOCKED is reserved for a genuine obstruction. Everything else resolves
      // to a real PASS or FAIL:
      //
      //  - expectation verified            -> PASS  (verified)
      //  - expectation contradicted        -> FAIL
      //  - app not on screen to check      -> BLOCKED (a real blocker)
      //  - expectation not machine-checkable, or the sheet gave none
      //                                    -> PASS, verified:false
      //
      // That last case is the important one. It used to be BLOCKED, which made
      // runs look obstructed when in fact the step executed perfectly and only
      // the WORDING of the expectation ("the animation is smooth") was beyond a
      // view hierarchy. The step's own success is real and is reported as such;
      // `verified` records that a human still needs to confirm the wording.
      let verified = false;
      if (judgedExpectation) {
        const v = await validateAndroidExpectation(serial, judgedExpectation, pkg, transition);
        if (v.status === 'pass') {
          status = 'pass';
          verified = true;
        } else if (v.status === 'fail') {
          status = 'fail';
        } else if (v.blocker) {
          status = 'blocked';
        } else {
          status = 'pass';
        }
        // Keep both halves of the story: what the action did, and how the
        // resulting screen measured up against the expectation.
        actual = `${exec.detail} ${v.actual}`.trim();
        assertion = v.assertion;
      } else if (action.kind === 'unknown') {
        // Not a blocker: nothing obstructed the device, the sentence simply did
        // not map to an action. Reported as skipped so it is visibly unrun
        // rather than masquerading as an environment problem.
        status = 'skipped';
        actual = `This step could not be mapped to an executable action, so it was not performed: "${instruction}". Rephrase it with a clear action verb (tap / enter / verify / scroll) to make it executable.`;
        assertion = 'unmappable';
      } else if (exec.ok) {
        // Executed successfully with no expectation to check against.
        status = 'pass';
      }

      // Real capture of the device screen after the interaction. The screenshot
      // and the screen name are independent reads, so they run concurrently
      // rather than one after the other — this happens on every step.
      const [shot, screen] = await Promise.all([
        captureDeviceScreen(serial),
        currentAndroidScreen(serial),
      ]);

      stepRecords.push({
        stepNumber: si + 1, action: action.kind, instruction, status, actual, assertion,
        durationMs, url: screen, screenshotDataUrl: shot,
        expected: judgedExpectation || undefined,
        verified,
      });
      // Counts toward progress only when the step was genuinely attempted on the
      // device. An unmappable step was never performed, so it must not inflate
      // completion.
      if (status !== 'skipped') executedSteps += 1;

      if (shot) {
        await QaScreenshot.create({
          runId, screenName: `${screen} — step ${si + 1}`, testStep: tc.scenario, imageDataUrl: shot,
          testCaseId: tc.testCaseId, stepNumber: si + 1,
        });
      }

      // Live preview: current screen, what this step actually did, and its
      // verdict. Written immediately AFTER the frame for the same step, so the
      // panel's image and text describe the same moment.
      run.currentScreen = screen;
      run.currentActual = actual;
      run.currentStepStatus = status;
      // Identity of the frame this text belongs to, so the panel can tell
      // whether the image it is showing is the one these values describe.
      run.currentStepNumber = si + 1;
      await run.save();

      if (status === 'fail' || status === 'blocked') {
        if (firstFailedStepIndex === null) firstFailedStepIndex = si;

        // A FAILED step gets its own Issue immediately, with this step's own
        // screenshot and expectation as evidence — not deferred to a single
        // case-level bug that could only ever describe one of the failures.
        // A BLOCKED step executed but could not be judged, which is not a
        // demonstrated defect, so it is reported without filing an Issue.
        if (status === 'fail') {
          const stepCrashes = await newCrashes();
          const bug = await fileBug({
            tc, stepNumber: si + 1, instruction,
            expected: judgedExpectation || plan.caseLevel || tc.expectedResult || '',
            actual, screen, evidence: shot, crashes: stepCrashes, stepRecords,
          });
          // The case points at the first Issue raised against it; the rest are
          // reachable from the board by test case id and step number.
          if (!tc.bugId) tc.bugId = bug._id;
          caseBugCount += 1;
          await log(runId, 'error', 'error',
            `[${tc.testCaseId}] Step ${si + 1} FAILED: ${actual} — Issue ${bug.bugNumber} created with device evidence. Continuing to the next step.`);
        } else {
          await log(runId, 'error', 'warn', `[${tc.testCaseId}] Step ${si + 1} BLOCKED: ${actual}`);
        }
      } else {
        await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1} PASS: ${actual}`);
      }
    }

    // ---- Case verdict, derived from steps that have all already run ----
    //
    // Every step was executed and judged in the loop above, so the verdict is a
    // roll-up rather than a fresh assertion. The one thing still owed is the
    // case-level expectation for a sheet whose Expected Results describes the end
    // state AND whose final step could not carry that assertion (it failed, or it
    // was blocked, so `judgedExpectation` never ran there).
    let finalResult: 'pass' | 'fail' | 'blocked';
    let finalActual: string;

    const failedSteps = stepRecords.filter((s) => s.status === 'fail');
    const blockedSteps = stepRecords.filter((s) => s.status === 'blocked');
    const passedSteps = stepRecords.filter((s) => s.status === 'pass');

    const skippedSteps = stepRecords.filter((s) => s.status === 'skipped');
    const unverifiedPasses = passedSteps.filter((s) => s.verified === false && s.expected);

    if (failedSteps.length > 0) {
      firstFailedStepIndex = failedSteps[0].stepNumber - 1;
      finalResult = 'fail';
      finalActual = failedSteps.length === 1
        ? `Step ${failedSteps[0].stepNumber} ("${failedSteps[0].instruction}") failed: ${failedSteps[0].actual}`
        : `${failedSteps.length} of ${tc.steps.length} steps failed. `
          + failedSteps.map((s) => `Step ${s.stepNumber} ("${s.instruction}"): ${s.actual}`).join(' ');
    } else if (blockedSteps.length > 0) {
      // BLOCKED only reaches here for a genuine obstruction — the app was not on
      // screen to check against. An expectation that merely could not be proven
      // no longer lands in this branch; it passes with verified:false.
      finalResult = 'blocked';
      finalActual = `Execution was blocked at step ${blockedSteps[0].stepNumber} ("${blockedSteps[0].instruction}"): ${blockedSteps[0].actual}`;
      if (firstFailedStepIndex === null) firstFailedStepIndex = blockedSteps[0].stepNumber - 1;
    } else {
      finalResult = 'pass';
      const base = plan.mode === 'per-step'
        ? `All ${tc.steps.length} step(s) executed and each matched its own expected result.`
        : `All ${tc.steps.length} step(s) executed and the expected result was verified on the device screen.`;
      // A pass is still a pass when part of the expectation was beyond automated
      // checking — but say so plainly rather than quietly overstating it.
      finalActual = [
        base,
        unverifiedPasses.length > 0
          ? `${unverifiedPasses.length} step(s) executed successfully but their expected result is not machine-verifiable and needs manual confirmation: ${unverifiedPasses.map((s) => `step ${s.stepNumber}`).join(', ')}.`
          : '',
        skippedSteps.length > 0
          ? `${skippedSteps.length} step(s) could not be mapped to an executable action and were not performed: ${skippedSteps.map((s) => `step ${s.stepNumber}`).join(', ')}.`
          : '',
      ].filter(Boolean).join(' ');
    }

    // A case-level expectation that never got asserted (because the final step
    // did not pass) is still owed an answer, but only when the case is otherwise
    // clean — if a step already failed, that failure is the verdict.
    const lastStep = stepRecords[stepRecords.length - 1];
    const caseAssertionPending = plan.caseLevel
      && finalResult !== 'fail'
      && !(lastStep && lastStep.expected === plan.caseLevel);
    if (caseAssertionPending) {
      // An ad/promo overlay must never be mistaken for the genuine expected
      // result screen.
      await dismissBlockingOverlay(serial).catch(() => null);
      if (!isAdCase) await escapeAdSurface(serial, 5, pkg ?? undefined).catch(() => null);
      // The app may have left the foreground between the last step and this
      // assertion — some apps self-exit after an interstitial. Re-front it
      // WARMLY so the expectation is read against the app rather than the home
      // screen. Never force-stop here: doing that once per case is precisely the
      // open/close thrashing this engine must not produce.
      if (pkg) {
        const fgNow = await foregroundPackage(serial).catch(() => null);
        if (fgNow !== pkg) {
          const restored = await launchApp(serial, pkg, 20000).catch(
            () => ({ ok: false, message: 'relaunch failed', activity: null }),
          );
          await log(runId, 'automation', restored.ok ? 'info' : 'warn',
            `[${tc.testCaseId}] The app had left the foreground before the expected result could be checked; brought it back: ${restored.message}`);
        }
      }
      const v = await validateAndroidExpectation(serial, plan.caseLevel, pkg, lastTransition);
      if (v.status === 'fail') {
        finalResult = 'fail';
        finalActual = v.actual;
        if (lastStep) {
          firstFailedStepIndex = lastStep.stepNumber - 1;
          lastStep.status = 'fail';
          lastStep.actual = v.actual;
          lastStep.assertion = v.assertion;
          lastStep.expected = plan.caseLevel;
        }
      } else if (v.status === 'pass' && finalResult === 'pass') {
        finalActual = v.actual;
      }
    }

    // Any crash during this case that has not already been accounted for.
    const crashes = await newCrashes();
    if (crashes.length > 0 && finalResult !== 'fail') {
      finalResult = 'fail';
      finalActual = `${finalActual} However, the device log recorded a ${crashes[0].type.toUpperCase()} during this test case.`;
    }

    const screen = await currentAndroidScreen(serial);
    tc.result = finalResult;
    tc.actualResult = finalActual;
    tc.failedStepIndex = firstFailedStepIndex;
    tc.screenName = screen;
    tc.stepResults = stepRecords;
    verdictedCases += 1;

    // Publish the case's own verdict to the live panel. Without this the tiles
    // kept showing the LAST STEP's actual result and badge through the whole
    // verdict phase — which relaunches the app and re-asserts the expectation,
    // and can flip the result — so the panel could show a green step while the
    // case was being marked failed.
    run.currentActual = finalActual;
    run.currentStepStatus = finalResult;
    run.currentScreen = screen;

    if (finalResult === 'pass') {
      passed += 1;
      await log(runId, 'automation', 'info', `[${tc.testCaseId}] PASSED — expected result verified on the device screen.`);
    } else if (finalResult === 'blocked') {
      blocked += 1;
      await log(runId, 'automation', 'warn', `[${tc.testCaseId}] BLOCKED — ${finalActual}`);
    } else {
      failed += 1;
      const failedStepNumber = firstFailedStepIndex != null ? firstFailedStepIndex + 1 : null;

      // Each failed step already filed its own Issue with its own evidence while
      // the case was running. Only file a case-level Issue when nothing was
      // raised during the steps — which happens when the case failed on the
      // case-level assertion or on a crash rather than on a step.
      if (caseBugCount === 0) {
        const evidence = (firstFailedStepIndex != null ? stepRecords[firstFailedStepIndex]?.screenshotDataUrl : null)
          ?? await captureDeviceScreen(serial);
        const bug = await fileBug({
          tc, stepNumber: failedStepNumber, instruction: null,
          expected: plan.caseLevel || tc.expectedResult || '',
          actual: finalActual, screen, evidence, crashes, stepRecords,
        });
        tc.bugId = bug._id;
        await log(runId, 'error', 'error', `[${tc.testCaseId}] FAILED — Issue ${bug.bugNumber} created with device evidence.`);
      } else {
        await log(runId, 'error', 'error',
          `[${tc.testCaseId}] FAILED — ${caseBugCount} Issue(s) were created for the failing step(s) of this test case.`);
      }
    }

    await tc.save();

    caseElapsedMs.push(Date.now() - caseStart);
    const avgMs = caseElapsedMs.reduce((a, b) => a + b, 0) / caseElapsedMs.length;
    const remaining = total - (i + 1);
    run.etaSeconds = remaining > 0 ? Math.round((avgMs * remaining) / 1000) : 0;
    run.passedCases = passed;
    run.failedCases = failed;
    run.blockedCases = blocked;
    await run.save();
  }

  if (pkg) await stopApp(serial, pkg).catch(() => {});

  return {
    passed, failed, blocked, skipped, bugSeq, severityCounts, cancelled,
    executedSteps, totalSteps, verdictedCases,
  };
}
