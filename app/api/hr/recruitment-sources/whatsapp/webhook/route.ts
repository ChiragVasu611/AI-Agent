import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { ingestWhatsappResume } from '@/lib/hr/whatsapp-intake';

/**
 * Public webhook — no session, since it's called by an external WhatsApp Business API
 * provider (Meta Cloud API, Twilio, etc.), not by a logged-in user. Provider-agnostic
 * payload shape: { to, from, fileName, mediaBase64 }. `to` must match a saved
 * whatsapp.whatsappNumber so we know which HR account owns this conversation.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });

  const { to, from, fileName, mediaBase64 } = body as { to?: string; from?: string; fileName?: string; mediaBase64?: string };
  if (!to || !from || !fileName || !mediaBase64) {
    return NextResponse.json({ error: 'to, from, fileName, and mediaBase64 are required.' }, { status: 400 });
  }

  await connectToDatabase();
  const settings = await RecruitmentSourceSettings.findOne({ 'whatsapp.whatsappNumber': to }).lean();
  if (!settings) return NextResponse.json({ error: 'No recruitment WhatsApp source configured for this number.' }, { status: 404 });
  const whatsapp = (settings as any).whatsapp;
  if (!whatsapp.enabled || !whatsapp.resumeProcessingEnabled) {
    return NextResponse.json({ error: 'WhatsApp resume intake is disabled.' }, { status: 403 });
  }

  const lower = fileName.toLowerCase();
  const ext = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : null;
  const allowed: string[] = whatsapp.supportedResumeTypes ?? ['pdf', 'docx'];
  if (!ext || !allowed.includes(ext)) {
    return NextResponse.json({ error: `Unsupported resume type. Allowed: ${allowed.join(', ')}.` }, { status: 400 });
  }

  const buffer = Buffer.from(mediaBase64, 'base64');
  const maxBytes = (whatsapp.maxFileSizeMb || 5) * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    return NextResponse.json({ error: `Resume exceeds the ${whatsapp.maxFileSizeMb}MB size limit.` }, { status: 400 });
  }

  const result = await ingestWhatsappResume(String((settings as any).userId), { fromNumber: from, fileName, buffer });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

  return NextResponse.json({ ok: true, candidateId: result.candidateId, applicationId: result.applicationId });
}
