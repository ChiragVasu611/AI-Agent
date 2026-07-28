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
import { interpretStep } from '@/lib/qa/step-interpreter';
import {
  captureDeviceScreen, detectCrashes, readLogcat, stopApp, ensureAppForeground,
} from '@/lib/qa/android-bridge';
import {
  executeAndroidStep, validateAndroidExpectation, currentAndroidScreen,
} from '@/lib/qa/android-step-executor';
import type { PreparationResult } from '@/lib/qa/app-preparation';
import { log } from '@/lib/qa/runtime-helpers';
import type { QaPriority, QaSeverity } from '@/lib/types';

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_PRIORITIES = new Set(['p1', 'p2', 'p3', 'p4']);

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
  const { runId, run, project, cases, serial, deviceLabel, prep } = opts;
  const pkg = prep.packageName;
  const total = cases.length;

  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let bugSeq = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const nextBugNumber = () => `BUG-${run.runNumber}-${String(++bugSeq).padStart(3, '0')}`;
  const caseElapsedMs: number[] = [];

  // The very first real frame, so the Live Device Preview is populated before
  // step 1 rather than showing an empty panel.
  if (prep.screenshot) {
    await QaScreenshot.create({
      runId, screenName: 'App launched', testStep: 'Preparation',
      imageDataUrl: prep.screenshot,
    });
  }

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const caseStart = Date.now();

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
      const anchor = await ensureAppForeground(serial, pkg);
      if (anchor.recovered || !anchor.ok) {
        await log(runId, 'automation', anchor.ok ? 'warn' : 'error', `[${tc.testCaseId}] ${anchor.detail}`);
      }
    }

    const stepRecords: StepRecord[] = [];
    let firstFailedStepIndex: number | null = null;
    let firstFailureDetail = '';

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
      const instruction = tc.steps[si];
      const action = interpretStep(instruction, tc.testData);

      run.currentStep = `Step ${si + 1}/${tc.steps.length}: ${instruction}`;
      await run.save();

      // Once a step fails the app is off the expected path; the remaining steps
      // are recorded as skipped rather than run against a wrong screen.
      if (firstFailedStepIndex !== null) {
        stepRecords.push({
          stepNumber: si + 1, action: action.kind, instruction, status: 'skipped',
          actual: 'Not executed — a previous step in this test case already failed.',
          assertion: 'none', durationMs: 0, url: '', screenshotDataUrl: null,
        });
        continue;
      }

      const stepStart = Date.now();
      const exec = await executeAndroidStep(serial, action, pkg);
      const durationMs = Date.now() - stepStart;

      let status: StepRecord['status'] = exec.ok ? 'pass' : 'fail';
      let actual = exec.detail;
      let assertion: string = action.kind;

      if (exec.ok && action.kind === 'verify') {
        const v = await validateAndroidExpectation(serial, action.raw, pkg);
        status = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
        actual = v.actual;
        assertion = v.assertion;
      } else if (action.kind === 'unknown') {
        status = 'blocked';
      }

      // Real capture of the device screen after the interaction.
      const shot = await captureDeviceScreen(serial);
      const screen = await currentAndroidScreen(serial);

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
        firstFailedStepIndex = si;
        firstFailureDetail = actual;
        await log(runId, 'error', status === 'fail' ? 'error' : 'warn', `[${tc.testCaseId}] Step ${si + 1} ${status.toUpperCase()}: ${actual}`);
      } else {
        await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1} PASS: ${actual}`);
      }
    }

    // Case-level expected result, asserted against the live device screen.
    let finalResult: 'pass' | 'fail' | 'blocked';
    let finalActual: string;

    if (firstFailedStepIndex !== null) {
      const rec = stepRecords[firstFailedStepIndex];
      finalResult = rec.status === 'blocked' ? 'blocked' : 'fail';
      finalActual = `Step ${firstFailedStepIndex + 1} ("${rec.instruction}") ${rec.status === 'blocked' ? 'could not be executed' : 'failed'}: ${firstFailureDetail}`;
    } else {
      const v = await validateAndroidExpectation(serial, tc.expectedResult, pkg);
      finalResult = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
      finalActual = v.actual;
      if (v.status !== 'pass' && stepRecords.length > 0) {
        firstFailedStepIndex = stepRecords.length - 1;
        stepRecords[stepRecords.length - 1].status = v.status === 'fail' ? 'fail' : 'blocked';
        stepRecords[stepRecords.length - 1].actual = v.actual;
        stepRecords[stepRecords.length - 1].assertion = v.assertion;
      }
    }

    // Final safety net: a case is only PASS when every one of its steps was
    // actually executed and passed. Guards against any path above concluding
    // success while a step was left skipped, blocked, or unrun.
    if (finalResult === 'pass') {
      const executed = stepRecords.filter((s) => s.status === 'pass').length;
      if (executed !== tc.steps.length) {
        const unfinished = stepRecords.find((s) => s.status !== 'pass');
        finalResult = 'fail';
        finalActual = `Only ${executed} of ${tc.steps.length} step(s) completed successfully${unfinished ? ` — step ${unfinished.stepNumber} ("${unfinished.instruction}") was ${unfinished.status}: ${unfinished.actual}` : ''}. The expected result cannot be considered met.`;
        if (firstFailedStepIndex === null && unfinished) firstFailedStepIndex = unfinished.stepNumber - 1;
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

  return { passed, failed, blocked, bugSeq, severityCounts };
}
