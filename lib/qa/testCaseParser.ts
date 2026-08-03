import * as XLSX from 'xlsx';
import {
  TEST_CASE_ID_ALIASES, MODULE_ALIASES, FEATURE_ALIASES, SCENARIO_ALIASES,
  PRECONDITIONS_ALIASES, STEPS_ALIASES, TEST_DATA_ALIASES, EXPECTED_RESULT_ALIASES,
  PRIORITY_ALIASES, SEVERITY_ALIASES, normalizeHeader,
} from '@/lib/qa/sheet-header-aliases';

export interface ParsedTestCase {
  testCaseId: string;
  module: string;
  feature: string;
  scenario: string;
  preconditions: string;
  steps: string[];
  testData: string;
  expectedResult: string;
  priority: string;
  severity: string;
}

const HEADER_ALIASES: Record<keyof Omit<ParsedTestCase, 'steps'> | 'steps', string[]> = {
  testCaseId: TEST_CASE_ID_ALIASES,
  module: MODULE_ALIASES,
  feature: FEATURE_ALIASES,
  scenario: SCENARIO_ALIASES,
  preconditions: PRECONDITIONS_ALIASES,
  steps: STEPS_ALIASES,
  testData: TEST_DATA_ALIASES,
  expectedResult: EXPECTED_RESULT_ALIASES,
  priority: PRIORITY_ALIASES,
  severity: SEVERITY_ALIASES,
};

/**
 * Locate the real header row.
 *
 * Sheets exported from test-management tools routinely begin with a title
 * banner ("Keep My Notes - Android"), a blank spacer, or release metadata
 * before the actual column headings. Assuming row 0 is the header silently
 * maps nothing — every row then parses with no steps and no expected result,
 * which looks like a run that executed and passed but in fact executed nothing.
 *
 * Scans the first few rows and picks whichever matches the most known columns.
 */
function findHeaderRow(rows: unknown[][]): number {
  const LOOK_AHEAD = Math.min(rows.length, 15);
  let bestIndex = 0;
  let bestScore = 0;

  for (let i = 0; i < LOOK_AHEAD; i++) {
    const score = buildHeaderMap(rows[i]).size;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // Need at least two recognised columns to trust a row as the header.
  return bestScore >= 2 ? bestIndex : 0;
}

function buildHeaderMap(headerRow: unknown[]): Map<number, keyof ParsedTestCase> {
  const map = new Map<number, keyof ParsedTestCase>();
  headerRow.forEach((raw, idx) => {
    const norm = normalizeHeader(String(raw));
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm)) {
        map.set(idx, field as keyof ParsedTestCase);
        break;
      }
    }
  });
  return map;
}

/**
 * Split one sheet cell into an ordered list of items.
 *
 * Authors write a multi-item cell as newline-separated lines, as "1. … 2. …" on
 * a single line, or both. Exported because the Expected Results column uses the
 * SAME convention as Steps, and the two must be split identically or a 1:1
 * pairing between them cannot be trusted (see lib/qa/expected-results.ts).
 */
export function splitSheetList(raw: string): string[] {
  if (!raw) return [];
  const text = String(raw);
  const lines = text
    .split(/\r?\n|(?=\d+[.)]\s)/)
    .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [text.trim()].filter(Boolean);
}

function splitSteps(raw: string): string[] {
  return splitSheetList(raw);
}

export async function parseTestCaseFile(file: File): Promise<ParsedTestCase[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const isCsv = file.name.toLowerCase().endsWith('.csv');

  const workbook = isCsv
    ? XLSX.read(buffer.toString('utf-8'), { type: 'string' })
    : XLSX.read(buffer, { type: 'buffer' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (rows.length < 2) return [];

  // Skip any title/metadata banner above the real column headings.
  const headerIndex = findHeaderRow(rows);
  const headerMap = buildHeaderMap(rows[headerIndex]);
  const cases: ParsedTestCase[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;

    const record: Record<string, string> = {};
    headerMap.forEach((field, idx) => {
      record[field] = String(row[idx] ?? '').trim();
    });

    const scenario = record.scenario || record.testCaseId || `Test case ${i}`;
    cases.push({
      testCaseId: record.testCaseId || `TC-${String(i).padStart(3, '0')}`,
      module: record.module || 'General',
      feature: record.feature || record.module || 'General',
      scenario,
      preconditions: record.preconditions || '',
      steps: splitSteps(record.steps || ''),
      testData: record.testData || '',
      expectedResult: record.expectedResult || '',
      priority: (record.priority || 'p3').toLowerCase(),
      severity: (record.severity || 'medium').toLowerCase(),
    });
  }

  return cases;
}
