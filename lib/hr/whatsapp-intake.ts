import { ingestResumeApplication } from '@/lib/hr/resume-intake';
import type { WhatsappSourceSettings } from '@/lib/types';

/** There is no free/paid WhatsApp Business API key configured in this environment, so we
 * cannot place outbound calls to Meta's Cloud API here. What IS fully real: a webhook
 * endpoint (see app/api/hr/recruitment-sources/whatsapp/webhook/route.ts) that any WhatsApp
 * Business API provider (Meta Cloud API, Twilio, etc.) can be pointed at once the admin has
 * their own credentials — it will process resumes exactly like the other channels the
 * moment it starts receiving them. "Test Configuration" below validates the stored settings
 * are complete rather than performing a live network call. */
export function testWhatsappConfig(config: WhatsappSourceSettings): { ok: boolean; message: string } {
  if (!config.whatsappNumber) return { ok: false, message: 'A WhatsApp number is required.' };
  if (!config.resumeProcessingEnabled) return { ok: false, message: 'Resume processing is disabled — enable it to accept resumes.' };
  return { ok: true, message: 'Configuration looks complete. Point your WhatsApp Business API provider\'s webhook at the URL below to start receiving resumes.' };
}

export interface WhatsappResumePayload {
  fromNumber: string;
  fileName: string;
  buffer: Buffer;
}

export async function ingestWhatsappResume(userId: string, payload: WhatsappResumePayload) {
  return ingestResumeApplication({
    userId,
    buffer: payload.buffer,
    fileName: payload.fileName,
    source: 'whatsapp',
    sourceMeta: { whatsappNumber: payload.fromNumber },
  });
}
