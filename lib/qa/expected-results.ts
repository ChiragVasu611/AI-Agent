import { splitSheetList } from '@/lib/qa/testCaseParser';

/**
 * How a test case's "Expected Results" column maps onto its "Steps" column.
 *
 * Sheets in the wild use two conventions and give no explicit signal which one
 * is in play:
 *
 *  1. **One expectation per step** — the Expected Results cell is a numbered or
 *     newline-separated list that lines up item-for-item with Steps:
 *
 *        Steps                        Expected Results
 *        1. Launch the app            1. Splash screen is displayed
 *        2. Tap Continue              2. Home screen is displayed
 *
 *  2. **One expectation for the whole case** — a single sentence describing the
 *     end state after every step has run.
 *
 * These need opposite handling. Asserting a case-level expectation after step 1
 * fails a healthy app, because the end state legitimately is not reached yet;
 * conversely, asserting only at the end throws away per-step expectations the
 * author wrote down deliberately.
 *
 * The convention is inferred structurally — never from app-specific knowledge —
 * by splitting Expected Results with exactly the same splitter used for Steps
 * and checking whether the counts line up. Identical counts (and more than one
 * item) is a deliberate 1:1 list; anything else is treated as case-level, which
 * is the safe default because it cannot manufacture a failure on an early step.
 */
export interface ExpectationPlan {
  /**
   * Expectation to assert immediately after step i, or null when this case has
   * no per-step expectation and only the case-level one applies.
   */
  perStep: (string | null)[];
  /**
   * Expectation describing the end state of the whole case. Asserted after the
   * final step. Empty when every expectation was consumed per-step.
   */
  caseLevel: string;
  /** Which convention was detected — surfaced in the run log, not inferred twice. */
  mode: 'per-step' | 'case-level' | 'none';
}

export function planExpectations(steps: string[], expectedRaw: string): ExpectationPlan {
  const expected = String(expectedRaw ?? '').trim();
  const stepCount = steps.length;

  if (!expected) {
    return { perStep: new Array(stepCount).fill(null), caseLevel: '', mode: 'none' };
  }

  const items = splitSheetList(expected);

  // A 1:1 list only when the author actually enumerated one per step. A single
  // item is never treated as per-step even for a one-step case: there is no
  // enumeration to honour, and 'case-level' asserts it at the same point anyway.
  if (items.length > 1 && items.length === stepCount) {
    return { perStep: items, caseLevel: '', mode: 'per-step' };
  }

  return { perStep: new Array(stepCount).fill(null), caseLevel: expected, mode: 'case-level' };
}
