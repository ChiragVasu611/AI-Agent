import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';

/**
 * How long a run may sit in a non-terminal state without checkpointing before
 * it is declared dead. Every engine (real-device, real-browser, simulated,
 * uploaded) saves progress far more often than this, and the Android engine's
 * own hard ceiling is 12 minutes — so 8 minutes of complete silence means the
 * worker process was killed (dev-server restart, redeploy, crash) or wedged.
 */
const STALE_RUN_MS = 8 * 60_000;

/**
 * Fails any run left "queued"/"running" whose worker has clearly stopped.
 *
 * Runs are executed as fire-and-forget background promises inside a Node
 * process; that promise does NOT survive a process restart, and nothing else
 * transitions those rows. Without this sweep an interrupted run polls
 * "running" forever (the classic "stuck at 96%" zombie). This is a cheap,
 * idempotent `updateMany` safe to call on every runs read.
 *
 * @param userId  Scope the sweep to one user (used on per-user reads). Omit to
 *                reconcile globally.
 * @returns number of runs transitioned to "failed".
 */
export async function reconcileStaleRuns(userId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const filter: Record<string, unknown> = {
    status: { $in: ['queued', 'running'] },
    updatedAt: { $lt: cutoff },
  };
  if (userId) filter.userId = userId;

  const res = await QaTestRun.updateMany(filter, {
    $set: {
      status: 'failed',
      progress: 100,
      currentStep: 'Interrupted',
      currentCase: null,
      completedAt: new Date(),
      errorMessage:
        'The execution worker stopped responding (most likely a server restart or timeout) '
        + 'and the run was marked failed automatically. Start a new run to try again.',
    },
  });

  return res.modifiedCount ?? 0;
}
