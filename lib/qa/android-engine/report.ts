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
  /** Rows the database rejected — reported rather than silently lost. */
  skipped: number;
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
  let skipped = 0;

  for (const o of outcomes) {
    // Persisting results is the last step of a long, expensive run. One row that
    // the schema rejects must not discard everything the run collected, so each
    // row is written independently and a failure is skipped rather than thrown.
    try {
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
        bugId: bugId ?? null,
      });

      if (o.result === 'pass') passed += 1; else failed += 1;
    } catch (e) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.error(`persistOutcomes: could not store ${o.testCaseId}`, (e as Error)?.message);
    }
  }

  return { total: passed + failed, passed, failed, skipped };
}

/**
 * Verdict rules live in `lib/qa/verdict.ts` — pure functions with no database
 * dependency, so they can be unit-tested. Re-exported here because callers
 * already import them from this module.
 */
export {
  assessExercise, computeStatus, computePerformanceScore,
  type ExerciseEvidence, type ExerciseVerdict,
} from '@/lib/qa/verdict';
