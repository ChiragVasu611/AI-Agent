import * as XLSX from 'xlsx';

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
  testCaseId: ['test case id', 'testcaseid', 'tc id', 'tcid', 'case id', 'id'],
  module: ['module'],
  feature: ['feature'],
  scenario: ['test scenario', 'scenario', 'test case', 'title', 'description'],
  preconditions: ['preconditions', 'precondition', 'pre-conditions'],
  steps: ['test steps', 'steps', 'test step', 'step'],
  testData: ['test data', 'data', 'testdata'],
  expectedResult: ['expected result', 'expected', 'expected outcome'],
  priority: ['priority'],
  severity: ['severity'],
};

function normalizeHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function splitSteps(raw: string): string[] {
  if (!raw) return [];
  const text = String(raw);
  const lines = text
    .split(/\r?\n|(?=\d+[.)]\s)/)
    .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [text.trim()].filter(Boolean);
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

  const headerMap = buildHeaderMap(rows[0]);
  const cases: ParsedTestCase[] = [];

  for (let i = 1; i < rows.length; i++) {
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
