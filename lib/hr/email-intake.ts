import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { ingestResumeApplication } from '@/lib/hr/resume-intake';
import type { EmailSourceSettings } from '@/lib/types';

function buildClient(config: EmailSourceSettings) {
  return new ImapFlow({
    host: config.incomingServer,
    port: config.port,
    secure: config.useSsl,
    auth: { user: config.username, pass: config.password },
    logger: false,
    // ImapFlow's default connection timeout is 90s — much too long for an
    // interactive "Test Connection" click. Fail fast with a clear message instead.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
}

/** ImapFlow's own error.message is often just the generic "Command failed" —
 * the server's actual reason (wrong password, IMAP disabled, etc.) lives in
 * error.responseText / error.authenticationFailed. Surface that instead. */
function describeImapError(e: unknown): string {
  const err = e as Error & { responseText?: string; authenticationFailed?: boolean; code?: string };
  if (err.authenticationFailed) {
    return err.responseText || 'Authentication failed — check the username and password/app password.';
  }
  if (err.responseText) return err.responseText;
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return `Could not resolve host "${err.message}". Check the Incoming Mail Server value.`;
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return `Could not reach the server on the given port (${err.code}). Check the server address and port.`;
  return err.message || 'Unknown error';
}

export async function testEmailConnection(config: EmailSourceSettings): Promise<{ ok: boolean; message: string }> {
  if (!config.incomingServer || !config.username || !config.password) {
    return { ok: false, message: 'Incoming server, username, and password are required.' };
  }
  const client = buildClient(config);
  try {
    await client.connect();
    await client.mailboxOpen(config.inboxFolder || 'INBOX');
    await client.logout();
    return { ok: true, message: `Connected to ${config.incomingServer} and opened "${config.inboxFolder || 'INBOX'}" successfully.` };
  } catch (e) {
    try { await client.logout(); } catch { /* already closed */ }
    return { ok: false, message: `Connection failed: ${describeImapError(e)}` };
  }
}

function extFromFilename(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return null;
}

export interface EmailFetchSummary {
  scanned: number;
  ingested: number;
  skipped: number;
  errors: string[];
}

/** Manually-triggered fetch — this environment has no persistent background worker,
 * so "continuous monitoring" is realized as an on-demand "Fetch Now" action here.
 * Wiring a real cron (e.g. a scheduled serverless function) to call this on an interval
 * would give true continuous monitoring in production without any code changes. */
export async function fetchRecruitmentEmails(userId: string): Promise<EmailFetchSummary> {
  await connectToDatabase();
  const settingsDoc = await RecruitmentSourceSettings.findOne({ userId });
  const email: EmailSourceSettings | undefined = settingsDoc?.email;
  if (!email || !email.enabled) return { scanned: 0, ingested: 0, skipped: 0, errors: ['Email intake is disabled.'] };
  if (!email.incomingServer || !email.username || !email.password) {
    return { scanned: 0, ingested: 0, skipped: 0, errors: ['Email settings are incomplete.'] };
  }

  const summary: EmailFetchSummary = { scanned: 0, ingested: 0, skipped: 0, errors: [] };
  const client = buildClient(email);

  try {
    await client.connect();
    const lock = await client.getMailboxLock(email.inboxFolder || 'INBOX');
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      const allowedTypes = email.allowedResumeTypes?.length ? email.allowedResumeTypes : ['pdf', 'docx'];
      const maxBytes = (email.maxAttachmentSizeMb || 5) * 1024 * 1024;

      for (const uid of uids) {
        summary.scanned += 1;
        try {
          const { content } = await client.download(String(uid), undefined, { uid: true });
          const chunks: Buffer[] = [];
          for await (const chunk of content) chunks.push(chunk as Buffer);
          const parsed = await simpleParser(Buffer.concat(chunks));

          const resumeAttachment = parsed.attachments.find((a) => {
            const ext = extFromFilename(a.filename || '');
            return ext && allowedTypes.includes(ext) && a.size <= maxBytes;
          });

          if (!resumeAttachment) {
            summary.skipped += 1;
            await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true });
            continue;
          }

          const result = await ingestResumeApplication({
            userId,
            buffer: resumeAttachment.content as Buffer,
            fileName: resumeAttachment.filename || 'resume.pdf',
            source: 'email',
            sourceMeta: { emailFrom: parsed.from?.text ?? '', emailSubject: parsed.subject ?? '' },
          });

          if (result.ok) summary.ingested += 1;
          else summary.errors.push(`${parsed.subject ?? uid}: ${result.error}`);

          await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true });
        } catch (e) {
          summary.errors.push(`UID ${uid}: ${(e as Error).message}`);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    summary.errors.push(`Connection error: ${(e as Error).message}`);
  }

  await RecruitmentSourceSettings.findOneAndUpdate({ userId }, { 'email.lastFetchedAt': new Date() });
  return summary;
}
