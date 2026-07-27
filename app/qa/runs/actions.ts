'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runQaTestExecution } from '@/lib/qa/engine';
import { runWebTestExecution } from '@/lib/qa/web-engine';
import { runUploadedTestExecution } from '@/lib/qa/uploadedEngine';
import { nextRunNumber } from '@/lib/qa/run-number';

/**
 * Re-run always creates a brand-new QaTestRun document against the same
 * project — it never edits or overwrites the original run, so every past
 * execution stays intact and independently reviewable.
 */
export async function rerunQaTestRun(runId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();

  const original = await QaTestRun.findOne({ _id: runId, userId: user.id }).lean<any>();
  if (!original) return { error: 'Run not found.' };
  const project = await QaProject.findOne({ _id: original.projectId, userId: user.id }).lean<any>();
  if (!project) return { error: 'Project for this run no longer exists.' };

  const runNumber = await nextRunNumber(user.id);
  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null }>();
  const apiKey = dbUser?.qaOpenRouterApiKey ?? null;

  const newRun = await QaTestRun.create({
    userId: user.id,
    projectId: project._id,
    modules: original.modules ?? [],
    sourceMode: original.sourceMode ?? 'catalog',
    status: 'queued',
    runNumber,
    runName: `${project.name} Run #${runNumber}`,
    buildVersion: original.buildVersion,
    executedByName: user.fullName || user.email,
    totalCases: original.sourceMode === 'uploaded' ? original.totalCases : 0,
  });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.rerun', entity: 'qa_test_run', entityId: String(newRun._id),
    meta: { originalRunId: runId, project: project.name },
  });

  if (original.sourceMode === 'uploaded') {
    const originalCases = await QaUploadedTestCase.find({ runId }).sort({ order: 1 }).lean();
    if (originalCases.length > 0) {
      await QaUploadedTestCase.insertMany(originalCases.map((tc: any) => ({
        runId: newRun._id,
        order: tc.order,
        testCaseId: tc.testCaseId,
        module: tc.module,
        feature: tc.feature,
        scenario: tc.scenario,
        preconditions: tc.preconditions,
        steps: tc.steps,
        testData: tc.testData,
        expectedResult: tc.expectedResult,
        priority: tc.priority,
        severity: tc.severity,
        result: 'pending',
      })));
    }
    runUploadedTestExecution(String(newRun._id), apiKey).catch((e) => console.error('QA re-run (uploaded) error', e));
  } else {
    const isRealBrowserTarget = project.platform === 'web' && /^https?:\/\//i.test(project.sourceRef);
    const execution = isRealBrowserTarget
      ? runWebTestExecution(String(newRun._id))
      : runQaTestExecution(String(newRun._id), apiKey);
    execution.catch((e) => console.error('QA re-run error', e));
  }

  revalidatePath('/qa/runs');
  revalidatePath('/qa');
  return { ok: true, runId: String(newRun._id) };
}

export async function deleteQaTestRun(runId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();

  const run = await QaTestRun.findOne({ _id: runId, userId: user.id });
  if (!run) return { error: 'Run not found.' };

  await Promise.all([
    QaBug.deleteMany({ runId }),
    QaLogEntry.deleteMany({ runId }),
    QaScreenshot.deleteMany({ runId }),
    QaTestCaseResult.deleteMany({ runId }),
    QaUploadedTestCase.deleteMany({ runId }),
  ]);
  await QaTestRun.deleteOne({ _id: runId });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.deleted', entity: 'qa_test_run', entityId: runId, meta: { runNumber: run.runNumber },
  });

  revalidatePath('/qa/runs');
  revalidatePath('/qa');
  return { ok: true };
}
