import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { log } from '@/lib/qa/runtime-helpers';
import { onRunCompleted } from '@/lib/issue-boards/sync';
import { describeBlocked, type BlockedDecision } from '@/lib/qa/runtime-support';

/**
 * Terminates a run as BLOCKED — the only honest outcome when the target cannot
 * actually be executed.
 *
 * A blocked run deliberately produces NO artefacts: no test-case rows, no bugs,
 * no screenshots, and no QA score. Those would all be inventions, and an empty
 * report that states why it is empty is worth more than a populated one that
 * cannot be trusted. `passedCases`/`failedCases` stay at zero so no dashboard
 * can average a blocked run into a success rate.
 */
export async function finalizeBlockedRun(
  runId: string,
  decision: BlockedDecision,
): Promise<void> {
  await connectToDatabase();

  await log(runId, 'error', 'error', describeBlocked(decision));
  if (decision.remediation.length > 0) {
    await log(runId, 'automation', 'warn', 'To make this target executable:');
    for (const step of decision.remediation) {
      await log(runId, 'automation', 'warn', `  • ${step}`);
    }
  }
  await log(runId, 'automation', 'info',
    'No test results, bugs, screenshots or scores were recorded for this run, because nothing was '
    + 'executed. This platform never estimates results it did not measure.');

  const run = await QaTestRun.findById(runId);
  if (!run) return;

  run.status = 'blocked';
  run.engineMode = decision.kind;
  run.progress = 100;
  run.currentStep = 'Blocked — not executed';
  run.currentCase = null;
  run.currentSuite = null;
  run.errorMessage = describeBlocked(decision);
  // Explicitly zeroed: a blocked run must never contribute to pass/fail metrics.
  run.totalCases = 0;
  run.passedCases = 0;
  run.failedCases = 0;
  run.blockedCases = 0;
  run.skippedCases = 0;
  run.performanceScore = null;
  run.startedAt = run.startedAt ?? new Date();
  run.completedAt = new Date();
  await run.save();

  await onRunCompleted(runId);
}
