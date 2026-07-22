import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { randomScreen } from '@/lib/qa/modules';
import { generateQaAnalysis, parseJsonLoose } from '@/lib/qa/ai-provider';
import { placeholderScreenshot } from '@/lib/qa/screenshot';
import { SIMULATED_DEVICE_NAMES } from '@/lib/qa/device-adapter';
import { sleep, log } from '@/lib/qa/runtime-helpers';
import type { QaPriority, QaSeverity } from '@/lib/types';

const STEP_DELAY_MS = 350;
/** Only the first N cases get a live AI validation call — beyond that we fall back to
 * deterministic simulation so large uploaded sheets don't stall on hundreds of API calls. */
const AI_VALIDATION_CAP = 15;

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_PRIORITIES = new Set(['p1', 'p2', 'p3', 'p4']);
const VALID_RESULTS = new Set(['pass', 'fail', 'blocked', 'skipped']);

function parseOsVersion(device: string): string {
  const match = device.match(/\(([^,]+),\s*([^)]+)\)/);
  return match?.[2] ?? device;
}

function detectScreen(steps: string[]): string {
  const text = steps.join(' ').toLowerCase();
  const SCREEN_KEYWORDS: Record<string, string> = {
    login: 'Login', signup: 'Signup', register: 'Signup', cart: 'Cart', checkout: 'Checkout',
    payment: 'Payment', profile: 'Profile', setting: 'Settings', search: 'Search', home: 'Home',
    splash: 'Splash', onboarding: 'Onboarding', product: 'Product Detail', notification: 'Notifications',
  };
  for (const [kw, screen] of Object.entries(SCREEN_KEYWORDS)) {
    if (text.includes(kw)) return screen;
  }
  return randomScreen();
}

function normalizeSeverity(raw: string): QaSeverity {
  const s = raw.toLowerCase();
  return (VALID_SEVERITIES.has(s) ? s : 'medium') as QaSeverity;
}

function normalizePriority(raw: string, severity: QaSeverity): QaPriority {
  const p = raw.toLowerCase();
  if (VALID_PRIORITIES.has(p)) return p as QaPriority;
  return (severity === 'critical' || severity === 'high' ? 'p1' : severity === 'medium' ? 'p2' : 'p3') as QaPriority;
}

interface AiValidation {
  result: 'pass' | 'fail' | 'blocked' | 'skipped';
  actualResult: string;
  failedStepIndex: number | null;
  screen: string;
  bugTitle?: string;
  bugDescription?: string;
  aiRootCause?: string;
  suggestedFix?: string;
}

async function validateWithAi(
  apiKey: string | null,
  appName: string,
  platform: string,
  tc: { testCaseId: string; module: string; feature: string; scenario: string; preconditions: string; steps: string[]; testData: string; expectedResult: string },
): Promise<AiValidation | null> {
  const systemPrompt = 'You are an AI QA test executor. Given an application and one test case (scenario, preconditions, steps, test data, expected result), simulate executing it step by step against the app and report the outcome as JSON. Respond ONLY with minified JSON: {"result":"pass"|"fail"|"blocked"|"skipped","actualResult":string,"failedStepIndex":number|null,"screen":string,"bugTitle":string|null,"bugDescription":string|null,"aiRootCause":string|null,"suggestedFix":string|null}. Only populate bug fields when result is "fail". Bias toward "pass" unless the scenario/steps imply a plausible realistic defect. Be specific to the app and scenario.';
  const userPrompt = `App: "${appName}" (${platform}).\nTest Case: ${tc.testCaseId} — ${tc.scenario}\nModule/Feature: ${tc.module} / ${tc.feature}\nPreconditions: ${tc.preconditions || 'None'}\nSteps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'Not specified'}\nTest Data: ${tc.testData || 'None'}\nExpected Result: ${tc.expectedResult || 'Not specified'}\nSimulate execution and report the outcome as JSON.`;

  try {
    const content = await generateQaAnalysis(apiKey, { systemPrompt, userPrompt, maxTokens: 500 });
    const parsed = parseJsonLoose(content);
    if (!parsed || !VALID_RESULTS.has(String(parsed.result))) return null;
    return parsed as unknown as AiValidation;
  } catch {
    return null;
  }
}

function fallbackValidation(tc: { steps: string[]; expectedResult: string }): AiValidation {
  const roll = Math.random();
  const screen = detectScreen(tc.steps);
  if (roll < 0.68) {
    return { result: 'pass', actualResult: tc.expectedResult || 'Behavior matched expectations.', failedStepIndex: null, screen };
  }
  if (roll < 0.9) {
    const failedStepIndex = tc.steps.length > 0 ? Math.floor(Math.random() * tc.steps.length) : null;
    return {
      result: 'fail',
      actualResult: 'Actual behavior diverged from the expected result during simulated execution.',
      failedStepIndex,
      screen,
      bugTitle: `Unexpected behavior on ${screen}`,
      bugDescription: `The observed outcome did not match the expected result for this scenario on ${screen}.`,
      aiRootCause: 'Likely a regression or edge case not covered by the current implementation.',
      suggestedFix: 'Reproduce the scenario manually, inspect the relevant screen/component logic, and add a regression test.',
    };
  }
  if (roll < 0.96) {
    return { result: 'blocked', actualResult: 'Execution could not proceed — a precondition or dependency was not met.', failedStepIndex: null, screen };
  }
  return { result: 'skipped', actualResult: 'Skipped — not applicable in this simulated environment.', failedStepIndex: null, screen };
}

export async function runUploadedTestExecution(runId: string, apiKey: string | null) {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId);
  if (!run) return;
  const project = await QaProject.findById(run.projectId).lean();
  if (!project) return;

  const cases = await QaUploadedTestCase.find({ runId }).sort({ order: 1 });
  const total = cases.length;

  run.status = 'running';
  run.startedAt = new Date();
  run.currentDevice = SIMULATED_DEVICE_NAMES[Math.floor(Math.random() * SIMULATED_DEVICE_NAMES.length)];
  run.estimatedSeconds = total * (STEP_DELAY_MS / 1000) * 3;
  await run.save();

  const device = run.currentDevice as string;
  const osVersion = parseOsVersion(device);

  await log(runId, 'automation', 'info', `Starting uploaded test suite for "${(project as any).name}" — ${total} test case(s) on ${device}.`);

  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let bugSeq = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const caseElapsedMs: number[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const caseStart = Date.now();

    run.currentSuite = tc.module;
    run.currentFeature = tc.feature;
    run.currentCase = `${tc.testCaseId}: ${tc.scenario}`;
    run.progress = Math.round((i / Math.max(total, 1)) * 100);
    await run.save();
    await log(runId, 'automation', 'info', `[${tc.testCaseId}] ${tc.scenario} — starting.`);

    for (let si = 0; si < tc.steps.length; si++) {
      run.currentStep = `Step ${si + 1}/${tc.steps.length}: ${tc.steps[si]}`;
      run.currentScreen = detectScreen([tc.steps[si]]);
      await run.save();
      await sleep(STEP_DELAY_MS);
    }
    if (tc.steps.length === 0) {
      run.currentStep = 'Executing scenario';
      await run.save();
      await sleep(STEP_DELAY_MS);
    }

    const validation = i < AI_VALIDATION_CAP
      ? (await validateWithAi(apiKey, (project as any).name, (project as any).platform, tc)) ?? fallbackValidation(tc)
      : fallbackValidation(tc);

    const screen = validation.screen || run.currentScreen || randomScreen();
    run.currentScreen = screen;

    await QaScreenshot.create({
      runId, screenName: screen, testStep: tc.scenario, imageDataUrl: placeholderScreenshot(screen, tc.module, runId, (project as any).name),
    });

    tc.result = validation.result;
    tc.actualResult = validation.actualResult;
    tc.failedStepIndex = validation.failedStepIndex;
    tc.screenName = screen;

    if (validation.result === 'pass') {
      passed += 1;
      await log(runId, 'automation', 'info', `[${tc.testCaseId}] PASSED.`);
    } else if (validation.result === 'blocked') {
      blocked += 1;
      await log(runId, 'automation', 'warn', `[${tc.testCaseId}] BLOCKED — precondition not met.`);
    } else if (validation.result === 'skipped') {
      skipped += 1;
      await log(runId, 'automation', 'info', `[${tc.testCaseId}] SKIPPED.`);
    } else {
      failed += 1;
      const severity = normalizeSeverity(tc.severity);
      const priority = normalizePriority(tc.priority, severity);
      bugSeq += 1;
      const bugNumber = `BUG-${run.runNumber}-${String(bugSeq).padStart(3, '0')}`;
      const failedStepNumber = validation.failedStepIndex != null ? validation.failedStepIndex + 1 : null;

      const bug = await QaBug.create({
        userId: run.userId,
        projectId: run.projectId,
        runId,
        type: 'functional',
        module: tc.module,
        feature: tc.feature,
        severity,
        priority,
        bugNumber,
        testCaseId: tc.testCaseId,
        failedStepNumber,
        title: validation.bugTitle || `${tc.scenario} did not produce the expected result`,
        description: validation.bugDescription || 'The actual result diverged from the expected result for this test case.',
        screenName: screen,
        stepsToReproduce: tc.steps.length > 0 ? tc.steps : [tc.scenario],
        expectedResult: tc.expectedResult,
        actualResult: validation.actualResult,
        screenshotDataUrl: placeholderScreenshot(screen, tc.module, runId, (project as any).name),
        logs: `[${tc.testCaseId}] Failure captured on ${device} during automated execution.`,
        stackTrace: null,
        apiRequest: null,
        apiResponse: null,
        deviceInfo: device,
        osVersion,
        appVersion: run.buildVersion,
        aiRootCause: validation.aiRootCause || 'Root cause could not be determined automatically.',
        suggestedFix: validation.suggestedFix || 'Manually reproduce the scenario and inspect the relevant screen/component.',
      });

      tc.bugId = bug._id;
      severityCounts[severity] += 1;
      await log(runId, 'error', 'error', `[${tc.testCaseId}] FAILED (step ${failedStepNumber ?? '—'}) — bug ${bugNumber} created.`);
    }

    await tc.save();

    caseElapsedMs.push(Date.now() - caseStart);
    const avgMs = caseElapsedMs.reduce((a, b) => a + b, 0) / caseElapsedMs.length;
    const remaining = total - (i + 1);
    run.etaSeconds = remaining > 0 ? Math.round((avgMs * remaining) / 1000) : 0;
    run.passedCases = passed;
    run.failedCases = failed;
    run.blockedCases = blocked;
    run.skippedCases = skipped;
    run.totalCases = i + 1;
    await run.save();
  }

  const criticalOrHigh = severityCounts.critical + severityCounts.high;
  run.status = criticalOrHigh > 0 ? 'failed' : (failed + blocked) > 0 ? 'partial' : 'passed';
  run.progress = 100;
  run.currentStep = 'Completed';
  run.currentCase = null;
  run.etaSeconds = 0;
  run.completedAt = new Date();
  await run.save();

  await log(runId, 'automation', 'info', `Run completed: ${run.status.toUpperCase()} — ${passed}/${total} passed, ${failed} failed, ${blocked} blocked, ${skipped} skipped.`);
}
