import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { User } from '@/lib/mongodb/models/User';
import { log } from '@/lib/qa/runtime-helpers';
import { onRunCompleted } from '@/lib/issue-boards/sync';
import { DEFAULT_SMOKE_MODULES } from '@/lib/qa/modules';
import { installApk, clearAppData, isPackageInstalled } from '@/lib/qa/adb';
import type { QaCredentials } from './login-handler';

import { profileDevice, forceStop, startAppTimed } from './device';
import { ScreenshotManager } from './screenshots';
import { CrashMonitor } from './crash-monitor';
import { BugReporter } from './bug-generator';
import { explore, observeScreen } from './explorer';
import { sampleMemory } from './memory';
import { sampleBattery } from './battery';
import {
  ModulePlan, runPerScreenModules, runPostModules, runMonkeyModule,
  runCompatibilityModule, runAiExploratory, resetCheckSequence, type PostRunContext,
} from './module-runner';
import { persistOutcomes, computeStatus, computePerformanceScore } from './report';
import {
  PlanningSession, KnowledgeBase, CoverageEngine,
  newLedger, assessModules, completeCount, type EvidenceLedger,
} from './planning';
import type { CheckOutcome, Finding, ScreenState } from './types';

/**
 * Autonomous Android execution engine — orchestrator.
 *
 * PUBLIC CONTRACT (unchanged): runAndroidDeviceExecution(runId, serial).
 * The existing route/lifecycle/schema/polling all keep working — only the
 * behaviour behind this signature is upgraded from "install + a few
 * screenshots" to a full autonomous exploration + module suite.
 *
 * Pipeline:
 *   profile device → install APK → baseline metrics → autonomous exploration
 *   (per-screen modules run as screens are discovered; crashes filed live) →
 *   post-run modules (perf/mem/battery/network/security) → dedicated modules
 *   (monkey/compatibility/AI) → persist results → verdict → cleanup.
 *
 * Everything persisted is real device data. There are no simulated screenshots
 * and no fabricated bugs anywhere in this path.
 */

/** Overall wall-clock ceiling so a run can never hang the worker. */
const MAX_RUN_MS = 12 * 60_000;
/** Hard cap on exploration interactions (the graph normally terminates first). */
const MAX_EXPLORE_STEPS = 220;

export async function runAndroidDeviceExecution(runId: string, serial: string): Promise<void> {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId);
  if (!run) return;
  const project = await QaProject.findById(run.projectId).lean<any>();
  if (!project) return;

  const startedAt = Date.now();
  const deadlineAt = startedAt + MAX_RUN_MS;
  resetCheckSequence();

  run.status = 'running';
  run.startedAt = new Date();
  run.engineMode = 'real_device';
  await run.save();

  const emit = async (level: 'debug' | 'info' | 'warn' | 'error', message: string) => {
    const source = level === 'error' ? 'error' : level === 'warn' ? 'automation' : 'automation';
    await log(runId, source, level, message);
  };

  // Cooperative cancellation: the Stop button flips the run's status to
  // 'cancelled' in the DB; the engine polls that (throttled) and stops promptly.
  let lastCancelCheck = 0;
  const checkCancelled = async (force = false): Promise<boolean> => {
    const now = Date.now();
    if (!force && now - lastCancelCheck < 2_500) return false;
    lastCancelCheck = now;
    try {
      const doc = await QaTestRun.findById(runId).select('status').lean<{ status?: string }>();
      return doc?.status === 'cancelled';
    } catch { return false; }
  };

  const packageName: string | null = project.appPackageName ?? null;
  const apkPath: string | null = project.binaryPath ?? null;
  const appName: string = project.name ?? project.appDisplayName ?? 'App under test';
  const modules: string[] = (run.modules?.length ? run.modules : DEFAULT_SMOKE_MODULES);
  const plan = new ModulePlan(modules);

  const profile = await profileDevice(serial);
  run.currentDevice = `${profile.model} · ${profile.osVersion}`;
  await run.save();

  await emit('info', `Real-device run for "${appName}" on ${profile.model} (${profile.osVersion}).`);
  await emit('info', `Selected modules: ${plan.list().join(', ') || '(default smoke set)'}`);

  const fail = async (message: string) => {
    await emit('error', message);
    run.status = 'failed';
    run.progress = 100;
    run.currentStep = 'Failed';
    run.completedAt = new Date();
    await run.save();
    await onRunCompleted(runId);
  };

  // ATTACH MODE: an 'installed_app' project targets an app already present on
  // the device, so there is no binary to install — the engine attaches to the
  // installed package instead. Everything after launch is identical.
  const attachMode = !apkPath && project.sourceType === 'installed_app';

  if (!packageName) return fail('Could not determine the app package name — cannot launch it.');
  if (!apkPath && !attachMode) return fail('No APK binary was stored for this project — cannot install on the device.');
  if (attachMode && !(await isPackageInstalled(serial, packageName))) {
    return fail(`"${packageName}" is not installed on ${profile.model} any more. Reload the installed-app list and start a new run.`);
  }

  // Load QA credentials from the user record if present (best-effort, optional).
  let credentials: QaCredentials | null = null;
  try {
    const dbUser = await User.findById(run.userId).lean<any>();
    if (dbUser?.qaTestEmail || dbUser?.qaTestPassword || dbUser?.qaTestPhone) {
      credentials = {
        email: dbUser.qaTestEmail ?? null,
        password: dbUser.qaTestPassword ?? null,
        phone: dbUser.qaTestPhone ?? null,
        otp: dbUser.qaTestOtp ?? null,
      };
    }
  } catch { /* credentials are optional */ }

  // ------------------------------------------------------- PLANNING LAYER
  // Load the AI planning key (optional) and any knowledge learned about this
  // app in prior runs, then build the planning session. The planner turns the
  // explorer from a blind graph-walker into a goal-driven agent, and lets this
  // run reuse everything the last run(s) discovered about the app.
  const appVersion = String(project.appVersionName ?? run.buildVersion ?? '');
  let planningApiKey: string | null = null;
  try {
    const dbUser = await User.findById(run.userId).lean<{ qaOpenRouterApiKey: string | null }>();
    planningApiKey = dbUser?.qaOpenRouterApiKey ?? null;
  } catch { /* optional */ }

  const loadedPrior = await KnowledgeBase.load(String(run.userId), packageName, appVersion)
    .catch(() => null);
  const priorKnowledge = loadedPrior ?? KnowledgeBase.emptyKnowledge(packageName, appVersion);
  const planner = new PlanningSession({
    prior: priorKnowledge,
    modulesSelected: plan.list().length || 1,
    apiKey: planningApiKey,
    log: emit,
  });
  await emit('info', `Planning layer engaged. ${planner.learning.describe()}`);
  await emit('info', `Goal queue: ${planner.goals.orderedUnmet().map((g) => g.kind).slice(0, 8).join(' → ')} …`);

  // Watchdog: if the pipeline wedges (a hung device/LLM call, an unexpected
  // stall) past the hard ceiling, finalize the run as failed so it can never
  // poll "running" forever. This only fires while the process is alive; a run
  // whose worker is killed outright is recovered by reconcileStaleRuns() on
  // the next read.
  let finalized = false;
  const watchdog = setTimeout(() => {
    void (async () => {
      if (finalized) return;
      try {
        const fresh = await QaTestRun.findById(runId);
        if (fresh && (fresh.status === 'running' || fresh.status === 'queued')) {
          fresh.status = 'failed';
          fresh.progress = 100;
          fresh.currentStep = 'Timed out';
          fresh.currentCase = null;
          fresh.errorMessage = `Run exceeded the ${Math.round(MAX_RUN_MS / 60_000)}-minute execution ceiling and was stopped automatically.`;
          fresh.completedAt = new Date();
          await fresh.save();
        }
      } catch { /* best-effort */ }
    })();
  }, MAX_RUN_MS + 30_000);
  // Don't keep the process alive just for the watchdog timer.
  (watchdog as unknown as { unref?: () => void }).unref?.();

  try {
  const screenshots = new ScreenshotManager(serial);
  const crashes = new CrashMonitor(serial, packageName);
  const reporter = new BugReporter({
    userId: run.userId,
    projectId: run.projectId,
    runId,
    runNumber: run.runNumber,
    device: profile,
    appVersion: project.appVersionName ?? run.buildVersion ?? '',
    packageName,
  });

  // ------------------------------------------------------- INSTALL / ATTACH
  if (attachMode) {
    run.currentStep = 'Attaching to installed app';
    run.progress = 4;
    await run.save();
    await emit('info', `Attaching to installed app ${packageName} (no upload — the app is already on the device).`);
  } else {
    run.currentStep = 'Installing APK on device';
    run.progress = 4;
    await run.save();
    await emit('info', `Installing ${project.sourceFileName ?? 'app.apk'} …`);
    const install = await installApk(serial, apkPath as string);
    await emit(install.ok ? 'info' : 'error', `adb install: ${install.message.slice(0, 300)}`);
    if (!install.ok) return fail(`Install failed: ${install.message.slice(0, 300)}`);
  }

  // Fresh-state handling.
  //  • Uploaded APK: always clear. A reinstall has no user data worth keeping,
  //    and stale state would otherwise hide the real first-run experience.
  //  • Installed app (attach mode): clear ONLY when the user explicitly opted
  //    in, because `pm clear` permanently destroys that app's real data
  //    (logins, photos, downloads) on someone's own device.
  await forceStop(serial, packageName);
  const wantsReset = attachMode ? Boolean(run.resetAppData) : true;
  if (wantsReset) {
    const cleared = await clearAppData(serial, packageName);
    await emit(cleared.ok ? 'info' : 'warn',
      cleared.ok
        ? `Cleared app data for ${packageName} — starting from a fresh state.`
        : `Could not clear app data (${cleared.message.slice(0, 120)}); continuing with existing state.`);
  } else {
    await emit('info', 'Keeping the app\'s existing data (reset not requested) — testing the app in its current state.');
  }

  // ------------------------------------------------------------- BASELINE
  await crashes.start();
  await forceStop(serial, packageName);

  const batteryStart = await sampleBattery(serial);
  run.currentStep = 'Launching app';
  run.progress = 10;
  await run.save();
  const launch = await startAppTimed(serial, packageName);
  await emit(launch.ok ? 'info' : 'warn', launch.ok ? `Launched ${packageName}.` : `Launch could not be confirmed for ${packageName}.`);
  if (!launch.ok) {
    // A crash right at launch is still a real, reportable result.
    const fresh = await crashes.poll();
    if (fresh.length > 0) {
      const shot = await screenshots.capture({ runId, screenName: 'Launch', reason: 'crash', step: fresh[0].title });
      await reporter.report({
        type: 'crash', module: 'Crash Detection', severity: 'critical',
        title: fresh[0].title, description: 'The app crashed during launch.',
        screenName: 'Launch', activity: launch.activity ?? '',
        stepsToReproduce: [`Install ${appName}`, `Launch ${packageName}`],
        expectedResult: 'The app launches successfully.', actualResult: 'The app crashed on launch.',
        evidence: fresh[0].evidence, rootCause: 'Unhandled exception during Application/Activity initialization.',
        suggestedFix: 'Fix the exception at the throwing frame in the attached trace.',
        stackTrace: fresh[0].stackTrace,
      }, shot);
    }
  }

  const memoryBaseline = await sampleMemory(serial, packageName);
  await screenshots.capture({ runId, screenName: 'Launch', reason: 'launch', step: launch.activity ?? '' });

  // ------------------------------------------------- AUTONOMOUS EXPLORATION
  const perScreenOutcomes: CheckOutcome[] = [];
  const explorationFindings: Finding[] = [];
  // First screen shown to the user in post-run module context.
  let primaryScreen = 'Home';

  // Finalizes a user-cancelled run: persist whatever was collected, force-stop
  // the app, and mark the run 'cancelled'. Called from cancellation points.
  const finalizeCancelled = async (outcomes: CheckOutcome[]) => {
    await emit('warn', 'Run cancelled by user — stopping and saving partial results.');
    try { if (outcomes.length) await persistOutcomes(runId, outcomes, reporter); } catch { /* best effort */ }
    try { await forceStop(serial, packageName); } catch { /* ignore */ }
    run.status = 'cancelled';
    run.progress = 100;
    run.currentStep = 'Cancelled';
    run.currentCase = null;
    run.completedAt = new Date();
    await run.save();
    await onRunCompleted(runId);
  };

  run.currentStep = 'Exploring application';
  run.progress = 15;
  await run.save();

  const exploration = await explore({
    serial,
    packageName,
    profile,
    maxSteps: MAX_EXPLORE_STEPS,
    deadlineAt: deadlineAt - 90_000, // leave time for post-run modules
    credentials,
    runId,
    screenshots,
    crashes,
    planner,
    shouldCancel: () => checkCancelled(),
    log: emit,
    progress: async (screen, step, screensFound) => {
      run.currentScreen = screen;
      run.currentStep = step;
      run.currentCase = screen;
      // Exploration occupies the 15–75% band of the progress bar.
      run.progress = Math.min(75, 15 + Math.round((screenshots.stats.captured / 40) * 60));
      run.currentFeature = `${screensFound} screen(s) · ${planner.goals.satisfiedCount()}/${planner.goals.all().length} goals · ${planner.featureMap.featureCount()} feature(s)`;
      await run.save();
    },
    onNewScreen: async (state: ScreenState) => {
      if (primaryScreen === 'Home' && state.kind !== 'splash') primaryScreen = state.label;
      // Per-screen modules audit each screen as it's discovered.
      if (plan.anyPerScreen) {
        const outcomes = runPerScreenModules(state, plan, packageName, profile.densityDpi);
        perScreenOutcomes.push(...outcomes);
      }
    },
    onCrash: async (state, findings) => {
      // Only file crash/ANR bugs for the modules that own them.
      for (const f of findings) {
        const wanted = (f.type === 'crash' && plan.reportsCrashes) || (f.type === 'anr' && plan.reportsAnr);
        if (wanted) explorationFindings.push(f);
      }
    },
  });

  await emit('info', `Exploration finished (${exploration.terminationReason}): ${exploration.graph.size} screen(s), ${exploration.steps} interaction(s), ${exploration.adsDismissed} ad(s) dismissed, ${exploration.permissionsHandled} permission(s) handled.`);
  await emit('debug', exploration.graph.summary());

  // Stop requested during exploration — finalize as cancelled and exit.
  if (exploration.terminationReason === 'cancelled') {
    await finalizeCancelled(perScreenOutcomes);
    return;
  }

  // File crashes gathered during exploration.
  for (const f of explorationFindings) {
    await reporter.report(f, f.screenshotDataUrl);
  }

  // ---------------------------------------------------------- POST MODULES
  run.currentStep = 'Running measurement modules';
  run.progress = 80;
  await run.save();

  const postCtx: PostRunContext = {
    serial,
    packageName,
    profile,
    screensVisited: exploration.graph.size,
    primaryScreen,
    memoryBaseline,
    batteryStart,
    runDurationMs: Date.now() - startedAt,
    log: emit,
  };
  const post = await runPostModules(plan, postCtx);

  // Stop requested after the measurement phase — save what we have and exit
  // before the long-running stress/compatibility modules.
  if (await checkCancelled(true)) {
    await finalizeCancelled([...perScreenOutcomes, ...post.outcomes]);
    return;
  }

  // ----------------------------------------------------- DEDICATED MODULES
  const dedicatedOutcomes: CheckOutcome[] = [];
  const dedicatedFindings: Finding[] = [];
  let monkeyEvents = 0;

  if (plan.has('compatibility')) {
    // Each dedicated module is a single blocking device operation lasting up
    // to roughly a minute, so a stop request can't interrupt one mid-flight —
    // but checking here bounds the worst-case delay to one module's duration
    // instead of the whole remaining pipeline (compatibility + monkey + AI).
    if (await checkCancelled(true)) {
      await finalizeCancelled([...perScreenOutcomes, ...post.outcomes, ...dedicatedOutcomes]);
      return;
    }
    run.currentStep = 'Compatibility (rotation) testing';
    run.progress = 88;
    await run.save();
    const compat = await runCompatibilityModule(serial, packageName, profile, primaryScreen, emit);
    dedicatedOutcomes.push(...compat.outcomes);
    dedicatedFindings.push(...compat.findings);
  }

  if (plan.has('monkey')) {
    if (await checkCancelled(true)) {
      await finalizeCancelled([...perScreenOutcomes, ...post.outcomes, ...dedicatedOutcomes]);
      return;
    }
    run.currentStep = 'Monkey stress testing';
    run.progress = 91;
    await run.save();
    const monkey = await runMonkeyModule(serial, packageName, 250, crashes, primaryScreen, emit);
    monkeyEvents = monkey.events;
    dedicatedOutcomes.push(...monkey.outcomes);
    dedicatedFindings.push(...monkey.findings);
    // Any crash the monkey produced is captured by the monitor below.
  }

  // Drain any crash signals produced by post/dedicated phases.
  const lateCrashes = await crashes.poll();
  for (const c of lateCrashes) {
    const wanted = (c.kind !== 'anr' && plan.reportsCrashes) || (c.kind === 'anr' && plan.reportsAnr);
    if (!wanted) continue;
    const shot = await screenshots.capture({ runId, screenName: primaryScreen, reason: 'crash', step: c.title });
    dedicatedFindings.push({
      type: c.kind === 'anr' ? 'anr' : 'crash',
      module: c.kind === 'anr' ? 'ANR Detection' : 'Crash Detection',
      severity: 'critical', title: c.title,
      description: 'Captured from logcat during the measurement/stress phase.',
      screenName: primaryScreen, activity: '',
      stepsToReproduce: [`Launch ${packageName}`, 'Exercise the app under stress'],
      expectedResult: 'The app remains stable.', actualResult: c.kind === 'anr' ? 'ANR occurred.' : 'The app crashed.',
      evidence: c.evidence, rootCause: 'See attached trace.', suggestedFix: 'Address the throwing frame / main-thread block.',
      stackTrace: c.stackTrace, screenshotDataUrl: shot,
    });
  }

  if (plan.has('ai_exploratory')) {
    if (await checkCancelled(true)) {
      await finalizeCancelled([...perScreenOutcomes, ...post.outcomes, ...dedicatedOutcomes]);
      return;
    }
    run.currentStep = 'AI exploratory analysis';
    run.progress = 94;
    await run.save();
    await runAiExploratory(exploration.graph, planningApiKey, emit);
  }

  // One last check before compiling and persisting the final report — a stop
  // requested during AI exploratory analysis (network-bound, not device-bound)
  // should still land as 'cancelled' rather than a full 'passed/failed' report.
  if (await checkCancelled(true)) {
    await finalizeCancelled([...perScreenOutcomes, ...post.outcomes, ...dedicatedOutcomes]);
    return;
  }

  // ---------------------------------------------------------- PERSIST ALL
  run.currentStep = 'Compiling report';
  run.progress = 96;
  await run.save();

  const allOutcomes = [...perScreenOutcomes, ...post.outcomes, ...dedicatedOutcomes];
  const totals = await persistOutcomes(runId, allOutcomes, reporter);

  // File remaining post/dedicated findings not already tied to an outcome row.
  const alreadyFiledFrom = new Set(allOutcomes.map((o) => o.finding).filter(Boolean));
  for (const f of [...post.findings, ...dedicatedFindings]) {
    if (!alreadyFiledFrom.has(f)) await reporter.report(f, f.screenshotDataUrl);
  }

  // ----------------------------------------- EVIDENCE-BASED MODULE COMPLETION
  // Modules complete only when the evidence their objectives require was
  // actually collected — never merely because their executor returned.
  const ledger: EvidenceLedger = newLedger();
  ledger.totalScreenshots = screenshots.stats.captured;
  ledger.screensVisited = exploration.graph.size;
  ledger.interactionsExecuted = exploration.steps;
  ledger.logcatRuntimeMs = Date.now() - startedAt;
  ledger.monkeyEvents = monkeyEvents;
  ledger.completedWorkflows = planner.featureMap.completeWorkflowCount();
  ledger.coldStartMeasured = post.outcomes.some((o) => o.testCaseId.startsWith('TC-PERF') && /cold start/i.test(o.name));
  ledger.frameStatsMeasured = post.outcomes.some((o) => o.testCaseId.startsWith('TC-PERF') && /frame/i.test(o.name));
  ledger.memorySampled = post.outcomes.some((o) => o.testCaseId.startsWith('TC-MEM'));
  ledger.batterySampled = post.outcomes.some((o) => o.testCaseId.startsWith('TC-BAT'));
  ledger.networkAnalysed = post.outcomes.some((o) => o.testCaseId.startsWith('TC-NET'));
  ledger.securityDumpInspected = post.outcomes.some((o) => o.testCaseId.startsWith('TC-SEC'));
  ledger.rotationObserved = dedicatedOutcomes.some((o) => o.testCaseId.startsWith('TC-COMPAT'));
  // Distinct screens audited per per-screen module bucket (from real check rows).
  const bucketOf: Record<string, string> = { FUNC: 'functional', UI: 'ui', A11Y: 'a11y', L10N: 'l10n', SMOKE: 'smoke' };
  const auditedScreens: Record<string, Set<string>> = {};
  for (const o of perScreenOutcomes) {
    const prefix = o.testCaseId.split('-')[1] ?? '';
    const bucket = bucketOf[prefix];
    if (!bucket) continue;
    (auditedScreens[bucket] ??= new Set()).add(o.screen);
  }
  for (const [bucket, set] of Object.entries(auditedScreens)) ledger.screensAudited[bucket] = set.size;

  const moduleAssessments = assessModules(plan.list(), ledger);
  const modulesComplete = completeCount(moduleAssessments);
  planner.setModuleCompletion(modulesComplete);
  for (const a of moduleAssessments) {
    if (a.complete) {
      await emit('info', `Module complete: ${a.key} — ${a.met}/${a.total} objective(s) evidenced.`);
    } else {
      await emit('warn', `Module INCOMPLETE (insufficient evidence): ${a.key} — met ${a.met}/${a.total}; missing: ${a.missing.join('; ')}.`);
    }
  }

  // ------------------------------------------------------ COVERAGE + KNOWLEDGE
  const coverageSnap = planner.snapshot(exploration.graph);
  await emit('info', CoverageEngine.format(coverageSnap));
  await emit('info', planner.summary());

  const knowledgeMetrics: Record<string, unknown> = {
    lastTerminationReason: exploration.terminationReason,
    steps: exploration.steps,
    screensVisited: exploration.graph.size,
    modulesComplete: `${modulesComplete}/${plan.list().length}`,
    aiPlannerCalls: planner.ai.callsMade,
  };
  try {
    await KnowledgeBase.save({
      userId: String(run.userId),
      packageName,
      appName,
      appVersion,
      runId,
      graph: exploration.graph,
      features: planner.featureMap,
      coverage: coverageSnap,
      productiveActions: planner.productiveActions(),
      interactionSequences: planner.interactionSequences(),
      deadEndActions: planner.deadEndActions(),
      unstableScreens: planner.unstableScreens(),
      crashLocations: planner.crashLocations(),
      adsPaywalls: planner.adsPaywalls(),
      metrics: knowledgeMetrics,
      prior: priorKnowledge,
      at: new Date(),
    });
    await emit('info', `Application knowledge persisted for "${packageName}" (${appVersion || 'unknown version'}) — future runs will reuse it.`);
  } catch (e) {
    await emit('warn', `Could not persist application knowledge: ${(e as Error)?.message?.slice(0, 120)}`);
  }

  // Record coverage limitations honestly in the run log.
  for (const limit of exploration.coverageLimits) await emit('warn', `Coverage limit: ${limit}`);
  for (const note of post.notes) await emit('info', note);
  if (reporter.duplicatesSuppressed > 0) {
    await emit('info', `${reporter.duplicatesSuppressed} duplicate finding occurrence(s) were consolidated.`);
  }

  // ------------------------------------------------------------- CLEANUP
  const finalShot = await screenshots.capture({ runId, screenName: primaryScreen, reason: 'final' });
  void finalShot;
  await forceStop(serial, packageName);
  await emit('info', `Uninstall skipped to allow manual re-inspection; app left installed. Force-stopped ${packageName}.`);

  // -------------------------------------------------------------- VERDICT
  const severityCounts = reporter.severityCounts;
  run.status = computeStatus(severityCounts, reporter.count);
  run.progress = 100;
  run.currentStep = 'Completed';
  run.currentCase = null;
  run.totalCases = totals.total;
  run.passedCases = totals.passed;
  run.failedCases = totals.failed;
  run.performanceScore = computePerformanceScore(severityCounts);
  run.completedAt = new Date();
  await run.save();

  await emit('info',
    `Run completed: ${run.status.toUpperCase()} — ${totals.passed}/${totals.total} checks passed, `
    + `${reporter.count} bug(s) [crit ${severityCounts.critical}, high ${severityCounts.high}, med ${severityCounts.medium}, low ${severityCounts.low}], `
    + `${screenshots.stats.captured} real screenshot(s), ${exploration.graph.size} screen(s) explored.`);
  await onRunCompleted(runId);

  } catch (err) {
    // Any unexpected throw in the pipeline must still leave the run in a
    // terminal state — otherwise it polls "running" forever.
    const message = err instanceof Error ? err.message : String(err);
    try { await emit('error', `Run aborted: ${message.slice(0, 300)}`); } catch { /* ignore */ }
    try {
      const fresh = await QaTestRun.findById(runId);
      if (fresh && fresh.status !== 'passed' && fresh.status !== 'partial') {
        fresh.status = 'failed';
        fresh.progress = 100;
        fresh.currentStep = 'Failed';
        fresh.currentCase = null;
        fresh.errorMessage = `Execution failed: ${message.slice(0, 300)}`;
        fresh.completedAt = new Date();
        await fresh.save();
      }
    } catch { /* best-effort */ }
  } finally {
    finalized = true;
    clearTimeout(watchdog);
  }
}
