import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import type { CheckOutcome } from './types';
import type { BugReporter } from './bug-generator';

/**
 * Run reporting helpers.
 *
 * Persists CheckOutcomes as QaTestCaseResult rows and links any outcome that
 * carries a finding to the QaBug that was filed for it, so the run report's
 * test-case table and bug list stay cross-referenced. All rows reflect real
 * executed checks — there is no synthetic padding.
 */

export interface PersistedTotals {
  total: number;
  passed: number;
  failed: number;
}

/**
 * Resolves the Expected/Actual text stored on a result row. Prefers the values
 * the check set explicitly; falls back to the linked finding (failures always
 * carry one); and finally derives a sensible default from the check's name so
 * no row is ever left blank in the report.
 */
function expectedActual(o: CheckOutcome): { expected: string; actual: string } {
  const expected = o.expected ?? o.finding?.expectedResult
    ?? `${o.name}.`;
  const actual = o.actual ?? o.finding?.actualResult
    ?? (o.result === 'pass'
      ? 'Verified — the screen behaved as expected.'
      : 'The expected condition was not met.');
  return { expected, actual };
}

/**
 * Writes outcomes to the DB. When an outcome has a finding, the finding is
 * filed via the reporter first so the row can reference the resulting bug.
 */
export async function persistOutcomes(
  runId: string,
  outcomes: CheckOutcome[],
  reporter: BugReporter,
  screenshotFor?: (screen: string) => string | null,
): Promise<PersistedTotals> {
  let passed = 0;
  let failed = 0;

  for (const o of outcomes) {
    let bugId: string | null = null;
    if (o.result === 'fail' && o.finding) {
      const shot = screenshotFor?.(o.screen) ?? o.finding.screenshotDataUrl ?? null;
      bugId = await reporter.report(o.finding, shot);
    }

    const { expected, actual } = expectedActual(o);
    await QaTestCaseResult.create({
      runId,
      testCaseId: o.testCaseId,
      name: o.name,
      module: o.module,
      screen: o.screen,
      result: o.result,
      expectedResult: expected,
      actualResult: actual,
      failedStepNumber: o.result === 'fail' ? 1 : null,
      // bugId links only when a NEW bug was created (duplicates return null).
      bugId: bugId ? (bugId as unknown) : null,
    });

    if (o.result === 'pass') passed += 1; else failed += 1;
  }

  return { total: outcomes.length, passed, failed };
}

/** Overall run verdict from the accumulated evidence. */
export function computeStatus(
  severityCounts: Record<string, number>,
  totalBugs: number,
): 'passed' | 'partial' | 'failed' {
  const criticalOrHigh = (severityCounts.critical ?? 0) + (severityCounts.high ?? 0);
  if (criticalOrHigh > 0) return 'failed';
  if (totalBugs > 0) return 'partial';
  return 'passed';
}

/** A 0–100 quality score derived from real bug counts, weighted by severity. */
export function computePerformanceScore(severityCounts: Record<string, number>): number {
  const penalty =
    (severityCounts.critical ?? 0) * 20
    + (severityCounts.high ?? 0) * 10
    + (severityCounts.medium ?? 0) * 4
    + (severityCounts.low ?? 0) * 1;
  return Math.max(20, 100 - penalty);
}
