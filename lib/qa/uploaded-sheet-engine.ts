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
  captureDeviceScreen, detectCrashes, readLogcat, stopApp, ensureAppForeground, dismissBlockingOverlay,
  advancePastGateScreen, escapeAdSurface,
} from '@/lib/qa/android-bridge';
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
}

export interface AndroidRunTotals {
  passed: number; failed: number; blocked: number; bugSeq: number;
  severityCounts: Record<string, number>;
  /** True when the user's Stop Execution request ended the run early — the
   *  caller must record the run as 'cancelled' rather than compute pass/fail
   *  from whatever partial totals were collected. */
  cancelled: boolean;
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
  let bugSeq = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const nextBugNumber = () => `BUG-${run.runNumber}-${String(++bugSeq).padStart(3, '0')}`;
  const caseElapsedMs: number[] = [];

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
  // step 1 rather than showing an empty panel.
  if (prep.screenshot) {
    await QaScreenshot.create({
      runId, screenName: 'App launched', testStep: 'Preparation',
      imageDataUrl: prep.screenshot,
    });
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
    run.currentFeature = tc.feature;
    run.currentCase = `${tc.testCaseId}: ${tc.scenario}`;
    run.currentExpected = tc.expectedResult ?? '';
    run.currentActual = '';
    run.currentStepStatus = 'running';
    run.progress = Math.round((i / Math.max(total, 1)) * 100);
    await run.save();
    await log(runId, 'automation', 'info', `[${tc.testCaseId}] ${tc.scenario} — executing ${tc.steps.length} step(s) on ${deviceLabel}.`);

    // Re-anchor on the app under test before every case. A single stray tap
    // can open a browser, the Play Store, or a settings page — without this,
    // every remaining case would keep "executing" against the wrong app and
    // the sheet would look like it silently stopped progressing.
    if (pkg) {
      const anchor = await ensureAppForeground(serial, pkg, !isAdCase);
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
    let firstFailureDetail = '';
    // Set only by a real failure, so an unverifiable-but-executed step keeps the
    // case running through its remaining steps.
    let haltCase = false;
    // Screen state around the most recent interaction, so a case-level
    // expectation like "user should move to the next screen" can be asserted on
    // whether the screen actually advanced.
    let lastTransition: ValidationContext = {};

    // A case with no steps executes nothing, so it cannot be evidence of
    // anything. Passing it would report success for work never performed.
    if (tc.steps.length === 0) {
      const shot = await captureDeviceScreen(serial);
      tc.result = 'blocked';
      tc.actualResult = 'Blocked: the Steps column is empty for this test case, so there was nothing to execute. Add the step-by-step actions to the sheet and re-run.';
      tc.failedStepIndex = null;
      tc.screenName = await currentAndroidScreen(serial);
      tc.stepResults = [];
      await tc.save();
      blocked += 1;
      run.blockedCases = blocked;
      await run.save();
      if (shot) {
        await QaScreenshot.create({ runId, screenName: 'No steps to execute', testStep: tc.scenario, imageDataUrl: shot });
      }
      await log(runId, 'automation', 'warn', `[${tc.testCaseId}] BLOCKED — the sheet's Steps column is empty for this case.`);
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

      run.currentStep = `Step ${si + 1}/${tc.steps.length}: ${instruction}`;
      await run.save();

      // Once a step genuinely FAILS the app is off the expected path; the
      // remaining steps are recorded as skipped rather than run against a wrong
      // screen. A step that merely could not be *verified* (playback, audio,
      // timing) executed fine, so it must not halt the rest of the case.
      if (haltCase) {
        stepRecords.push({
          stepNumber: si + 1, action: action.kind, instruction, status: 'skipped',
          actual: 'Not executed — a previous step in this test case already failed.',
          assertion: 'none', durationMs: 0, url: '', screenshotDataUrl: null,
        });
        continue;
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
        const adEscape = await escapeAdSurface(serial).catch(() => ({ escaped: true, detail: '' }));
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
          const adEscape = await escapeAdSurface(serial).catch(() => ({ escaped: true, detail: '' }));
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

      if (exec.ok && action.kind === 'verify') {
        // Assert what the sheet actually expects. Passing the step's own prose
        // here made the check demand its instruction verbs ("verify", "check")
        // be visible on screen, which no app ever renders. The verify step's
        // own object is used when it names one, otherwise the case's Expected
        // Result column — which is where the real expectation lives.
        const subject = action.target?.trim() ? action.target : tc.expectedResult;
        const v = await validateAndroidExpectation(serial, subject, pkg, transition);
        status = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
        actual = v.actual;
        assertion = v.assertion;
      } else if (action.kind === 'unknown') {
        status = 'blocked';
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
      });

      if (shot) {
        await QaScreenshot.create({
          runId, screenName: `${screen} — step ${si + 1}`, testStep: tc.scenario, imageDataUrl: shot,
        });
      }

      // Live preview: current screen, what this step actually did, and its
      // verdict — visible while the run is still in flight.
      run.currentScreen = screen;
      run.currentActual = actual;
      run.currentStepStatus = status;
      await run.save();

      if (status === 'fail' || status === 'blocked') {
        if (firstFailedStepIndex === null) {
          firstFailedStepIndex = si;
          firstFailureDetail = actual;
        }
        // Only a real failure takes the app off the expected path. An
        // inconclusive assertion means the step ran and we simply cannot judge
        // it, so the case continues with its remaining steps.
        if (status === 'fail') haltCase = true;
        await log(runId, 'error', status === 'fail' ? 'error' : 'warn', `[${tc.testCaseId}] Step ${si + 1} ${status.toUpperCase()}: ${actual}`);
      } else {
        await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1} PASS: ${actual}`);
      }
    }

    // Case-level expected result, asserted against the live device screen.
    let finalResult: 'pass' | 'fail' | 'blocked';
    let finalActual: string;

    const failedStep = stepRecords.find((s) => s.status === 'fail');
    if (failedStep) {
      // A genuine step failure is the verdict — the expected result was not met.
      const idx = failedStep.stepNumber - 1;
      firstFailedStepIndex = idx;
      finalResult = 'fail';
      finalActual = `Step ${failedStep.stepNumber} ("${failedStep.instruction}") failed: ${failedStep.actual}`;
    } else {
      // Same reasoning as per-step: an ad/promo overlay must never be mistaken
      // for the app's genuine expected-result screen.
      await dismissBlockingOverlay(serial).catch(() => null);
      if (!isAdCase) await escapeAdSurface(serial).catch(() => null);
      const v = await validateAndroidExpectation(serial, tc.expectedResult, pkg, lastTransition);
      finalResult = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
      finalActual = v.actual;
      if (v.status === 'fail' && stepRecords.length > 0) {
        firstFailedStepIndex = stepRecords.length - 1;
        stepRecords[stepRecords.length - 1].status = 'fail';
        stepRecords[stepRecords.length - 1].actual = v.actual;
        stepRecords[stepRecords.length - 1].assertion = v.assertion;
      }
    }

    // Final safety net: a case is only PASS when every one of its steps was
    // actually executed and passed. Guards against any path above concluding
    // success while a step was left skipped, blocked, or unrun. A step that ran
    // but could not be judged makes the case BLOCKED (needs manual review) —
    // never PASS, since nothing was proven, and never FAIL, since nothing was
    // shown to be broken.
    if (finalResult === 'pass') {
      const unfinished = stepRecords.find((s) => s.status !== 'pass');
      if (unfinished) {
        const executed = stepRecords.filter((s) => s.status === 'pass').length;
        finalResult = 'blocked';
        finalActual = `${executed} of ${tc.steps.length} step(s) were verified; step ${unfinished.stepNumber} ("${unfinished.instruction}") could not be verified automatically: ${unfinished.actual} The expected result therefore needs manual confirmation.`;
        if (firstFailedStepIndex === null) firstFailedStepIndex = unfinished.stepNumber - 1;
      }
    }

    // Real crash/ANR signals from the device log for this case.
    const crashes = await detectCrashes(serial, pkg);
    if (crashes.length > 0 && finalResult === 'pass') {
      finalResult = 'fail';
      finalActual = `${finalActual} However, the device log recorded a ${crashes[0].type.toUpperCase()} during this test case.`;
    }

    const screen = await currentAndroidScreen(serial);
    tc.result = finalResult;
    tc.actualResult = finalActual;
    tc.failedStepIndex = firstFailedStepIndex;
    tc.screenName = screen;
    tc.stepResults = stepRecords;

    if (finalResult === 'pass') {
      passed += 1;
      await log(runId, 'automation', 'info', `[${tc.testCaseId}] PASSED — expected result verified on the device screen.`);
    } else if (finalResult === 'blocked') {
      blocked += 1;
      await log(runId, 'automation', 'warn', `[${tc.testCaseId}] BLOCKED — ${finalActual}`);
    } else {
      failed += 1;
      const severity = crashes.length > 0 ? 'critical' : normalizeSeverity(tc.severity);
      const priority = normalizePriority(tc.priority, severity);
      const failedStepNumber = firstFailedStepIndex != null ? firstFailedStepIndex + 1 : null;
      const evidence = (firstFailedStepIndex != null ? stepRecords[firstFailedStepIndex]?.screenshotDataUrl : null)
        ?? await captureDeviceScreen(serial);
      const deviceLog = await readLogcat(serial, 120);

      const bug = await QaBug.create({
        userId: run.userId, projectId: run.projectId, runId,
        type: crashes.some((c) => c.type === 'crash') ? 'crash' : crashes.some((c) => c.type === 'anr') ? 'anr' : 'functional',
        module: tc.module, feature: tc.feature,
        severity, priority, bugNumber: nextBugNumber(),
        testCaseId: tc.testCaseId, failedStepNumber,
        title: `${tc.testCaseId}: ${tc.scenario} — expected result not achieved`,
        description: `Execution on the physical device ${deviceLabel} diverged from the sheet's expected result at step ${failedStepNumber ?? '—'}. ${finalActual}`,
        screenName: screen,
        stepsToReproduce: tc.steps.length > 0 ? tc.steps : [tc.scenario],
        expectedResult: tc.expectedResult,
        actualResult: finalActual,
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
          ? `The application ${crashes[0].type === 'crash' ? 'crashed' : 'became unresponsive (ANR)'} during this test case. The captured stack trace is attached.`
          : 'The step executed but the resulting device screen did not satisfy the expected result. The element or state the test depends on was not present in the view hierarchy at assertion time.',
        suggestedFix: crashes.length > 0
          ? 'Fix the exception in the attached stack trace, then re-run this test case.'
          : 'Confirm the expected element still exists and is rendered before the assertion point; if the UI changed, update the test case, otherwise fix the regression.',
      });

      tc.bugId = bug._id;
      severityCounts[severity] += 1;
      await log(runId, 'error', 'error', `[${tc.testCaseId}] FAILED at step ${failedStepNumber ?? '—'} — bug ${bug.bugNumber} created with device evidence.`);
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

  return { passed, failed, blocked, bugSeq, severityCounts, cancelled };
}
