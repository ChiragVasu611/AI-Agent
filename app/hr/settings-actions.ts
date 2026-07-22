'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { hasPermission } from '@/lib/auth/permissions';
import { testEmailConnection, fetchRecruitmentEmails } from '@/lib/hr/email-intake';
import { testWhatsappConfig } from '@/lib/hr/whatsapp-intake';
import type {
  CareerPortalSettings, EmailSourceSettings, LinkedinSourceSettings, WhatsappSourceSettings,
} from '@/lib/types';

async function requireRecruitmentManager() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' } as const;
  if (!hasPermission(user.permissions, 'recruitment.manage')) {
    return { error: 'Forbidden: your role does not have recruitment.manage permission.' } as const;
  }
  return { user } as const;
}

async function getOrCreateSettings(userId: string) {
  const existing = await RecruitmentSourceSettings.findOne({ userId });
  if (existing) return existing;
  return RecruitmentSourceSettings.create({ userId });
}

export async function saveCareerPortalSettings(data: CareerPortalSettings) {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  await getOrCreateSettings(guard.user.id);
  await RecruitmentSourceSettings.findOneAndUpdate({ userId: guard.user.id }, { careerPortal: data });
  revalidatePath('/hr/settings');
  return { ok: true };
}

export async function saveLinkedinSettings(data: LinkedinSourceSettings) {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  await getOrCreateSettings(guard.user.id);
  await RecruitmentSourceSettings.findOneAndUpdate({ userId: guard.user.id }, { linkedin: data });
  revalidatePath('/hr/settings');
  return { ok: true };
}

export async function saveEmailSettings(data: EmailSourceSettings) {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  await getOrCreateSettings(guard.user.id);
  await RecruitmentSourceSettings.findOneAndUpdate({ userId: guard.user.id }, { email: data });
  revalidatePath('/hr/settings');
  return { ok: true };
}

export async function saveWhatsappSettings(data: WhatsappSourceSettings) {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  await getOrCreateSettings(guard.user.id);
  await RecruitmentSourceSettings.findOneAndUpdate({ userId: guard.user.id }, { whatsapp: data });
  revalidatePath('/hr/settings');
  return { ok: true };
}

export async function testEmailSource() {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  const settings = await RecruitmentSourceSettings.findOne({ userId: guard.user.id }).lean();
  if (!settings) return { error: 'Save your email settings first.' };
  const result = await testEmailConnection((settings as any).email);
  await RecruitmentSourceSettings.findOneAndUpdate(
    { userId: guard.user.id },
    { 'email.lastTestResult': result.message, 'email.lastTestAt': new Date() },
  );
  return result;
}

export async function fetchEmailNow() {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  const summary = await fetchRecruitmentEmails(guard.user.id);
  revalidatePath('/hr');
  revalidatePath('/hr/candidates');
  return summary;
}

export async function testWhatsappSource() {
  const guard = await requireRecruitmentManager();
  if ('error' in guard) return guard;
  await connectToDatabase();
  const settings = await RecruitmentSourceSettings.findOne({ userId: guard.user.id }).lean();
  if (!settings) return { error: 'Save your WhatsApp settings first.' };
  const result = testWhatsappConfig((settings as any).whatsapp);
  await RecruitmentSourceSettings.findOneAndUpdate(
    { userId: guard.user.id },
    { 'whatsapp.lastTestResult': result.message, 'whatsapp.lastTestAt': new Date() },
  );
  return result;
}
