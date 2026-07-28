import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { notifyDevelopers } from '@/lib/issue-boards/notify';
import {
  buildBoardName, executionLabel, CATEGORY_LABEL, MODULE_TYPE_LABEL,
  type BoardStatus, type IssueCategory, type IssueStatus,
} from '@/lib/issue-boards/constants';

/**
 * AI Issue Boards — automatic board and issue-card creation.
 *
 * This module is the only writer of boards/cards derived from an execution.
 * Everything here is idempotent and additive:
 *
 *   • one board per execution, keyed by the unique `runId`;
 *   • one card per *source artefact* (a QA bug, a failed test case, or a failed
 *     test step), keyed by `sourceKey` unique per board;
 *   • a re-sync refreshes only the QA/AI evidence on an existing card and never
 *     touches its column, assignee, comments, or activity history.
 *
 * It never mutates QA runs, bugs, test cases, or any other existing record.
 */

/** Statuses that mean "this execution is finished". */
const TERMINAL_RUN_STATUSES = new Set(['passed', 'failed', 'partial', 'cancelled']);

/** Evidence caps — cards live in a single document, so keep them bounded. */
const MAX_SCREENSHOTS = 4;
const MAX_LOG_CHARS = 8000;

function truncate(value: unknown, max = MAX_LOG_CHARS): string {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}\n… truncated (${s.length - max} more characters)` : s;
}

/** Bug types map 1:1 onto issue categories; unknown types fall back to functional. */
function categoryForBug(type: string): IssueCategory {
  const known: IssueCategory[] = [
    'functional', 'ui', 'ux', 'api', 'security', 'performance', 'memory', 'battery',
    'network', 'accessibility', 'compatibility', 'crash', 'anr', 'ai_detected',
  ];
  return (known.includes(type as IssueCategory) ? type : 'functional') as IssueCategory;
}

/**
 * Facet labels. The category stays truthful to what execution actually proved;
 * labels carry the extra facets the board filters on — UX for the
 * experience-affecting classes, "AI Detected" for anything the automated
 * cross-cutting analyser raised rather than an explicit test case.
 */
function labelsFor(opts: {
  category: IssueCategory;
  module: string;
  aiDetected: boolean;
  fromFailedStep: boolean;
}): string[] {
  const labels = [CATEGORY_LABEL[opts.category] ?? 'Functional'];
  if (['ui', 'accessibility', 'compatibility', 'performance'].includes(opts.category)) labels.push('UX');
  if (opts.module) labels.push(opts.module);
  if (opts.aiDetected) labels.push('AI Detected');
  if (opts.fromFailedStep) labels.push('Failed Step');
  return Array.from(new Set(labels.filter(Boolean))).slice(0, 6);
}

function severityToPriority(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'p1';
  if (severity === 'medium') return 'p2';
  return 'p3';
}

function normalizeSeverity(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase();
  return ['critical', 'high', 'medium', 'low'].includes(s) ? s : 'medium';
}

function normalizePriority(raw: unknown, severity: string): string {
  const p = String(raw ?? '').toLowerCase();
  return ['p1', 'p2', 'p3', 'p4'].includes(p) ? p : severityToPriority(severity);
}

/** The shape the analyser produces before it becomes a card. */
interface IssueSeed {
  sourceKey: string;
  bugId: string | null;
  title: string;
  description: string;
  category: IssueCategory;
  severity: string;
  priority: string;
  labels: string[];
  testCaseId: string;
  module: string;
  feature: string;
  screenName: string;
  failedStepNumber: number | null;
  failedStepText: string;
  expectedResult: string;
  actualResult: string;
  stepsToReproduce: string[];
  screenshots: string[];
  screenRecordingUrl: string | null;
  logs: string;
  stackTrace: string | null;
  apiRequest: string | null;
  apiResponse: string | null;
  aiRootCause: string;
  aiSuggestedFix: string;
}

/**
 * Reads the execution report and returns one seed per detected issue.
 *
 * Precedence matters for de-duplication: a QA bug is the richest record of a
 * failure, so a failed case or step that already produced a bug does NOT get a
 * second card. Blocked cases are deliberately excluded — nothing was proven
 * broken, so raising a developer issue for them would be noise (the board
 * summary still reports the blocked count).
 */
async function analyseExecution(run: any): Promise<IssueSeed[]> {
  const runId = run._id;
  const seeds: IssueSeed[] = [];

  const bugs = await QaBug.find({ runId }).sort({ createdAt: 1 }).lean<any[]>();

  // Every test case id that already has a bug — used to suppress duplicates.
  const casesWithBug = new Set(bugs.map((b) => String(b.testCaseId || '')).filter(Boolean));
  // Every (testCaseId, stepNumber) a bug already covers.
  const stepsWithBug = new Set(
    bugs.filter((b) => b.testCaseId && b.failedStepNumber != null)
      .map((b) => `${b.testCaseId}#${b.failedStepNumber}`),
  );

  // ---- 1. One card per QA bug (functional, UI, API, security, performance,
  //         crash, ANR, accessibility, network, compatibility, …). ----
  for (const bug of bugs) {
    const severity = normalizeSeverity(bug.severity);
    const category = categoryForBug(String(bug.type));
    const aiDetected = String(bug.module ?? '').toLowerCase().includes('cross-cutting')
      || String(bug.feature ?? '').toLowerCase().includes('automated audit');
    seeds.push({
      sourceKey: `bug:${String(bug._id)}`,
      bugId: String(bug._id),
      title: bug.title,
      description: bug.description ?? '',
      category,
      severity,
      priority: normalizePriority(bug.priority, severity),
      labels: labelsFor({ category, module: bug.module ?? '', aiDetected, fromFailedStep: bug.failedStepNumber != null }),
      testCaseId: bug.testCaseId ?? '',
      module: bug.module ?? '',
      feature: bug.feature ?? '',
      screenName: bug.screenName ?? '',
      failedStepNumber: bug.failedStepNumber ?? null,
      failedStepText: '',
      expectedResult: bug.expectedResult ?? '',
      actualResult: bug.actualResult ?? '',
      stepsToReproduce: Array.isArray(bug.stepsToReproduce) ? bug.stepsToReproduce : [],
      screenshots: bug.screenshotDataUrl ? [bug.screenshotDataUrl] : [],
      screenRecordingUrl: null,
      logs: truncate(bug.logs),
      stackTrace: bug.stackTrace ? truncate(bug.stackTrace, 4000) : null,
      apiRequest: bug.apiRequest ? truncate(bug.apiRequest, 4000) : null,
      apiResponse: bug.apiResponse ? truncate(bug.apiResponse, 4000) : null,
      aiRootCause: bug.aiRootCause ?? '',
      aiSuggestedFix: bug.suggestedFix ?? '',
    });
  }

  if (run.sourceMode === 'uploaded') {
    const cases = await QaUploadedTestCase.find({ runId }).sort({ order: 1 }).lean<any[]>();

    for (const tc of cases) {
      const severity = normalizeSeverity(tc.severity);
      const priority = normalizePriority(tc.priority, severity);
      const steps: any[] = Array.isArray(tc.stepResults) ? tc.stepResults : [];
      const primaryStepNumber = tc.failedStepIndex != null ? tc.failedStepIndex + 1 : null;

      // ---- 2. Failed test case with no bug attached. ----
      if (tc.result === 'fail' && !tc.bugId && !casesWithBug.has(String(tc.testCaseId))) {
        const failedStep = primaryStepNumber != null ? steps.find((s) => s.stepNumber === primaryStepNumber) : null;
        seeds.push({
          sourceKey: `case:${String(tc._id)}`,
          bugId: null,
          title: `${tc.testCaseId}: ${tc.scenario} — expected result not achieved`,
          description: `Execution of this test case diverged from the sheet's expected result${primaryStepNumber ? ` at step ${primaryStepNumber}` : ''}. ${tc.actualResult ?? ''}`.trim(),
          category: 'functional',
          severity,
          priority,
          labels: labelsFor({ category: 'functional', module: tc.module ?? '', aiDetected: false, fromFailedStep: primaryStepNumber != null }),
          testCaseId: tc.testCaseId ?? '',
          module: tc.module ?? '',
          feature: tc.feature ?? '',
          screenName: tc.screenName ?? '',
          failedStepNumber: primaryStepNumber,
          failedStepText: failedStep?.instruction ?? '',
          expectedResult: tc.expectedResult ?? '',
          actualResult: tc.actualResult ?? '',
          stepsToReproduce: Array.isArray(tc.steps) && tc.steps.length > 0 ? tc.steps : [tc.scenario],
          screenshots: steps.map((s) => s.screenshotDataUrl).filter(Boolean).slice(-MAX_SCREENSHOTS),
          screenRecordingUrl: null,
          logs: truncate(steps.map((s) => `Step ${s.stepNumber} [${s.status}] ${s.instruction} → ${s.actual}`).join('\n')),
          stackTrace: null,
          apiRequest: null,
          apiResponse: null,
          aiRootCause: '',
          aiSuggestedFix: '',
        });
      }

      // ---- 3. Any *additional* failed step inside the case. The step that a
      //         bug or the case-level card already represents is skipped, so a
      //         single failure never yields two cards. ----
      for (const step of steps) {
        if (step.status !== 'fail') continue;
        if (step.stepNumber === primaryStepNumber) continue;
        if (stepsWithBug.has(`${tc.testCaseId}#${step.stepNumber}`)) continue;
        seeds.push({
          sourceKey: `step:${String(tc._id)}:${step.stepNumber}`,
          bugId: null,
          title: `${tc.testCaseId} — step ${step.stepNumber} failed: ${String(step.instruction || '').slice(0, 90)}`,
          description: `Step ${step.stepNumber} of test case ${tc.testCaseId} failed during execution. Observed: ${step.actual ?? '—'}`,
          category: 'functional',
          severity,
          priority,
          labels: labelsFor({ category: 'functional', module: tc.module ?? '', aiDetected: false, fromFailedStep: true }),
          testCaseId: tc.testCaseId ?? '',
          module: tc.module ?? '',
          feature: tc.feature ?? '',
          screenName: tc.screenName ?? '',
          failedStepNumber: step.stepNumber,
          failedStepText: step.instruction ?? '',
          expectedResult: step.assertion ? `Assertion: ${step.assertion}` : (tc.expectedResult ?? ''),
          actualResult: step.actual ?? '',
          stepsToReproduce: Array.isArray(tc.steps) && tc.steps.length > 0 ? tc.steps : [tc.scenario],
          screenshots: step.screenshotDataUrl ? [step.screenshotDataUrl] : [],
          screenRecordingUrl: null,
          logs: truncate(`URL: ${step.url ?? '—'}\nStep ${step.stepNumber} [${step.status}] ${step.instruction} → ${step.actual}`),
          stackTrace: null,
          apiRequest: null,
          apiResponse: null,
          aiRootCause: '',
          aiSuggestedFix: '',
        });
      }
    }
  } else {
    // ---- 4. Catalog / web executions: failed case results with no bug. ----
    const results = await QaTestCaseResult.find({ runId, result: 'fail' }).lean<any[]>();
    for (const r of results) {
      if (r.bugId) continue;
      if (casesWithBug.has(String(r.testCaseId))) continue;
      seeds.push({
        sourceKey: `case-result:${String(r._id)}`,
        bugId: null,
        title: `${r.testCaseId}: ${r.name} — failed`,
        description: `Automated execution reported this test case as FAILED on screen "${r.screen || '—'}".`,
        category: 'functional',
        severity: 'medium',
        priority: 'p2',
        labels: labelsFor({ category: 'functional', module: r.module ?? '', aiDetected: false, fromFailedStep: r.failedStepNumber != null }),
        testCaseId: r.testCaseId ?? '',
        module: r.module ?? '',
        feature: r.module ?? '',
        screenName: r.screen ?? '',
        failedStepNumber: r.failedStepNumber ?? null,
        failedStepText: '',
        expectedResult: '',
        actualResult: 'Test case reported FAILED by the execution engine.',
        stepsToReproduce: [`Run the ${r.module} suite`, `Open ${r.screen || 'the affected screen'}`, `Execute "${r.name}"`],
        screenshots: [],
        screenRecordingUrl: null,
        logs: '',
        stackTrace: null,
        apiRequest: null,
        apiResponse: null,
        aiRootCause: '',
        aiSuggestedFix: '',
      });
    }
  }

  return seeds;
}

/** Highest severity first, then priority — the board opens with what matters. */
function seedRank(seed: IssueSeed): number {
  const sev = ['critical', 'high', 'medium', 'low'].indexOf(seed.severity);
  const pri = ['p1', 'p2', 'p3', 'p4'].indexOf(seed.priority);
  return (sev < 0 ? 9 : sev) * 10 + (pri < 0 ? 9 : pri);
}

/**
 * Recomputes a board's rollup counters and status from its cards.
 * Safe to call after any card mutation.
 */
export async function recomputeBoardRollups(boardId: string) {
  const cards = await QaIssueCard.find({ boardId }).select(
    'status severity priority assignedToName',
  ).lean<any[]>();

  const count = (s: IssueStatus) => cards.filter((c) => c.status === s).length;
  const newCount = count('new');
  const assigned = count('assigned');
  const inProgress = count('in_progress');
  const readyForQa = count('ready_for_qa');
  const reopened = count('reopened');
  const closed = count('closed');

  let status: BoardStatus;
  if (inProgress > 0) status = 'in_progress';
  else if (newCount + assigned + reopened > 0) status = 'open';
  else if (readyForQa > 0) status = 'ready_for_qa';
  else status = 'resolved';

  await QaIssueBoard.findByIdAndUpdate(boardId, {
    totalIssues: cards.length,
    openIssues: newCount + assigned + reopened,
    assignedIssues: assigned,
    inProgressIssues: inProgress,
    readyForQaIssues: readyForQa,
    reopenedIssues: reopened,
    closedIssues: closed,
    criticalIssues: cards.filter((c) => c.severity === 'critical').length,
    highPriorityIssues: cards.filter((c) => c.priority === 'p1' || c.severity === 'high').length,
    assignedDevelopers: Array.from(new Set(cards.map((c) => c.assignedToName).filter(Boolean))),
    severities: Array.from(new Set(cards.map((c) => c.severity).filter(Boolean))),
    priorities: Array.from(new Set(cards.map((c) => c.priority).filter(Boolean))),
    status,
    lastActivityAt: new Date(),
  });
}

export interface SyncResult {
  boardId: string;
  boardName: string;
  created: boolean;
  cardsCreated: number;
  totalIssues: number;
}

/**
 * Creates (or refreshes) the board for one completed execution.
 * Returns null when the run is not finished yet, or no longer exists.
 */
export async function syncIssueBoardForRun(runId: string): Promise<SyncResult | null> {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId).lean<any>();
  if (!run) return null;
  if (!TERMINAL_RUN_STATUSES.has(String(run.status))) return null;

  const project = await QaProject.findById(run.projectId).lean<any>();
  if (!project) return null;

  const projectName = String(project.name ?? 'Unknown Project');
  const applicationName = String(project.appDisplayName || project.name || 'Application');
  const boardName = buildBoardName(projectName, applicationName, run.runNumber);

  const snapshot = {
    ownerUserId: run.userId,
    runId: run._id,
    projectId: project._id,
    boardName,
    projectName,
    applicationName,
    executionNumber: run.runNumber,
    executionId: executionLabel(run.runNumber),
    moduleType: run.sourceMode === 'uploaded' ? 'uploaded' : 'catalog',
    platform: String(project.platform ?? ''),
    deviceName: String(run.currentDevice ?? ''),
    buildVersion: String(project.appVersionName || run.buildVersion || ''),
    executedByName: String(run.executedByName ?? ''),
    executedAt: run.startedAt ?? run.createdAt ?? null,
    runStatus: String(run.status),
    totalCases: run.totalCases ?? 0,
    passedCases: run.passedCases ?? 0,
    failedCases: run.failedCases ?? 0,
    blockedCases: run.blockedCases ?? 0,
  };

  // Idempotent by construction: `runId` is unique, so a concurrent second
  // completion hook updates the same board instead of adding another.
  const existing = await QaIssueBoard.findOne({ runId: run._id });
  const board = existing
    ? Object.assign(existing, snapshot)
    : new QaIssueBoard(snapshot);
  await board.save();
  const created = !existing;

  // ---- Issue cards ----
  const seeds = (await analyseExecution(run)).sort((a, b) => seedRank(a) - seedRank(b));
  const existingCards = await QaIssueCard.find({ boardId: board._id }).lean<any[]>();
  const bySourceKey = new Map(existingCards.map((c) => [c.sourceKey, c]));

  let seq = existingCards.length;
  let cardsCreated = 0;

  for (const seed of seeds) {
    const prior = bySourceKey.get(seed.sourceKey);

    if (prior) {
      // Refresh only the evidence — never the workflow state. The same card is
      // always reused, so its column, assignee, comments, and activity survive.
      await QaIssueCard.updateOne({ _id: prior._id }, {
        $set: {
          title: seed.title,
          description: seed.description,
          expectedResult: seed.expectedResult,
          actualResult: seed.actualResult,
          stepsToReproduce: seed.stepsToReproduce,
          screenshots: seed.screenshots.slice(0, MAX_SCREENSHOTS),
          logs: seed.logs,
          stackTrace: seed.stackTrace,
          apiRequest: seed.apiRequest,
          apiResponse: seed.apiResponse,
          aiRootCause: seed.aiRootCause,
          aiSuggestedFix: seed.aiSuggestedFix,
          attachmentCount: seed.screenshots.slice(0, MAX_SCREENSHOTS).length
            + (seed.screenRecordingUrl ? 1 : 0)
            + (Array.isArray(prior.attachments) ? prior.attachments.length : 0),
        },
      });
      continue;
    }

    seq += 1;
    const issueKey = `ISSUE-${executionLabel(run.runNumber)}-${String(seq).padStart(3, '0')}`;
    const screenshots = seed.screenshots.slice(0, MAX_SCREENSHOTS);

    const payload = {
      ownerUserId: run.userId,
      boardId: board._id,
      runId: run._id,
      projectId: project._id,
      bugId: seed.bugId,
      sourceKey: seed.sourceKey,
      issueKey,
      title: seed.title,
      description: seed.description,
      category: seed.category,
      status: 'new',
      severity: seed.severity,
      priority: seed.priority,
      labels: seed.labels,
      order: seq,
      testCaseId: seed.testCaseId,
      module: seed.module,
      feature: seed.feature,
      screenName: seed.screenName,
      failedStepNumber: seed.failedStepNumber,
      failedStepText: seed.failedStepText,
      expectedResult: seed.expectedResult,
      actualResult: seed.actualResult,
      stepsToReproduce: seed.stepsToReproduce,
      executionNumber: run.runNumber,
      executionId: executionLabel(run.runNumber),
      projectName,
      applicationName,
      moduleType: snapshot.moduleType,
      platform: snapshot.platform,
      deviceName: snapshot.deviceName,
      buildVersion: snapshot.buildVersion,
      screenshots,
      screenRecordingUrl: seed.screenRecordingUrl,
      logs: seed.logs,
      stackTrace: seed.stackTrace,
      apiRequest: seed.apiRequest,
      apiResponse: seed.apiResponse,
      aiRootCause: seed.aiRootCause,
      aiSuggestedFix: seed.aiSuggestedFix,
      attachmentCount: screenshots.length + (seed.screenRecordingUrl ? 1 : 0),
      commentCount: 0,
      activity: [{
        type: 'created',
        message: `Issue created automatically from Execution #${executionLabel(run.runNumber)} (${MODULE_TYPE_LABEL[snapshot.moduleType]}).`,
        toStatus: 'new',
        actorName: 'AI Issue Analyser',
        createdAt: new Date(),
      }],
    };

    try {
      await QaIssueCard.create(payload);
      cardsCreated += 1;
    } catch (e: any) {
      // Duplicate key = a concurrent sync already created this card. Not an error.
      if (e?.code !== 11000) throw e;
      seq -= 1;
    }
  }

  await recomputeBoardRollups(String(board._id));
  const fresh = await QaIssueBoard.findById(board._id).lean<any>();

  if (created) {
    await notifyDevelopers(
      String(run.userId),
      'issue_board.created',
      'New AI Issue Board created',
      `${boardName} — ${fresh?.totalIssues ?? 0} issue(s) detected from ${snapshot.totalCases} test case(s).`,
    );
  }

  return {
    boardId: String(board._id),
    boardName,
    created,
    cardsCreated,
    totalIssues: fresh?.totalIssues ?? 0,
  };
}

/**
 * Completion hook for the execution engines. Never throws and never rejects —
 * a board problem must not fail or alter a test run.
 */
export async function onRunCompleted(runId: string): Promise<void> {
  try {
    await syncIssueBoardForRun(runId);
  } catch (e) {
    console.error('AI Issue Boards: board sync failed for run', runId, e);
  }
}

/**
 * Creates boards for completed executions that don't have one yet — the
 * historical backfill, and a safety net for any completion path that finished
 * while the app was restarting. Cheap when there is nothing to do.
 */
export async function backfillIssueBoards(limit = 40): Promise<number> {
  await connectToDatabase();

  const existing = await QaIssueBoard.find({}).select('runId').lean<any[]>();
  const covered = new Set(existing.map((b) => String(b.runId)));

  const runs = await QaTestRun.find({
    status: { $in: Array.from(TERMINAL_RUN_STATUSES) },
  }).sort({ createdAt: -1 }).limit(Math.max(limit, 1) * 4).select('_id').lean<any[]>();

  let created = 0;
  for (const run of runs) {
    if (covered.has(String(run._id))) continue;
    if (created >= limit) break;
    const res = await syncIssueBoardForRun(String(run._id)).catch((e) => {
      console.error('AI Issue Boards: backfill failed for run', String(run._id), e);
      return null;
    });
    if (res?.created) created += 1;
  }
  return created;
}
