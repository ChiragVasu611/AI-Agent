/**
 * Run verdict logic — pure, and deliberately free of any database or device
 * dependency.
 *
 * These are the rules that decide whether a run may be called a pass, and what
 * its score is. They were previously defined alongside the Mongo persistence
 * code, which meant they could not be unit-tested without a database connection.
 * The most safety-critical logic in the platform is the logic that most needs
 * tests, so it lives here on its own.
 *
 * Reporting concern, per the architecture split: Execution / Planning / Evidence
 * / **Reporting** / Learning / Storage / Analytics.
 */

export interface ExerciseEvidence {
  screensVisited: number;
  interactions: number;
  navigatingTransitions: number;
  goalsReached: number;
}

export interface ExerciseVerdict {
  exercised: boolean;
  /** Why the run is considered untested, for the run's error message. */
  reason: string;
}

/**
 * Whether the run actually exercised the application.
 *
 * A run that never got past the launch screen finds no bugs, and "no bugs" was
 * being read as PASSED — the single most misleading thing this engine could
 * report, because it looks identical to a clean run. Observed in production:
 * RUN-29 finished in 22 seconds having reached one screen, and reported
 * "4/4 checks passed".
 *
 * Passing therefore requires evidence the app was genuinely driven: navigation
 * that succeeded, and a feature goal actually reached.
 */
export function assessExercise(e: ExerciseEvidence): ExerciseVerdict {
  if (e.screensVisited <= 1 && e.navigatingTransitions === 0) {
    return {
      exercised: false,
      reason:
        `The app was launched but never navigated: ${e.screensVisited} screen(s) reached and no transition `
        + 'succeeded. Nothing beyond the launch screen was tested, so this run proves nothing about the app.',
    };
  }
  if (e.goalsReached === 0 && e.navigatingTransitions < 2) {
    return {
      exercised: false,
      reason:
        `No application feature was exercised: ${e.navigatingTransitions} navigating interaction(s) and `
        + '0 goals reached. The run did not get far enough to test any workflow.',
    };
  }
  return { exercised: true, reason: '' };
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

/**
 * A 0–100 quality score derived from real bug counts, weighted by severity.
 *
 * Callers must only compute this for a run that {@link assessExercise} accepted —
 * a run that tested nothing would otherwise score a perfect 100 on the strength
 * of having found no bugs.
 */
export function computePerformanceScore(severityCounts: Record<string, number>): number {
  const penalty =
    (severityCounts.critical ?? 0) * 20
    + (severityCounts.high ?? 0) * 10
    + (severityCounts.medium ?? 0) * 4
    + (severityCounts.low ?? 0) * 1;
  return Math.max(20, 100 - penalty);
}
