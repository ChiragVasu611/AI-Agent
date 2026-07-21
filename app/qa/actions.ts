'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runQaTestExecution } from '@/lib/qa/engine';
import { DEFAULT_SMOKE_MODULES } from '@/lib/qa/modules';
import type { QaPlatform, QaSourceType } from '@/lib/types';

const PLATFORM_BY_SOURCE: Record<QaSourceType, QaPlatform> = {
  apk: 'android',
  play_store_url: 'android',
  ipa: 'ios',
  app_store_url: 'ios',
  flutter: 'cross_platform',
  react_native: 'cross_platform',
  hybrid: 'cross_platform',
  web_app: 'web',
  web_url: 'web',
};

export async function startTestExecution(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const sourceType = String(formData.get('sourceType') ?? '') as QaSourceType;
  const sourceRef = String(formData.get('sourceRef') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || sourceRef.split('/').filter(Boolean).pop() || 'Untitled App';
  const buildVersion = String(formData.get('buildVersion') ?? '').trim() || '1.0.0';
  const modulesRaw = formData.getAll('modules').map(String);
  const modules = modulesRaw.length > 0 ? modulesRaw : DEFAULT_SMOKE_MODULES;

  if (!sourceType || !PLATFORM_BY_SOURCE[sourceType]) return { error: 'Select a valid source type.' };
  if (!sourceRef) return { error: 'Provide a file name or URL for the app under test.' };

  await connectToDatabase();

  const project = await QaProject.create({
    userId: user.id,
    name,
    sourceType,
    sourceRef,
    platform: PLATFORM_BY_SOURCE[sourceType],
  });

  const existingRunCount = await QaTestRun.countDocuments({ userId: user.id });
  const runNumber = existingRunCount + 1;

  const run = await QaTestRun.create({
    userId: user.id,
    projectId: project._id,
    modules,
    status: 'queued',
    runNumber,
    runName: `${name} Run #${runNumber}`,
    buildVersion,
    executedByName: user.fullName || user.email,
  });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.start', entity: 'qa_test_run', entityId: String(run._id), meta: { name, modules },
  });

  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null }>();
  const apiKey = dbUser?.qaOpenRouterApiKey ?? null;

  // Fire-and-forget; the client polls the run for live status.
  runQaTestExecution(String(run._id), apiKey).catch((e) => console.error('QA execution error', e));

  revalidatePath('/qa');
  revalidatePath('/qa/test-execution');
  return { runId: String(run._id) };
}

export async function saveQaApiKey(apiKey: string, tier: 'free' | 'paid') {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();
  await User.findByIdAndUpdate(user.id, {
    qaOpenRouterApiKey: apiKey.trim() || null,
    qaApiKeyTier: apiKey.trim() ? tier : null,
  });

  revalidatePath('/qa/settings');
  return { ok: true };
}
