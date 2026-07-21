'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runPipeline } from '@/lib/ai/pipeline';
import type { Platform, Store } from '@/lib/types';

function detectStore(url: string): Store {
  const u = url.toLowerCase();
  if (u.includes('play.google.com')) return 'google_play';
  if (u.includes('apps.apple.com')) return 'apple';
  return 'unknown';
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function analyzeAndBuild(formData: FormData) {
  const referenceUrl = String(formData.get('referenceUrl') ?? '').trim();
  const platform = String(formData.get('platform') ?? 'flutter') as Platform;
  const googlePlay = String(formData.get('googlePlay') ?? '').trim();
  const appleStore = String(formData.get('appleStore') ?? '').trim();

  const primary = referenceUrl || googlePlay || appleStore;
  if (!primary) return { error: 'Provide a reference app URL.' };
  if (!isValidUrl(primary)) return { error: 'Invalid URL.' };

  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const store = detectStore(primary);
  const name = primary.split('/').filter(Boolean).pop() || 'Untitled App';

  await connectToDatabase();

  const project = await Project.create({
    userId: user.id,
    name,
    referenceUrl: primary,
    platform,
    store,
    status: 'queued',
    progress: 0,
  });

  await ActivityLog.create({
    userId: user.id,
    action: 'project.create',
    entity: 'project',
    entityId: String(project._id),
    meta: { referenceUrl: primary, platform, store },
  });

  revalidatePath('/app-factory');

  // Fire-and-forget; the client polls for status updates.
  runPipeline(String(project._id), {
    id: String(project._id),
    userId: user.id,
    referenceUrl: primary,
    store,
    platform,
  }).catch((e) => console.error('pipeline error', e));

  return { projectId: String(project._id) };
}
