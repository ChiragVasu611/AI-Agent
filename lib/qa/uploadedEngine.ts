import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { generateQaAnalysis, parseJsonLoose } from '@/lib/qa/ai-provider';
import { placeholderScreenshot } from '@/lib/qa/screenshot';
import { interpretStep } from '@/lib/qa/step-interpreter';
import { validateExpectation, type PageSignals } from '@/lib/qa/expectation-validator';
import {
  createExecutionSession, executeStep, captureScreenshot, currentScreenName, dismissBlockingOverlay,
  NAV_TIMEOUT_MS, type ExecutionSession,
} from '@/lib/qa/web-step-executor';
import { log } from '@/lib/qa/runtime-helpers';
import { scanDevices } from '@/lib/qa/device-detect';
import { prepareAndroidBinary, prepareFromPlayStore, prepareFromAppStore } from '@/lib/qa/app-preparation';
import { executeAndroidSuite } from '@/lib/qa/uploaded-sheet-engine';
import { onRunCompleted } from '@/lib/issue-boards/sync';
import type { QaBugType, QaPriority, QaSeverity } from '@/lib/types';

/** Source types the bundled Chromium runtime can genuinely drive end-to-end. */
const BROWSER_DRIVABLE = new Set(['web_url', 'web_app']);

/** Source types that need a physically connected Android device. */
const ANDROID_SOURCES = new Set(['apk', 'aab', 'flutter', 'react_native', 'hybrid']);

/** Page-load budget before we raise a real performance defect. */
const PERF_BUDGET_MS = 4000;

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

/**
 * AI is used ONLY to explain a failure that real execution already proved.
 * It can never turn a FAIL into a PASS or invent an outcome.
 */
async function explainFailure(
  apiKey: string | null,
  ctx: { appName: string; testCaseId: string; scenario: string; step: string; expected: string; actual: string; consoleErrors: string[] },
): Promise<{ rootCause: string; suggestedFix: string }> {
  const deterministic = {
    rootCause: ctx.consoleErrors.length > 0
      ? `The page reported JavaScript errors while this step ran: ${ctx.consoleErrors.slice(0, 2).join(' | ')}. The failure is most likely caused by that runtime error rather than the test data.`
      : `Execution reached the step "${ctx.step}" but the observed state did not satisfy the expected result. The element or state the test depends on was not present in the DOM at assertion time.`,
    suggestedFix: ctx.consoleErrors.length > 0
      ? 'Fix the JavaScript error surfaced in the console log attached to this bug, then re-run this test case.'
      : 'Confirm the expected element/label still exists and is rendered before the assertion point; if the UI changed, update the selector or the test case, otherwise fix the regression that removed it.',
  };

  if (!apiKey && !process.env.OPENROUTER_API_KEY) return deterministic;

  try {
    const content = await generateQaAnalysis(apiKey, {
      systemPrompt: 'You are a senior QA engineer analysing a test failure that has ALREADY been observed by a real browser automation run. Do not question whether it failed. Explain the most likely root cause and a concrete fix. Respond ONLY with minified JSON: {"rootCause":string,"suggestedFix":string}.',
      userPrompt: `App: ${ctx.appName}\nTest Case: ${ctx.testCaseId} — ${ctx.scenario}\nFailing step: ${ctx.step}\nExpected: ${ctx.expected}\nActually observed: ${ctx.actual}\nConsole errors: ${ctx.consoleErrors.slice(0, 3).join(' | ') || 'none'}`,
      maxTokens: 320,
    });
    const parsed = parseJsonLoose(content);
    const rootCause = typeof parsed?.rootCause === 'string' ? parsed.rootCause : '';
    const suggestedFix = typeof parsed?.suggestedFix === 'string' ? parsed.suggestedFix : '';
    return {
      rootCause: rootCause || deterministic.rootCause,
      suggestedFix: suggestedFix || deterministic.suggestedFix,
    };
  } catch {
    return deterministic;
  }
}

/**
 * Marks every case blocked with a truthful reason. Used when the uploaded
 * artifact has no runtime we can actually execute against — we refuse to
 * fabricate pass/fail rather than report results that mean nothing.
 */
async function blockAll(runId: string, run: any, cases: any[], reason: string, projectName: string) {
  await log(runId, 'automation', 'warn', reason);
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    tc.result = 'blocked';
    tc.actualResult = reason;
    tc.failedStepIndex = null;
    tc.screenName = 'Not executed';
    tc.stepResults = tc.steps.map((s: string, idx: number) => ({
      stepNumber: idx + 1,
      action: interpretStep(s, tc.testData).kind,
      instruction: s,
      status: 'blocked' as const,
      actual: 'Not executed — no runtime available for this application type.',
      assertion: 'none',
      durationMs: 0,
      url: '',
      screenshotDataUrl: null,
    }));
    await tc.save();
    run.blockedCases = i + 1;
    // totalCases is the size of the sheet, fixed for the run. Writing `i + 1`
    // here made the total climb alongside the blocked count, so the UI showed
    // "n of n blocked" at every moment and the run looked fully accounted for
    // while it was still marking cases.
    run.totalCases = cases.length;
    // No progress here: nothing was executed. Progress measures work done, and
    // marking rows as blocked is not work done on the device.
    await run.save();
  }

  await QaScreenshot.create({
    runId,
    screenName: 'Execution blocked',
    testStep: 'Runtime unavailable',
    imageDataUrl: placeholderScreenshot('Execution blocked', 'Runtime', runId, projectName),
  });

  run.status = 'partial';
  // Explicitly 0: not one step of the sheet ran. Reporting 100 told the user the
  // suite had been executed when nothing had been.
  run.progress = 0;
  run.currentStep = 'Blocked — no execution runtime';
  run.currentStepStatus = 'blocked';
  run.currentActual = reason;
  run.currentCase = null;
  run.etaSeconds = 0;
  run.completedAt = new Date();
  await run.save();
  await log(runId, 'automation', 'warn', `Run finished: ${cases.length} test case(s) BLOCKED. No results were fabricated.`);
  await onRunCompleted(runId);
}

/**
 * Cross-cutting defect scan over signals the browser genuinely produced during
 * the run — surfaces issues the uploaded sheet never asked about.
 */
async function detectCrossCuttingBugs(
  runId: string,
  run: any,
  project: any,
  session: ExecutionSession,
  slowestLoadMs: number,
  nextBugNumber: () => string,
): Promise<number> {
  const page = session.page;
  const found: Array<{ type: QaBugType; severity: QaSeverity; title: string; description: string; expected: string; actual: string; fix: string }> = [];

  const audit = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    return {
      imagesMissingAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      inputsMissingLabel: inputs.filter((el) => {
        const id = el.getAttribute('id');
        const labelled = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
        return !labelled && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby');
      }).length,
      hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      htmlLang: document.documentElement.getAttribute('lang'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 4,
    };
  }).catch(() => null);

  const url = page.url();

  if (!/^https:/i.test(url) && !/localhost|127\.0\.0\.1/.test(url)) {
    found.push({
      type: 'security', severity: 'high',
      title: 'Application is served over plain HTTP',
      description: `The target "${url}" is not served over HTTPS. Credentials and session tokens transit in cleartext.`,
      expected: 'All traffic served over HTTPS.', actual: `Page loaded over ${new URL(url).protocol}`,
      fix: 'Terminate TLS at the edge and force an HTTP→HTTPS redirect plus HSTS.',
    });
  }
  if (session.signals.pageErrors.length > 0) {
    found.push({
      type: 'crash', severity: 'critical',
      title: 'Uncaught JavaScript exception during execution',
      description: `The application threw ${session.signals.pageErrors.length} uncaught exception(s) while the suite ran.`,
      expected: 'No uncaught exceptions during normal user flows.',
      actual: session.signals.pageErrors.slice(0, 3).join(' | '),
      fix: 'Reproduce the flow with the browser console open and add error handling around the throwing call site.',
    });
  }
  if (session.signals.consoleErrors.length > 0) {
    found.push({
      type: 'functional', severity: 'medium',
      title: `${session.signals.consoleErrors.length} console error(s) logged during execution`,
      description: 'The application logged errors to the browser console while the suite ran.',
      expected: 'A clean console during normal user flows.',
      actual: session.signals.consoleErrors.slice(0, 3).join(' | '),
      fix: 'Triage each console error; they frequently precede user-visible defects.',
    });
  }
  const failedApis = session.signals.apiCalls.filter((c) => c.status >= 400);
  if (failedApis.length > 0) {
    found.push({
      type: 'api', severity: failedApis.some((c) => c.status >= 500) ? 'critical' : 'high',
      title: `${failedApis.length} API call(s) returned an error status`,
      description: 'Backend calls made during execution returned 4xx/5xx responses.',
      expected: 'All API calls return success statuses during the tested flows.',
      actual: failedApis.slice(0, 4).map((c) => `${c.status} ${c.url}`).join('; '),
      fix: 'Inspect the listed endpoints; fix the server error or the client request payload.',
    });
  }
  if (session.signals.failedRequests.length > 0) {
    found.push({
      type: 'network', severity: 'medium',
      title: `${session.signals.failedRequests.length} network request(s) failed to complete`,
      description: 'Requests were aborted or could not be resolved during execution.',
      expected: 'All network requests complete successfully.',
      actual: session.signals.failedRequests.slice(0, 3).join(' | '),
      fix: 'Check for broken asset URLs, CORS rejections, or blocked third-party hosts.',
    });
  }
  if (slowestLoadMs > PERF_BUDGET_MS) {
    found.push({
      type: 'performance', severity: slowestLoadMs > PERF_BUDGET_MS * 2 ? 'high' : 'medium',
      title: `Slow page load — ${(slowestLoadMs / 1000).toFixed(1)}s`,
      description: `The slowest navigation during this run took ${slowestLoadMs}ms, over the ${PERF_BUDGET_MS}ms budget.`,
      expected: `Page loads complete within ${PERF_BUDGET_MS}ms.`, actual: `${slowestLoadMs}ms`,
      fix: 'Profile the critical path; defer non-essential scripts and compress render-blocking assets.',
    });
  }
  if (audit) {
    if (audit.imagesMissingAlt > 0 || audit.inputsMissingLabel > 0) {
      found.push({
        type: 'accessibility', severity: 'medium',
        title: 'Accessibility violations on the executed screens',
        description: `${audit.imagesMissingAlt} image(s) without alt text and ${audit.inputsMissingLabel} form control(s) without an accessible label.`,
        expected: 'All images have alt text and all inputs have accessible labels.',
        actual: `imagesMissingAlt=${audit.imagesMissingAlt}, inputsMissingLabel=${audit.inputsMissingLabel}`,
        fix: 'Add alt attributes and associate every input with a <label for> or aria-label.',
      });
    }
    if (audit.brokenImages > 0) {
      found.push({
        type: 'ui', severity: 'medium',
        title: `${audit.brokenImages} image(s) failed to render`,
        description: 'Images are present in the DOM but resolved to zero intrinsic width — the asset did not load.',
        expected: 'All referenced images load and render.', actual: `${audit.brokenImages} broken image(s)`,
        fix: 'Fix the broken asset paths or add a fallback image.',
      });
    }
    if (!audit.hasViewportMeta || audit.horizontalOverflow) {
      found.push({
        type: 'compatibility', severity: 'medium',
        title: !audit.hasViewportMeta ? 'Missing responsive viewport meta tag' : 'Layout overflows horizontally',
        description: !audit.hasViewportMeta
          ? 'No <meta name="viewport"> tag — the layout will not adapt on mobile devices.'
          : 'Document scroll width exceeds the viewport, forcing horizontal scrolling.',
        expected: 'Layout adapts to the viewport without horizontal scrolling.',
        actual: `hasViewportMeta=${audit.hasViewportMeta}, horizontalOverflow=${audit.horizontalOverflow}`,
        fix: 'Add the viewport meta tag and constrain fixed-width elements with max-width:100%.',
      });
    }
  }

  const shot = await captureScreenshot(page);
  for (const f of found) {
    await QaBug.create({
      userId: run.userId, projectId: run.projectId, runId,
      type: f.type, module: 'Cross-cutting scan', feature: 'Automated audit',
      severity: f.severity, priority: normalizePriority('', f.severity),
      bugNumber: nextBugNumber(), testCaseId: '', failedStepNumber: null,
      title: f.title, description: f.description,
      screenName: await currentScreenName(page),
      stepsToReproduce: [`Open ${url}`, 'Run the uploaded test suite', 'Observe the reported signal'],
      expectedResult: f.expected, actualResult: f.actual,
      screenshotDataUrl: shot,
      logs: session.signals.consoleErrors.slice(0, 5).join('\n') || 'No console output captured.',
      stackTrace: session.signals.pageErrors[0] ?? null,
      apiRequest: null,
      apiResponse: failedApis.slice(0, 3).map((c) => `${c.status} ${c.url}`).join('\n') || null,
      deviceInfo: run.currentDevice, osVersion: 'Chromium (headless)', appVersion: run.buildVersion,
      aiRootCause: f.description, suggestedFix: f.fix,
    });
    await log(runId, 'error', 'warn', `Cross-cutting defect: ${f.title}`);
  }
  return found.length;
}

/**
 * Full physical-device path: pick the connected device, prepare the app
 * (install → verify → launch → confirm foreground), then execute the sheet.
 * Execution only begins once the app is genuinely open.
 */
async function runOnAndroidDevice(
  runId: string,
  run: any,
  project: any,
  cases: any[],
  sourceType: string,
  sourceRef: string,
) {
  // 1. Find a usable, authorized device — preferring the one the user picked.
  // Android only: the iOS probe's result is filtered out on the next line
  // anyway, and it can add seconds of timeout budget before the run starts.
  const scan = await scanDevices({ platform: 'android' });
  const usable = scan.devices.filter((d) => d.platform === 'android' && d.state === 'online');
  const wanted = run.deviceSerial ? String(run.deviceSerial) : null;
  const device = (wanted ? usable.find((d) => d.id === wanted) : null) ?? usable[0];

  if (wanted && device && device.id !== wanted) {
    await log(runId, 'automation', 'warn', `Selected device "${wanted}" is not connected; falling back to ${device.name} (${device.id}).`);
  } else if (wanted && device) {
    await log(runId, 'automation', 'info', `Using the device selected in QA → Devices: ${device.name} (${device.id}).`);
  } else if (!wanted && usable.length > 1) {
    await log(runId, 'automation', 'warn', `${usable.length} devices are connected and none was selected — using ${usable[0].name} (${usable[0].id}). Pick one in QA → Devices to choose explicitly.`);
  }

  if (!device) {
    run.currentDevice = 'No device connected';
    run.engineMode = 'blocked_no_runtime';
    await run.save();
    const androidIssue = scan.issues.find((i) => i.platform === 'android');
    const reason = `Execution blocked: no authorized Android device is connected over USB, so the application cannot be installed or launched.${androidIssue ? ` ${androidIssue.title} — ${androidIssue.detail}` : ''} Connect a device (see QA → Devices) and start a new run.`;
    await blockAll(runId, run, cases, reason, project.name);
    return;
  }

  const deviceLabel = `${device.name} (${device.model}, ${device.osVersion})`;
  run.currentDevice = deviceLabel;
  run.engineMode = 'real_browser'; // real hardware execution, not a simulation
  await run.save();
  await log(runId, 'automation', 'info', `Preparing "${project.name}" on ${deviceLabel} (${device.id}).`);

  // 2. Prepare the app — never execute before it is genuinely running.
  //
  // Preparation steps are logged AS THEY HAPPEN. Replaying them afterwards left
  // the run log empty for the 45-90s that install + reset + launch actually
  // take, so the UI looked frozen through the longest phase of the run.
  const reportPrep = async (s: { label: string; ok: boolean; detail: string }) => {
    run.currentStep = `Preparing: ${s.label}`;
    await run.save().catch(() => null);
    await log(runId, 'automation', s.ok ? 'info' : 'warn', `Preparation — ${s.label}: ${s.detail}`);
  };

  const prep = sourceType === 'play_store_url'
    ? await prepareFromPlayStore(device.id, sourceRef)
    : await prepareAndroidBinary(
      device.id,
      project.binaryPath ?? null,
      project.appPackageName ?? null,
      project.sourceFileName ?? sourceRef,
      reportPrep,
    );

  // The Play Store path does not stream, so replay its trail (the APK path
  // already published every step above and must not log them twice).
  if (sourceType === 'play_store_url') {
    for (const s of prep.steps) {
      await log(runId, 'automation', s.ok ? 'info' : 'warn', `Preparation — ${s.label}: ${s.detail}`);
    }
  }

  if (!prep.ready) {
    if (prep.screenshot) {
      await QaScreenshot.create({
        runId, screenName: 'Preparation failed', testStep: 'Preparation', imageDataUrl: prep.screenshot,
      });
    }
    run.engineMode = 'blocked_no_runtime';
    await run.save();
    await blockAll(runId, run, cases, `Execution blocked before it began: ${prep.blockedReason}`, project.name);
    return;
  }

  await log(runId, 'automation', 'info', `Application is running on ${deviceLabel}. Starting execution of ${cases.length} test case(s).`);

  // 3. Execute the sheet against the live app.
  let totals;
  try {
    totals = await executeAndroidSuite({ runId, run, project, cases, serial: device.id, deviceLabel, prep });
  } catch (e) {
    await log(runId, 'error', 'error', `Device execution aborted: ${(e as Error).message}`);
    run.status = 'failed';
    run.currentStep = `Aborted: ${(e as Error).message}`;
    // Progress deliberately left where it stopped: the run did NOT complete, and
    // writing 100 here would report an aborted run as fully executed.
    run.completedAt = new Date();
    await run.save();
    await onRunCompleted(runId);
    return;
  }

  const {
    passed, failed, blocked, skipped, cancelled, executedSteps, totalSteps, verdictedCases,
  } = totals;

  // "Complete" is a measurement, not a constant.
  //
  // This used to be an unconditional `run.progress = 100` + 'Completed', so a
  // run that stopped after 3 of 40 cases — user cancelled, device unplugged,
  // preparation blocked — still displayed 100% Complete, which is the single
  // most misleading thing this module could report. A run is complete only when
  // every case reached a verdict AND every step the sheet contains was executed.
  const allCasesVerdicted = verdictedCases >= cases.length;
  const allStepsExecuted = totalSteps === 0 || executedSteps >= totalSteps;
  const fullyExecuted = !cancelled && allCasesVerdicted && allStepsExecuted;

  run.status = cancelled
    ? 'cancelled'
    : failed > 0 ? (passed > 0 ? 'partial' : 'failed')
      : !fullyExecuted ? 'partial'
        : blocked > 0 || skipped > 0 ? 'partial' : 'passed';

  run.progress = fullyExecuted
    ? 100
    : totalSteps > 0
      ? Math.min(99, Math.round((executedSteps / totalSteps) * 100))
      : Math.min(99, Math.round((verdictedCases / Math.max(cases.length, 1)) * 100));

  run.currentStep = cancelled
    ? `Stopped by user after ${verdictedCases}/${cases.length} test case(s)`
    : fullyExecuted
      ? 'Completed'
      : `Ended early — ${verdictedCases}/${cases.length} test case(s) and ${executedSteps}/${totalSteps} step(s) executed`;

  run.currentCase = null;
  run.currentStepStatus = fullyExecuted ? 'pass' : 'blocked';
  run.etaSeconds = 0;
  run.passedCases = passed;
  run.failedCases = failed;
  run.blockedCases = blocked;
  run.skippedCases = skipped;
  run.completedAt = new Date();
  await run.save();

  await log(runId, 'automation', fullyExecuted ? 'info' : 'warn',
    `Run ${cancelled ? 'stopped by user' : fullyExecuted ? 'completed' : 'ended early'} on ${deviceLabel}: ${String(run.status).toUpperCase()} — `
    + `${passed}/${cases.length} passed, ${failed} failed, ${blocked} blocked, ${skipped} skipped; `
    + `${executedSteps}/${totalSteps} step(s) executed.`);
  await onRunCompleted(runId);
}

export async function runUploadedTestExecution(runId: string, apiKey: string | null) {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId);
  if (!run) return;
  const project = await QaProject.findById(run.projectId).lean<any>();
  if (!project) return;

  const cases = await QaUploadedTestCase.find({ runId }).sort({ order: 1 });
  const total = cases.length;

  run.status = 'running';
  run.startedAt = new Date();
  run.totalCases = total;
  await run.save();

  const sourceType = String(project.sourceType);
  const sourceRef = String(project.sourceRef ?? '');
  const canDrive = BROWSER_DRIVABLE.has(sourceType) && /^https?:\/\//i.test(sourceRef);

  // ---- Physical Android device: install → launch → execute for real. ----
  if (ANDROID_SOURCES.has(sourceType) || sourceType === 'play_store_url') {
    await runOnAndroidDevice(runId, run, project, cases, sourceType, sourceRef);
    return;
  }

  // ---- iOS store/binary: no runtime on this host. ----
  if (sourceType === 'app_store_url' || sourceType === 'ipa') {
    run.currentDevice = 'No iOS runtime attached';
    run.engineMode = 'blocked_no_runtime';
    await run.save();
    const prep = await prepareFromAppStore(sourceRef);
    for (const s of prep.steps) {
      await log(runId, 'automation', s.ok ? 'info' : 'warn', `Preparation — ${s.label}: ${s.detail}`);
    }
    await blockAll(runId, run, cases, prep.blockedReason ?? 'No iOS execution runtime is available on this host.', project.name);
    return;
  }

  // ---- No real runtime for this artifact: block honestly, never fabricate. ----
  if (!canDrive) {
    run.currentDevice = 'No runtime attached';
    run.engineMode = 'blocked_no_runtime';
    await run.save();
    await blockAll(runId, run, cases, `Execution blocked: "${sourceRef}" is not a valid http(s) URL, so there is nothing to drive.`, project.name);
    return;
  }

  // ---- Real browser execution ----
  run.currentDevice = 'Chromium (headless, 1366x900)';
  run.engineMode = 'real_browser';
  await run.save();

  await log(runId, 'automation', 'info', `Starting REAL browser execution of ${total} uploaded test case(s) against ${sourceRef}.`);

  let session: ExecutionSession;
  try {
    session = await createExecutionSession(sourceRef);
  } catch (e) {
    await blockAll(runId, run, cases, `Execution blocked: the browser runtime failed to start — ${(e as Error).message}`, project.name);
    return;
  }

  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let bugSeq = 0;
  let slowestLoadMs = 0;
  const nextBugNumber = () => `BUG-${run.runNumber}-${String(++bugSeq).padStart(3, '0')}`;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const caseElapsedMs: number[] = [];

  // Step-level accounting, so completion is measured rather than assumed.
  const totalSteps = cases.reduce((n: number, tc: any) => n + (tc.steps?.length ?? 0), 0);
  let executedSteps = 0;
  let verdictedCases = 0;

  // Cooperative cancellation. The browser path had NONE: Stop Execution wrote
  // status 'cancelled' to the database, this loop never read it, kept running
  // every remaining case, and then overwrote the status at the end — so the
  // button appeared to do nothing. Mirrors the device path's throttled poll.
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

  try {
    // Load the target once up front so the first case starts from a real page.
    const navStart = Date.now();
    await session.page.goto(sourceRef, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    slowestLoadMs = Math.max(slowestLoadMs, Date.now() - navStart);
    await log(runId, 'automation', 'info', `Loaded ${sourceRef} in ${Date.now() - navStart}ms.`);

    const targetOrigin = new URL(sourceRef).origin;

    for (let i = 0; i < cases.length; i++) {
      if (await checkCancelled()) {
        await log(runId, 'automation', 'warn', `Execution stopped by user request before test case ${i + 1}/${cases.length}. Partial results are saved.`);
        break;
      }

      const tc = cases[i];
      const caseStart = Date.now();

      run.currentSuite = tc.module;
      run.currentModule = tc.module;
      run.currentFeature = tc.feature;
      run.currentTestCaseId = tc.testCaseId;
      run.currentScenario = tc.scenario;
      run.currentCase = `${tc.testCaseId}: ${tc.scenario}`;
      run.currentExpected = tc.expectedResult ?? '';
      run.currentActual = '';
      run.currentStepStatus = 'running';
      // Measured against steps so it advances within a long case, and capped
      // below 100 — only the finalization block, having confirmed every case was
      // verdicted and every step executed, may write 100.
      run.progress = totalSteps > 0
        ? Math.min(99, Math.round((executedSteps / totalSteps) * 100))
        : Math.min(99, Math.round((i / Math.max(total, 1)) * 100));
      await run.save();
      await log(runId, 'automation', 'info', `[${tc.testCaseId}] ${tc.scenario} — executing ${tc.steps.length} step(s).`);

      // Re-anchor on the app's own origin before every case. One step that
      // clicks an ad or a third-party OAuth link can navigate the shared page
      // away entirely — without this, every remaining case would keep
      // "executing" against the wrong site and just look like it silently
      // stopped progressing, the same failure mode fixed on the Android engine.
      let currentOrigin: string | null = null;
      try { currentOrigin = new URL(session.page.url()).origin; } catch { /* about:blank etc. */ }
      if (currentOrigin && currentOrigin !== targetOrigin) {
        const recovered = await session.page
          .goto(sourceRef, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        if (!recovered) {
          const shot = await captureScreenshot(session.page);
          tc.result = 'blocked';
          tc.actualResult = `Blocked: the page had navigated to "${currentOrigin}" (expected "${targetOrigin}") and could not be returned to the app under test. The steps were not executed, because they would have run against a different site.`;
          tc.failedStepIndex = null;
          tc.screenName = await currentScreenName(session.page);
          tc.stepResults = [];
          await tc.save();
          blocked += 1;
          run.blockedCases = blocked;
          await run.save();
          if (shot) {
            await QaScreenshot.create({ runId, screenName: 'Navigated away from app', testStep: tc.scenario, imageDataUrl: shot });
          }
          await log(runId, 'automation', 'error', `[${tc.testCaseId}] BLOCKED — the page left ${targetOrigin} and could not be recovered.`);
          continue;
        }
        await log(runId, 'automation', 'warn', `[${tc.testCaseId}] The page had drifted to "${currentOrigin}"; navigated back to ${sourceRef}.`);
      }

      const stepRecords: StepRecord[] = [];
      let firstFailedStepIndex: number | null = null;
      let firstFailureDetail = '';

      // ---- Execute every step, in order, for real. ----
      for (let si = 0; si < tc.steps.length; si++) {
        const instruction = tc.steps[si];
        const action = interpretStep(instruction, tc.testData);

        run.currentStep = `Step ${si + 1}/${tc.steps.length}: ${instruction}`;
        await run.save();

        // Every step in the sheet is executed, including the ones after a
        // failure. Skipping them used to hide whether they work at all: one
        // early failure reported the whole rest of the case as "not executed",
        // which reads as the engine having stopped and leaves the remaining
        // steps permanently unverified. Each step now reports its own verdict.

        // Proactively clear a cookie-consent banner or modal before even
        // attempting the step — these are never what the sheet's step is
        // about, so they must never be allowed to fail it.
        const preDismiss = await dismissBlockingOverlay(session.page).catch(() => ({ handled: [] as string[] }));
        if (preDismiss.handled.length > 0) {
          await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1}: ${preDismiss.handled.join('; ')} before executing.`);
        }

        session.resetSignals();
        const stepStart = Date.now();
        let exec = await executeStep(session.page, action, sourceRef);

        // The step's own failure can itself be an overlay the previous step
        // surfaced. Clear it and retry exactly once before accepting the step
        // as genuinely failed.
        if (!exec.ok) {
          const postDismiss = await dismissBlockingOverlay(session.page).catch(() => ({ handled: [] as string[] }));
          if (postDismiss.handled.length > 0) {
            await log(runId, 'automation', 'warn', `[${tc.testCaseId}] Step ${si + 1} initially failed; ${postDismiss.handled.join('; ')} and retrying.`);
            exec = await executeStep(session.page, action, sourceRef);
          }
        }
        const durationMs = Date.now() - stepStart;
        if (action.kind === 'navigate') slowestLoadMs = Math.max(slowestLoadMs, durationMs);

        let status: StepRecord['status'] = exec.ok ? 'pass' : 'fail';
        let actual = exec.detail;
        let assertion: string = action.kind;

        // A 'verify' step carries its own inline assertion — check it for real.
        if (exec.ok && action.kind === 'verify') {
          // Assert what the sheet actually expects. Passing the step's own
          // prose here demanded its instruction verbs ("verify") literally
          // appear on the page. The verify step's own named subject is used
          // when it has one, otherwise the case's Expected Result column.
          const subject = action.target?.trim() ? action.target : tc.expectedResult;
          const v = await validateExpectation(session.page, subject, session.signals);
          status = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
          actual = v.actual;
          assertion = v.assertion;
        } else if (action.kind === 'unknown') {
          // Unmappable steps are blocked, not silently passed.
          status = 'blocked';
        }

        const shot = await captureScreenshot(session.page);
        const screen = await currentScreenName(session.page);

        stepRecords.push({
          stepNumber: si + 1, action: action.kind, instruction, status, actual, assertion,
          durationMs, url: session.page.url(), screenshotDataUrl: shot,
        });
        executedSteps += 1;

        await QaScreenshot.create({
          runId, screenName: `${screen} — step ${si + 1}`, testStep: tc.scenario,
          imageDataUrl: shot ?? placeholderScreenshot(screen, tc.module, runId, project.name),
        });

        // Live preview: current screen, what this step actually did, and its
        // verdict — visible while the run is still in flight.
        run.currentScreen = screen;
        run.currentActual = actual;
        run.currentStepStatus = status;
        await run.save();

        if (status === 'fail' || status === 'blocked') {
          // FIRST failure only. Now that a failure no longer skips the remaining
          // steps, this runs for every later failure too — without the guard the
          // "first failed step" would drift to the LAST one, so both the case
          // verdict and the bug's failedStepNumber would point at the wrong step.
          if (firstFailedStepIndex === null) {
            firstFailedStepIndex = si;
            firstFailureDetail = actual;
          }
          await log(runId, 'error', status === 'fail' ? 'error' : 'warn', `[${tc.testCaseId}] Step ${si + 1} ${status.toUpperCase()}: ${actual}`);
        } else {
          await log(runId, 'automation', 'debug', `[${tc.testCaseId}] Step ${si + 1} PASS: ${actual}`);
        }
      }

      // ---- Validate the case-level Expected Result against the live page. ----
      // Every step ran, so this is a roll-up of verdicts already reached rather
      // than the first place failure is noticed.
      let finalResult: 'pass' | 'fail' | 'blocked';
      let finalActual: string;

      if (firstFailedStepIndex !== null) {
        const failedRec = stepRecords[firstFailedStepIndex];
        finalResult = failedRec.status === 'blocked' ? 'blocked' : 'fail';
        const alsoFailed = stepRecords.filter((s, idx) => idx !== firstFailedStepIndex && s.status === 'fail').length;
        finalActual = `Step ${firstFailedStepIndex + 1} ("${failedRec.instruction}") ${failedRec.status === 'blocked' ? 'could not be executed' : 'failed'}: ${firstFailureDetail}`
          + (alsoFailed > 0 ? ` A further ${alsoFailed} step(s) in this test case also failed — see the per-step results.` : '');
      } else {
        // Same reasoning as per-step: a cookie banner or modal must never be
        // mistaken for the app's genuine expected-result state.
        await dismissBlockingOverlay(session.page).catch(() => null);
        const v = await validateExpectation(session.page, tc.expectedResult, session.signals);
        finalResult = v.status === 'pass' ? 'pass' : v.status === 'fail' ? 'fail' : 'blocked';
        finalActual = v.actual;
        if (v.status !== 'pass' && stepRecords.length > 0) {
          firstFailedStepIndex = stepRecords.length - 1;
          stepRecords[stepRecords.length - 1].status = v.status === 'fail' ? 'fail' : 'blocked';
          stepRecords[stepRecords.length - 1].actual = v.actual;
          stepRecords[stepRecords.length - 1].assertion = v.assertion;
        }
      }

      const screen = await currentScreenName(session.page);
      tc.result = finalResult;
      tc.actualResult = finalActual;
      tc.failedStepIndex = firstFailedStepIndex;
      tc.screenName = screen;
      tc.stepResults = stepRecords;
      verdictedCases += 1;

      if (finalResult === 'pass') {
        passed += 1;
        await log(runId, 'automation', 'info', `[${tc.testCaseId}] PASSED — expected result verified against the live page.`);
      } else if (finalResult === 'blocked') {
        blocked += 1;
        await log(runId, 'automation', 'warn', `[${tc.testCaseId}] BLOCKED — ${finalActual}`);
      } else {
        failed += 1;
        const severity = normalizeSeverity(tc.severity);
        const priority = normalizePriority(tc.priority, severity);
        const failedStepNumber = firstFailedStepIndex != null ? firstFailedStepIndex + 1 : null;
        const evidenceShot = (firstFailedStepIndex != null ? stepRecords[firstFailedStepIndex]?.screenshotDataUrl : null)
          ?? await captureScreenshot(session.page);

        const explanation = await explainFailure(apiKey, {
          appName: project.name, testCaseId: tc.testCaseId, scenario: tc.scenario,
          step: firstFailedStepIndex != null ? stepRecords[firstFailedStepIndex].instruction : tc.scenario,
          expected: tc.expectedResult, actual: finalActual, consoleErrors: session.signals.consoleErrors,
        });

        const bug = await QaBug.create({
          userId: run.userId, projectId: run.projectId, runId,
          type: 'functional', module: tc.module, feature: tc.feature,
          severity, priority, bugNumber: nextBugNumber(),
          testCaseId: tc.testCaseId, failedStepNumber,
          title: `${tc.testCaseId}: ${tc.scenario} — expected result not achieved`,
          description: `Real browser execution of this test case diverged from the sheet's expected result at step ${failedStepNumber ?? '—'}. ${finalActual}`,
          screenName: screen,
          stepsToReproduce: tc.steps.length > 0 ? tc.steps : [tc.scenario],
          expectedResult: tc.expectedResult,
          actualResult: finalActual,
          screenshotDataUrl: evidenceShot,
          logs: [
            `URL at failure: ${session.page.url()}`,
            ...stepRecords.map((s) => `Step ${s.stepNumber} [${s.status}] ${s.instruction} → ${s.actual}`),
            ...(session.signals.consoleErrors.length > 0 ? ['', 'Console errors:', ...session.signals.consoleErrors.slice(0, 5)] : []),
          ].join('\n'),
          stackTrace: session.signals.pageErrors[0] ?? null,
          apiRequest: null,
          apiResponse: session.signals.apiCalls.slice(0, 5).map((c) => `${c.status} ${c.url} (${c.ms}ms)`).join('\n') || null,
          deviceInfo: run.currentDevice, osVersion: 'Chromium (headless)', appVersion: run.buildVersion,
          aiRootCause: explanation.rootCause, suggestedFix: explanation.suggestedFix,
        });

        tc.bugId = bug._id;
        severityCounts[severity] += 1;
        await log(runId, 'error', 'error', `[${tc.testCaseId}] FAILED at step ${failedStepNumber ?? '—'} — bug ${bug.bugNumber} created with evidence.`);
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
      await run.save();
    }

    await log(runId, 'automation', 'info', 'Running cross-cutting defect scan over signals captured during execution.');
    const extra = await detectCrossCuttingBugs(runId, run, project, session, slowestLoadMs, nextBugNumber);
    if (extra > 0) await log(runId, 'automation', 'warn', `Cross-cutting scan raised ${extra} additional defect(s).`);
  } catch (e) {
    await log(runId, 'error', 'error', `Execution aborted: ${(e as Error).message}`);
    run.status = 'failed';
    run.currentStep = `Aborted: ${(e as Error).message}`;
    run.completedAt = new Date();
    await run.save();
    await session.close();
    await onRunCompleted(runId);
    return;
  }

  await session.close();

  const criticalOrHigh = severityCounts.critical + severityCounts.high;

  // Same rule as the device path: 100% Complete is a measurement. A cancelled or
  // early-ended browser run keeps the percentage it actually reached.
  const allCasesVerdicted = verdictedCases >= cases.length;
  const allStepsExecuted = totalSteps === 0 || executedSteps >= totalSteps;
  const fullyExecuted = !cancelled && allCasesVerdicted && allStepsExecuted;

  run.status = cancelled
    ? 'cancelled'
    : criticalOrHigh > 0 || failed > 0 ? (passed > 0 ? 'partial' : 'failed')
      : !fullyExecuted ? 'partial'
        : blocked > 0 || skipped > 0 ? 'partial' : 'passed';

  run.progress = fullyExecuted
    ? 100
    : totalSteps > 0
      ? Math.min(99, Math.round((executedSteps / totalSteps) * 100))
      : Math.min(99, Math.round((verdictedCases / Math.max(cases.length, 1)) * 100));

  run.currentStep = cancelled
    ? `Stopped by user after ${verdictedCases}/${cases.length} test case(s)`
    : fullyExecuted
      ? 'Completed'
      : `Ended early — ${verdictedCases}/${cases.length} test case(s) and ${executedSteps}/${totalSteps} step(s) executed`;

  run.currentCase = null;
  run.etaSeconds = 0;
  run.completedAt = new Date();
  await run.save();

  await log(runId, 'automation', fullyExecuted ? 'info' : 'warn',
    `Run ${cancelled ? 'stopped by user' : fullyExecuted ? 'completed' : 'ended early'}: ${String(run.status).toUpperCase()} — `
    + `${passed}/${total} passed, ${failed} failed, ${blocked} blocked, ${skipped} skipped; `
    + `${executedSteps}/${totalSteps} step(s) executed.`);
  await onRunCompleted(runId);
}
