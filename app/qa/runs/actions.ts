'use server';

import { requireWorkspaceAction } from '@/lib/auth/require-workspace';
import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runWebTestExecution } from '@/lib/qa/web-engine';
import { runAndroidDeviceExecution } from '@/lib/qa/android-engine';
import { resolveRuntime, isBlocked } from '@/lib/qa/runtime-support';
import { finalizeBlockedRun } from '@/lib/qa/blocked-run';
import { runUploadedTestExecution } from '@/lib/qa/uploadedEngine';
import { nextRunNumber } from '@/lib/qa/run-number';
import { deleteRunCascade } from '@/lib/qa/delete-run';

/**
 * Re-run always creates a brand-new QaTestRun document against the same
 * project — it never edits or overwrites the original run, so every past
 * execution stays intact and independently reviewable.
 */
export async function rerunQaTestRun(runId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

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
    // Re-run targets the same device the original run selected.
    deviceSerial: original.deviceSerial ?? null,
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
    // A re-run is resolved against the runtime available NOW, not the one the
    // original run used: the device may be gone, or newly attached. If nothing
    // can execute the target, the re-run terminates as BLOCKED rather than
    // producing estimated results.
    const decision = await resolveRuntime(project.sourceType, project.sourceRef, {
      binaryPath: project.binaryPath ?? null,
      requestedSerial: original.deviceSerial ?? null,
    });

    if (isBlocked(decision)) {
      newRun.engineMode = decision.kind;
      await newRun.save();
      await finalizeBlockedRun(String(newRun._id), decision);
    } else {
      newRun.engineMode = decision.engine === 'web_browser' ? 'real_browser' : 'real_device';
      if (decision.serial) newRun.deviceSerial = decision.serial;
      await newRun.save();
      const execution = decision.engine === 'web_browser'
        ? runWebTestExecution(String(newRun._id))
        : runAndroidDeviceExecution(String(newRun._id), decision.serial as string);
      execution.catch((e) => console.error('QA re-run error', e));
    }
  }

  revalidatePath('/qa/runs');
  revalidatePath('/qa');
  return { ok: true, runId: String(newRun._id) };
}

/**
 * Requests cancellation of an in-flight run. Flips the status to 'cancelled';
 * the real-device engine polls this cooperatively and stops promptly, saving
 * whatever partial results it has already collected. Only running/queued runs
 * can be cancelled, and only by their owner.
 */
export async function cancelQaTestRun(runId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();

  const run = await QaTestRun.findOne({ _id: runId, userId: user.id });
  if (!run) return { error: 'Run not found.' };
  if (run.status !== 'running' && run.status !== 'queued') {
    return { error: `Run is already ${run.status}.` };
  }

  run.status = 'cancelled';
  run.currentStep = 'Cancelling…';
  await run.save();

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.cancel', entity: 'qa_test_run', entityId: runId, meta: { runNumber: run.runNumber },
  });

  revalidatePath(`/qa/runs/${runId}`);
  revalidatePath('/qa/runs');
  return { ok: true };
}

export async function deleteQaTestRun(runId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();

  const run = await QaTestRun.findOne({ _id: runId, userId: user.id });
  if (!run) return { error: 'Run not found.' };

  const deleted = await deleteRunCascade({ _id: run._id, projectId: run.projectId });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.deleted', entity: 'qa_test_run', entityId: runId,
    meta: { runNumber: run.runNumber, projectDeleted: deleted.projectDeleted, binaryDeleted: deleted.binaryDeleted },
  });

  revalidatePath('/qa/runs');
  revalidatePath('/qa');
  return { ok: true };
}
