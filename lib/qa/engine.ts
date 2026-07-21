import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QA_MODULE_BY_KEY, randomScreen } from '@/lib/qa/modules';
import { generateQaAnalysis, parseJsonLoose } from '@/lib/qa/ai-provider';
import { fallbackBug } from '@/lib/qa/bug-bank';
import { placeholderScreenshot } from '@/lib/qa/screenshot';
import { SIMULATED_DEVICE_NAMES } from '@/lib/qa/device-adapter';
import type { QaBugType, QaSeverity } from '@/lib/types';

const CASES_PER_MODULE = 3;
const STEP_DELAY_MS = 550;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function log(runId: string, source: 'automation' | 'logcat' | 'api' | 'error' | 'crash', level: 'debug' | 'info' | 'warn' | 'error', message: string) {
  await QaLogEntry.create({ runId, source, level, message });
}

/** "Pixel 7 (Emulator, Android 14)" -> "Android 14"; "Chrome 124 (Web, Desktop)" -> "Desktop". */
function parseOsVersion(device: string): string {
  const match = device.match(/\(([^,]+),\s*([^)]+)\)/);
  return match?.[2] ?? device;
}

interface AiCaseResult {
  name: string;
  screen: string;
  result: 'pass' | 'fail';
}
interface AiBugResult {
  type: string;
  severity: string;
  title: string;
  description: string;
  expectedResult: string;
  actualResult: string;
  aiRootCause: string;
  suggestedFix: string;
}
interface AiModuleAnalysis {
  cases: AiCaseResult[];
  bugs: AiBugResult[];
}

const VALID_TYPES = new Set(['functional', 'ui', 'api', 'security', 'performance', 'memory', 'battery', 'network', 'accessibility', 'compatibility', 'crash', 'anr']);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

async function analyzeModuleWithAi(
  apiKey: string | null,
  appName: string,
  platform: string,
  moduleLabel: string,
  bugTypes: string[],
): Promise<AiModuleAnalysis | null> {
  const systemPrompt = `You are an AI QA test executor. Given an application and a testing module, simulate running ${CASES_PER_MODULE} realistic test cases for that module and report results as JSON. Only report a bug for cases that fail. Respond ONLY with minified JSON: {"cases":[{"name":string,"screen":string,"result":"pass"|"fail"}],"bugs":[{"type":one of [${bugTypes.map((t) => `"${t}"`).join(',')}],"severity":"critical"|"high"|"medium"|"low","title":string,"description":string,"expectedResult":string,"actualResult":string,"aiRootCause":string,"suggestedFix":string}]}. Keep 0-2 bugs, only for failed cases. Be realistic and specific to the app.`;
  const userPrompt = `App: "${appName}" (${platform}). Testing module: ${moduleLabel}. Simulate execution and report results as JSON.`;

  try {
    const content = await generateQaAnalysis(apiKey, { systemPrompt, userPrompt, maxTokens: 900 });
    const parsed = parseJsonLoose(content);
    if (!parsed || !Array.isArray(parsed.cases)) return null;
    return parsed as unknown as AiModuleAnalysis;
  } catch {
    return null;
  }
}

export async function runQaTestExecution(runId: string, apiKey: string | null) {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId);
  if (!run) return;
  const project = await QaProject.findById(run.projectId).lean();
  if (!project) return;

  run.status = 'running';
  run.startedAt = new Date();
  run.estimatedSeconds = run.modules.length * CASES_PER_MODULE * (STEP_DELAY_MS / 1000) * 1.4;
  await run.save();

  await log(runId, 'automation', 'info', `Starting test run for "${(project as any).name}" across ${run.modules.length} module(s).`);

  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  let bugSeq = 0;
  const bugTypeCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };

  for (let mi = 0; mi < run.modules.length; mi++) {
    const moduleKey = run.modules[mi];
    const spec = QA_MODULE_BY_KEY.get(moduleKey);
    const moduleLabel = spec?.label ?? moduleKey;
    const device = SIMULATED_DEVICE_NAMES[mi % SIMULATED_DEVICE_NAMES.length];
    const osVersion = parseOsVersion(device);

    run.currentSuite = moduleLabel;
    run.currentFeature = moduleLabel;
    run.currentDevice = device;
    run.currentStep = 'Initializing suite';
    run.progress = Math.round((mi / run.modules.length) * 100);
    await run.save();
    await log(runId, 'automation', 'info', `[${moduleLabel}] Suite started on ${device}.`);
    await log(runId, 'logcat', 'debug', `Attaching to ${device}...`);
    await sleep(STEP_DELAY_MS);

    const analysis = await analyzeModuleWithAi(apiKey, (project as any).name, (project as any).platform, moduleLabel, spec?.bugTypes ?? ['functional']);

    const cases: AiCaseResult[] = analysis?.cases?.length
      ? analysis.cases.slice(0, CASES_PER_MODULE)
      : Array.from({ length: CASES_PER_MODULE }, (_, i) => ({
        name: `${moduleLabel} case ${i + 1}`,
        screen: randomScreen(),
        result: (Math.random() < 0.75 ? 'pass' : 'fail') as 'pass' | 'fail',
      }));

    const caseRecords: Array<{ testCaseId: string; failedStepNumber: number | null; caseId: string }> = [];

    for (let ci = 0; ci < cases.length; ci++) {
      const c = cases[ci];
      totalCases += 1;
      const testCaseId = `TC-${moduleKey}-${ci + 1}`;
      const failedStepNumber = c.result === 'fail' ? Math.floor(Math.random() * 5) + 1 : null;

      run.currentCase = c.name;
      run.currentScreen = c.screen;
      run.currentStep = 'Executing';
      await run.save();
      await log(runId, 'automation', 'info', `[${moduleLabel}] Running "${c.name}" on screen "${c.screen}"...`);
      await QaScreenshot.create({
        runId, screenName: c.screen, testStep: c.name, imageDataUrl: placeholderScreenshot(c.screen, moduleLabel),
      });
      await sleep(STEP_DELAY_MS);

      const caseDoc = await QaTestCaseResult.create({
        runId, testCaseId, name: c.name, module: moduleLabel, screen: c.screen, result: c.result, failedStepNumber,
      });
      caseRecords.push({ testCaseId, failedStepNumber, caseId: String(caseDoc._id) });

      if (c.result === 'fail') {
        failedCases += 1;
        await log(runId, 'error', 'error', `[${moduleLabel}] "${c.name}" FAILED (step ${failedStepNumber}) on "${c.screen}".`);
      } else {
        passedCases += 1;
        await log(runId, 'automation', 'info', `[${moduleLabel}] "${c.name}" passed.`);
      }
    }

    const failedCaseRecords = caseRecords.filter((_, i) => cases[i].result === 'fail');

    const aiBugs = (analysis?.bugs ?? []).filter((b) => VALID_TYPES.has(b.type) && VALID_SEVERITIES.has(b.severity));
    const bugsToCreate = aiBugs.length > 0
      ? aiBugs.map((b) => ({
        type: b.type as QaBugType,
        severity: b.severity as QaSeverity,
        title: b.title,
        description: b.description,
        expectedResult: b.expectedResult,
        actualResult: b.actualResult,
        aiRootCause: b.aiRootCause,
        suggestedFix: b.suggestedFix,
        screenName: cases[0]?.screen ?? randomScreen(),
      }))
      : (failedCases > 0 && !analysis
        ? [fallbackBug((spec?.bugTypes[0] ?? 'functional') as QaBugType, cases.find((c) => c.result === 'fail')?.screen ?? randomScreen(), moduleLabel)]
        : []);

    for (let bi = 0; bi < bugsToCreate.length; bi++) {
      const b = bugsToCreate[bi];
      bugSeq += 1;
      const linkedCase = failedCaseRecords[bi] ?? failedCaseRecords[0] ?? null;
      const bugNumber = `BUG-${run.runNumber}-${String(bugSeq).padStart(3, '0')}`;
      const isApiBug = b.type === 'api';

      const bug = await QaBug.create({
        userId: run.userId,
        projectId: run.projectId,
        runId,
        type: b.type,
        module: moduleLabel,
        feature: moduleLabel,
        severity: b.severity,
        priority: b.severity === 'critical' ? 'p1' : b.severity === 'high' ? 'p1' : b.severity === 'medium' ? 'p2' : 'p3',
        bugNumber,
        testCaseId: linkedCase?.testCaseId ?? '',
        failedStepNumber: linkedCase?.failedStepNumber ?? null,
        title: b.title,
        description: b.description,
        screenName: b.screenName,
        stepsToReproduce: [`Open ${(project as any).name}`, `Navigate to ${b.screenName}`, `Perform the ${moduleLabel.toLowerCase()} scenario`],
        expectedResult: b.expectedResult,
        actualResult: b.actualResult,
        screenshotDataUrl: placeholderScreenshot(b.screenName, moduleLabel),
        logs: `[${moduleLabel}] Failure captured on ${device} during automated execution.`,
        stackTrace: (b as any).stackTrace ?? (b.type === 'crash' || b.type === 'anr' ? 'Stack trace unavailable in simulated run.' : null),
        apiRequest: isApiBug ? `GET /api/${moduleKey}\nHost: ${(project as any).sourceRef}` : null,
        apiResponse: isApiBug ? '{"error":"Internal Server Error","status":500}' : null,
        deviceInfo: device,
        osVersion,
        appVersion: run.buildVersion,
        aiRootCause: b.aiRootCause,
        suggestedFix: b.suggestedFix,
      });

      if (linkedCase) {
        await QaTestCaseResult.findByIdAndUpdate(linkedCase.caseId, { bugId: bug._id });
      }

      bugTypeCounts[b.type] = (bugTypeCounts[b.type] ?? 0) + 1;
      severityCounts[b.severity] = (severityCounts[b.severity] ?? 0) + 1;
      await log(runId, b.type === 'crash' ? 'crash' : b.type === 'api' ? 'api' : 'error', 'error', `[${moduleLabel}] Bug detected: ${bugNumber} — ${b.title}`);
    }

    await log(runId, 'automation', 'info', `[${moduleLabel}] Suite completed.`);
  }

  const criticalOrHigh = severityCounts.critical + severityCounts.high;
  const totalBugs = bugSeq;
  const performanceScore = Math.max(35, 100 - (bugTypeCounts.performance ?? 0) * 12 - criticalOrHigh * 8);

  run.status = criticalOrHigh > 0 ? 'failed' : totalBugs > 0 ? 'partial' : 'passed';
  run.progress = 100;
  run.currentStep = 'Completed';
  run.currentCase = null;
  run.totalCases = totalCases;
  run.passedCases = passedCases;
  run.failedCases = failedCases;
  run.performanceScore = performanceScore;
  run.completedAt = new Date();
  await run.save();

  await log(runId, 'automation', 'info', `Run completed: ${run.status.toUpperCase()} — ${passedCases}/${totalCases} cases passed.`);
}
