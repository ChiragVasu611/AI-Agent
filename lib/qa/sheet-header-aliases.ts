/**
 * Column-header vocabulary shared between the server-side parser
 * (testCaseParser.ts, what actually drives execution) and the client-side
 * upload preview (sheet-preview.ts, what the user sees before saving).
 *
 * These used to be two independently-maintained copies of the same list, and
 * they silently drifted apart: the server parser's `module` alias only
 * matched a column literally named "module", so a real sheet using "Module
 * Name" (an entirely ordinary column title) fell back to a single "General"
 * bucket for every row, and `expectedResult` only matched the singular
 * "Expected Result", so a sheet using "Expected Results" left every case with
 * nothing to assert against. A single shared list is what makes that class of
 * bug impossible to reintroduce by editing only one of the two copies.
 */

export const TEST_CASE_ID_ALIASES = ['test case id', 'testcaseid', 'tc id', 'tcid', 'case id', 'case no', 'test case no', 'id'];
export const MODULE_ALIASES = ['module', 'module name', 'test module'];
export const FEATURE_ALIASES = ['feature', 'feature name'];
export const SCENARIO_ALIASES = ['test scenario', 'scenario', 'test case', 'test case name', 'title', 'description'];
export const PRECONDITIONS_ALIASES = ['preconditions', 'precondition', 'pre-conditions'];
export const STEPS_ALIASES = ['test steps', 'steps', 'test step', 'step'];
export const TEST_DATA_ALIASES = ['test data', 'data', 'testdata'];
// "Result(s)" varies by author — the plural form previously matched nothing,
// so `expectedResult` came back empty and every case was unverifiable
// regardless of what actually happened on screen.
export const EXPECTED_RESULT_ALIASES = ['expected result', 'expected results', 'expected', 'expected outcome', 'expected behaviour', 'expected behavior'];
export const PRIORITY_ALIASES = ['priority'];
export const SEVERITY_ALIASES = ['severity'];

export function normalizeHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
