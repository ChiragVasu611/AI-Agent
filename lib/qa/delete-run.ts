import fs from 'fs/promises';
import path from 'path';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { QA_UPLOAD_DIR } from '@/lib/qa/app-upload';

export interface DeleteRunOutcome {
  run: number;
  testCaseResults: number;
  screenshots: number;
  logs: number;
  bugs: number;
  uploadedCases: number;
  issueCards: number;
  issueBoards: number;
  /** True when this was the project's last run and the project row went too. */
  projectDeleted: boolean;
  /** True when the uploaded APK/IPA on disk was reclaimed. */
  binaryDeleted: boolean;
}

/**
 * Is `target` genuinely inside `dir`? `binaryPath` is a value read back out of
 * Mongo, so it is not trusted as a delete target: a stale, hand-edited, or
 * migrated-from-another-machine path must never let this unlink something
 * outside the uploads directory. Compared after resolving both sides so `..`
 * segments cannot escape.
 */
function isInside(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The single delete cascade for a QA run, shared by the Route Handler
 * (DELETE /api/qa/runs/[id]) and the Server Action (deleteQaTestRun).
 *
 * Those two used to carry independent copies of this list and had already
 * drifted: the route forgot QaUploadedTestCase, so deleting an uploaded-sheet
 * run from the dashboard or the run report orphaned every parsed row while the
 * same delete from the Test Runs list cleaned them up correctly.
 *
 * Beyond the child rows it also reclaims the two things neither copy touched:
 *
 *  - the **QaProject**, which nothing else ever deleted, and
 *  - the **uploaded binary on disk**, which is 100–500MB per APK and had
 *    accumulated 4.1GB across 41 files here.
 *
 * Both are conditional on this being the project's LAST run: re-run
 * (rerunQaTestRun) deliberately creates a new run against the same project and
 * the same binaryPath, so deleting either while a sibling run survives would
 * break that run's report and its ability to re-run.
 *
 * The caller is responsible for having verified ownership (`userId`) before
 * calling this.
 */
export async function deleteRunCascade(run: {
  _id: unknown;
  projectId?: unknown;
}): Promise<DeleteRunOutcome> {
  const runId = run._id;

  const [results, screenshots, logs, bugs, uploadedCases, issueCards, issueBoards] = await Promise.all([
    QaTestCaseResult.deleteMany({ runId }),
    QaScreenshot.deleteMany({ runId }),
    QaLogEntry.deleteMany({ runId }),
    QaBug.deleteMany({ runId }),
    QaUploadedTestCase.deleteMany({ runId }),
    // The AI Issue Board for this execution goes with it — a board whose
    // execution no longer exists could never be reviewed or retested.
    QaIssueCard.deleteMany({ runId }),
    QaIssueBoard.deleteMany({ runId }),
  ]);

  await QaTestRun.deleteOne({ _id: runId });

  let projectDeleted = false;
  let binaryDeleted = false;

  if (run.projectId) {
    const siblings = await QaTestRun.countDocuments({ projectId: run.projectId });
    if (siblings === 0) {
      const project = await QaProject.findById(run.projectId).lean<{ binaryPath: string | null } | null>();
      const binaryPath = project?.binaryPath ?? null;

      if (binaryPath && isInside(QA_UPLOAD_DIR, binaryPath)) {
        try {
          await fs.unlink(binaryPath);
          binaryDeleted = true;
        } catch (e) {
          // Already gone, or the disk said no — neither should abort the delete.
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== 'ENOENT') {
            console.error('QA delete-run: could not remove uploaded binary', binaryPath, e);
          }
        }
      }

      const res = await QaProject.deleteOne({ _id: run.projectId });
      projectDeleted = (res.deletedCount ?? 0) > 0;
    }
  }

  return {
    run: 1,
    testCaseResults: results.deletedCount ?? 0,
    screenshots: screenshots.deletedCount ?? 0,
    logs: logs.deletedCount ?? 0,
    bugs: bugs.deletedCount ?? 0,
    uploadedCases: uploadedCases.deletedCount ?? 0,
    issueCards: issueCards.deletedCount ?? 0,
    issueBoards: issueBoards.deletedCount ?? 0,
    projectDeleted,
    binaryDeleted,
  };
}
