import { QaBug } from '@/lib/mongodb/models/QaBug';
import type { DeviceProfile, Finding } from './types';

/**
 * Bug persistence.
 *
 * A Finding only becomes a QaBug here, and every stored bug carries the
 * evidence that produced it (logcat excerpt, dumpsys slice, measured values or
 * element bounds) plus the real device context. Duplicate findings are
 * collapsed by signature so a condition observed on many screens is filed once
 * with its occurrence count, rather than flooding the report.
 */

const SEVERITY_TO_PRIORITY: Record<Finding['severity'], string> = {
  critical: 'p1',
  high: 'p1',
  medium: 'p2',
  low: 'p3',
};

export interface BugContext {
  userId: unknown;
  projectId: unknown;
  runId: string;
  runNumber: number;
  device: DeviceProfile;
  appVersion: string;
  packageName: string;
}

/** Stable identity for a finding, used to avoid filing the same issue twice. */
function signatureOf(f: Finding): string {
  // Title carries counts (e.g. "3 elements…"), so normalise digits out of it.
  const normalizedTitle = f.title.replace(/\d+/g, '#');
  return `${f.type}|${f.module}|${normalizedTitle}|${f.screenName}`;
}

export class BugReporter {
  private seen = new Map<string, number>();
  private sequence = 0;
  private created: Array<{ bugNumber: string; title: string; severity: string; type: string }> = [];

  constructor(private ctx: BugContext) {}

  /**
   * Files a finding as a bug. Returns the created document's **id**, or null
   * when the finding duplicates one already reported in this run.
   *
   * The id — not the human-readable bug number — is what callers need: the
   * result row's `bugId` is an ObjectId reference. Returning the number here
   * made `QaTestCaseResult.create()` throw
   * `Cast to ObjectId failed for value "BUG-27-001"`, which aborted the whole
   * run on its FIRST failing check and discarded every result collected up to
   * that point. The number is still available via {@link list} for display.
   */
  async report(f: Finding, screenshotDataUrl?: string | null): Promise<string | null> {
    const sig = signatureOf(f);
    const priorCount = this.seen.get(sig) ?? 0;
    if (priorCount > 0) {
      this.seen.set(sig, priorCount + 1);
      return null;
    }
    this.seen.set(sig, 1);

    this.sequence += 1;
    const bugNumber = `BUG-${this.ctx.runNumber}-${String(this.sequence).padStart(3, '0')}`;

    const evidenceBlock = [
      f.evidence?.trim() ? `EVIDENCE\n${f.evidence.trim()}` : '',
      f.activity ? `ACTIVITY\n${f.activity}` : '',
      `DEVICE\n${this.ctx.device.model} · ${this.ctx.device.osVersion} · ${this.ctx.device.width}x${this.ctx.device.height} · serial ${this.ctx.device.serial}`,
      `CAPTURED AT\n${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12_000);

    const doc = await QaBug.create({
      userId: this.ctx.userId,
      projectId: this.ctx.projectId,
      runId: this.ctx.runId,
      type: f.type,
      module: f.module,
      feature: f.screenName || 'Application',
      severity: f.severity,
      priority: SEVERITY_TO_PRIORITY[f.severity],
      bugNumber,
      testCaseId: '',
      failedStepNumber: null,
      title: f.title.slice(0, 200),
      description: f.description,
      screenName: f.screenName,
      stepsToReproduce: f.stepsToReproduce,
      expectedResult: f.expectedResult,
      actualResult: f.actualResult,
      screenshotDataUrl: screenshotDataUrl ?? f.screenshotDataUrl ?? null,
      logs: evidenceBlock,
      stackTrace: f.stackTrace ?? null,
      deviceInfo: `${this.ctx.device.model} (${this.ctx.device.serial})`,
      osVersion: this.ctx.device.osVersion,
      appVersion: this.ctx.appVersion,
      aiRootCause: f.rootCause,
      suggestedFix: f.suggestedFix,
    });

    this.created.push({ bugNumber, title: f.title, severity: f.severity, type: f.type });
    return String((doc as unknown as { _id: unknown })._id);
  }

  /** Files a batch, returning the ids actually created. */
  async reportAll(findings: Finding[], screenshotDataUrl?: string | null): Promise<string[]> {
    const out: string[] = [];
    for (const f of findings) {
      const n = await this.report(f, screenshotDataUrl);
      if (n) out.push(n);
    }
    return out;
  }

  get count(): number {
    return this.created.length;
  }

  get severityCounts(): Record<string, number> {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const b of this.created) counts[b.severity] = (counts[b.severity] ?? 0) + 1;
    return counts;
  }

  get typeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const b of this.created) counts[b.type] = (counts[b.type] ?? 0) + 1;
    return counts;
  }

  /** Occurrences suppressed as duplicates — surfaced in the run summary. */
  get duplicatesSuppressed(): number {
    let n = 0;
    for (const c of Array.from(this.seen.values())) if (c > 1) n += c - 1;
    return n;
  }

  list(): Array<{ bugNumber: string; title: string; severity: string; type: string }> {
    return [...this.created];
  }
}
