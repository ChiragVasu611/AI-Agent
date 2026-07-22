'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignDocument } from '@/lib/mongodb/models/DesignDocument';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { User } from '@/lib/mongodb/models/User';
import { runDesignPipeline } from '@/lib/ai/design-pipeline';
import { reviewDesign } from '@/lib/ai/design-review';
import type { DesignElement, DesignPlatform, DesignScreen } from '@/lib/types';

const MAX_VERSIONS = 20;
const MIN_TOUCH_TARGET = 44;

function contrastFixColor(background: string): string {
  const clean = background.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#1A1B1E';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111214' : '#FFFFFF';
}

function applyDeterministicFixes(screens: DesignScreen[]): { screens: DesignScreen[]; fixedCount: number } {
  let fixedCount = 0;
  const anyButtonFill = screens.flatMap((s) => s.elements).find((e) => e.type === 'button')?.fill ?? '#4F46E5';

  const fixed = screens.map((screen) => {
    const elements: DesignElement[] = screen.elements.map((el) => {
      let next = el;
      const isInteractive = el.type === 'button' || el.type === 'input' || (el.type === 'icon' && el.target);
      if (isInteractive && (el.h < MIN_TOUCH_TARGET || (el.type === 'icon' && el.w < 32))) {
        next = { ...next, h: Math.max(next.h, MIN_TOUCH_TARGET), w: el.type === 'icon' ? Math.max(next.w, 32) : next.w };
        fixedCount += 1;
      }
      if (next.text && next.color) {
        const bg = (next.type === 'button' || next.type === 'input') && next.fill ? next.fill : screen.background;
        const clean = bg.replace('#', '');
        const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
        if (/^[0-9a-fA-F]{6}$/.test(full)) {
          const [r, g, bl] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
          const [cr, cg, cb] = (next.color.replace('#', '').match(/.{2}/g) ?? []).map((h) => parseInt(h, 16));
          const bgLum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
          const textLum = Number.isFinite(cr) ? (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255 : 0.5;
          if (Math.abs(bgLum - textLum) < 0.4) {
            next = { ...next, color: contrastFixColor(bg) };
            fixedCount += 1;
          }
        }
      }
      return next;
    });

    const hasButton = elements.some((e) => e.type === 'button');
    const isTerminal = /splash|loading|empty|error|success|otp/i.test(screen.name);
    if (!hasButton && !isTerminal) {
      elements.push({
        id: `el-fix-${screen.id}-cta`,
        type: 'button',
        x: 24,
        y: Math.max(screen.height - 96, 0),
        w: screen.width - 48,
        h: 52,
        text: 'Continue',
        fill: anyButtonFill,
        color: '#FFFFFF',
        radius: 12,
        target: null,
      });
      fixedCount += 1;
    }

    return { ...screen, elements };
  });

  return { screens: fixed, fixedCount };
}

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

  const dbUser = await User.findById(user.id).lean<{ uiuxOpenRouterApiKey: string | null; uiuxAiEnabled: boolean }>();

  // Fire-and-forget; the client polls for status updates.
  runDesignPipeline(String(project._id), {
    id: String(project._id),
    userId: user.id,
    brief: project.brief,
    referenceUrl,
    platform,
    style,
  }, {
    apiKey: dbUser?.uiuxOpenRouterApiKey ?? null,
    aiEnabled: dbUser?.uiuxAiEnabled ?? true,
  }).catch((e) => console.error('design pipeline error', e));

  return { projectId: String(project._id) };
}

export async function improveDesign(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();
  const project = await DesignProject.findOne({ _id: projectId, userId: user.id });
  if (!project) return { error: 'Design project not found' };

  const doc = await DesignDocument.findOne({ projectId });
  if (!doc) return { error: 'Design document not found' };

  const { screens: fixedScreens, fixedCount } = applyDeterministicFixes(doc.screens as DesignScreen[]);

  if (fixedCount === 0) {
    return { ok: true, fixedCount: 0, message: 'No automatically-fixable issues were found.' };
  }

  await DesignDocument.findOneAndUpdate(
    { projectId },
    {
      $set: { screens: fixedScreens },
      $push: { versions: { $each: [{ screens: doc.screens, savedAt: new Date() }], $slice: -MAX_VERSIONS } },
    },
  );

  const review = reviewDesign(fixedScreens);
  await DesignProject.findByIdAndUpdate(projectId, {
    score: review.overallScore,
    uxScore: review.uxScore,
    uiScore: review.uiScore,
    accessibilityScore: review.accessibilityScore,
    consistencyScore: review.consistencyScore,
    responsiveScore: review.responsiveScore,
    reviewIssues: review.issues,
  });

  await ActivityLog.create({
    userId: user.id, action: 'design_project.improve', entity: 'design_project', entityId: projectId, meta: { fixedCount },
  });

  revalidatePath(`/uiux-editor/${projectId}`);
  revalidatePath(`/designer/${projectId}`);
  return { ok: true, fixedCount, review };
}

export async function saveUiuxAiSettings(apiKey: string, tier: 'free' | 'paid', aiEnabled: boolean) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();
  await User.findByIdAndUpdate(user.id, {
    uiuxOpenRouterApiKey: apiKey.trim() || null,
    uiuxApiKeyTier: apiKey.trim() ? tier : null,
    uiuxAiEnabled: aiEnabled,
  });

  revalidatePath('/designer/settings');
  return { ok: true };
}
