import { clearLogcat, dumpLogcat } from './device';

/**
 * Crash / ANR / native-signal monitoring.
 *
 * All signals are parsed out of real logcat output. The monitor is
 * incremental: it remembers which signatures it has already reported so the
 * same crash isn't filed twice across polling cycles, and it captures the
 * surrounding log lines verbatim as evidence for the bug report.
 */

export type CrashKind = 'crash' | 'anr' | 'native';

export interface CrashSignal {
  kind: CrashKind;
  title: string;
  /** Exception class or signal name, used for dedupe. */
  signature: string;
  process: string | null;
  /** Verbatim logcat excerpt proving the crash. */
  evidence: string;
  stackTrace: string;
}

const FATAL_RE = /FATAL EXCEPTION|AndroidRuntime:\s+FATAL/i;
const ANR_RE = /ANR in ([\w.:/]+)/i;
const NATIVE_RE = /signal\s+(\d+)\s*\((SIG[A-Z]+)\)|\bDEBUG\b.*\*{3}\s*\*{3}/i;
const EXCEPTION_LINE = /((?:[\w$]+\.)+[\w$]*(?:Exception|Error))(?::\s*(.*))?/;

function extractProcess(block: string): string | null {
  const m = /Process:\s*([\w.:]+)/.exec(block) ?? /\bANR in ([\w.:/]+)/.exec(block);
  return m ? m[1] : null;
}

/** Pulls the java stack frames that follow the exception header. */
function extractStack(lines: string[], startIdx: number, max = 40): string {
  const out: string[] = [];
  for (let i = startIdx; i < Math.min(lines.length, startIdx + max); i++) {
    out.push(lines[i]);
    // Stop when the log clearly moves on to an unrelated tag.
    if (i > startIdx + 3 && !/\s+at\s|Caused by|FATAL|AndroidRuntime|Process:|^\s*$/.test(lines[i])) {
      if (out.length > 6) break;
    }
  }
  return out.join('\n').slice(0, 4000);
}

/** Parses a logcat dump into distinct crash/ANR/native signals. */
export function parseCrashes(log: string, appPackage: string): CrashSignal[] {
  if (!log) return [];
  const lines = log.split('\n');
  const found: CrashSignal[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FATAL_RE.test(line)) {
      const block = lines.slice(i, i + 30).join('\n');
      const proc = extractProcess(block);
      // Only report crashes belonging to the app under test.
      if (appPackage && proc && !proc.startsWith(appPackage)) continue;
      const exMatch = EXCEPTION_LINE.exec(block);
      const exClass = exMatch?.[1] ?? 'FatalException';
      const exMsg = (exMatch?.[2] ?? '').trim();
      found.push({
        kind: 'crash',
        title: exMsg ? `${exClass}: ${exMsg}`.slice(0, 150) : `Fatal crash: ${exClass}`,
        signature: `crash:${exClass}:${exMsg.slice(0, 60)}`,
        process: proc,
        evidence: block.slice(0, 3000),
        stackTrace: extractStack(lines, i),
      });
      i += 10;
      continue;
    }

    const anr = ANR_RE.exec(line);
    if (anr) {
      const proc = anr[1];
      if (appPackage && !proc.includes(appPackage)) continue;
      const block = lines.slice(i, i + 20).join('\n');
      const reason = /Reason:\s*(.*)/.exec(block)?.[1]?.trim() ?? '';
      found.push({
        kind: 'anr',
        title: `ANR in ${proc}${reason ? ` — ${reason}` : ''}`.slice(0, 150),
        signature: `anr:${proc}:${reason.slice(0, 60)}`,
        process: proc,
        evidence: block.slice(0, 3000),
        stackTrace: extractStack(lines, i, 25),
      });
      i += 8;
      continue;
    }

    const nat = NATIVE_RE.exec(line);
    if (nat && /DEBUG|tombstone|backtrace/i.test(lines.slice(i, i + 6).join(' '))) {
      const block = lines.slice(i, i + 25).join('\n');
      if (appPackage && !block.includes(appPackage)) continue;
      const sig = nat[2] ?? `signal ${nat[1]}`;
      found.push({
        kind: 'native',
        title: `Native crash (${sig})`.slice(0, 150),
        signature: `native:${sig}`,
        process: extractProcess(block),
        evidence: block.slice(0, 3000),
        stackTrace: extractStack(lines, i, 30),
      });
      i += 10;
    }
  }

  return found;
}

/**
 * Stateful monitor used across an exploration run. `poll()` returns only
 * signals not previously seen, so the caller can file each crash exactly once.
 */
export class CrashMonitor {
  private seen = new Set<string>();

  constructor(private serial: string, private appPackage: string) {}

  /** Clears the buffer so the run only observes its own output. */
  async start(): Promise<void> {
    await clearLogcat(this.serial);
  }

  async poll(): Promise<CrashSignal[]> {
    const log = await dumpLogcat(this.serial);
    const all = parseCrashes(log, this.appPackage);
    const fresh = all.filter((c) => !this.seen.has(c.signature));
    fresh.forEach((c) => this.seen.add(c.signature));
    return fresh;
  }

  /** Full log tail, attached as supporting evidence to non-crash findings. */
  async tail(maxChars = 4000): Promise<string> {
    const log = await dumpLogcat(this.serial);
    const appLines = log
      .split('\n')
      .filter((l) => !this.appPackage || l.includes(this.appPackage) || /E\/|W\/|FATAL/.test(l));
    return appLines.slice(-120).join('\n').slice(-maxChars);
  }

  get reportedCount(): number {
    return this.seen.size;
  }
}
