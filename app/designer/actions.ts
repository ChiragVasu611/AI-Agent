'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runDesignPipeline } from '@/lib/ai/design-pipeline';
import type { DesignPlatform } from '@/lib/types';

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function generateDesign(formData: FormData) {
  const brief = String(formData.get('brief') ?? '').trim();
  const referenceUrlRaw = String(formData.get('referenceUrl') ?? '').trim();
  const platform = String(formData.get('platform') ?? 'both') as DesignPlatform;
  const style = String(formData.get('style') ?? 'modern').trim() || 'modern';

  if (!brief && !referenceUrlRaw) {
    return { error: 'Describe what to design, or provide a reference link.' };
  }
  if (referenceUrlRaw && !isValidUrl(referenceUrlRaw)) {
    return { error: 'Invalid reference URL.' };
  }

  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const referenceUrl = referenceUrlRaw || null;
  const name = brief ? brief.slice(0, 60) : (referenceUrl as string).split('/').filter(Boolean).pop() || 'Untitled Design';

  await connectToDatabase();

  const project = await DesignProject.create({
    userId: user.id,
    name,
    brief: brief || `Design inspired by ${referenceUrl}`,
    referenceUrl,
    platform,
    style,
    status: 'queued',
    progress: 0,
  });

  await ActivityLog.create({
    userId: user.id,
    action: 'design_project.create',
    entity: 'design_project',
    entityId: String(project._id),
    meta: { referenceUrl, platform, style },
  });

  revalidatePath('/designer');

  // Fire-and-forget; the client polls for status updates.
  runDesignPipeline(String(project._id), {
    id: String(project._id),
    userId: user.id,
    brief: project.brief,
    referenceUrl,
    platform,
    style,
  }).catch((e) => console.error('design pipeline error', e));

  return { projectId: String(project._id) };
}
