'use client';

/**
 * Client-side preview only — reads the uploaded test case sheet in the
 * browser purely to show a live preview (row/column counts, header mapping,
 * detected modules) before submission. The actual parsing that drives
 * execution still happens server-side in lib/qa/testCaseParser.ts; this file
 * never affects what gets executed, it only mirrors the same header aliases
 * so the preview reflects reality.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  'Test Case ID': ['test case id', 'testcaseid', 'tc id', 'tcid', 'case id', 'id'],
  Module: ['module'],
  Feature: ['feature'],
  'Test Scenario': ['test scenario', 'scenario', 'test case', 'title', 'description'],
  Preconditions: ['preconditions', 'precondition', 'pre-conditions'],
  'Test Steps': ['test steps', 'steps', 'test step', 'step'],
  'Test Data': ['test data', 'data', 'testdata'],
  'Expected Result': ['expected result', 'expected', 'expected outcome'],
  Priority: ['priority'],
  Severity: ['severity'],
};

export interface SheetPreview {
  headers: string[];
  headerMapping: Array<{ column: string; mapsTo: string | null }>;
  rows: string[][];
  totalRows: number;
  modules: string[];
}

function normalize(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function parseSheetPreview(file: File): Promise<SheetPreview> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as unknown as string[][];

  // Mirror the server parser: sheets often start with a title banner or
  // metadata rows, so find the row that actually looks like column headings
  // instead of assuming row 0.
  const countMatches = (row: string[] | undefined) =>
    (row ?? []).filter((h) => {
      const norm = normalize(h);
      return Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(norm));
    }).length;

  let headerIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = countMatches(rows[i]);
    if (score > bestScore) { bestScore = score; headerIndex = i; }
  }
  if (bestScore < 2) headerIndex = 0;

  const headers = (rows[headerIndex] ?? []).map((h) => String(h ?? ''));
  const dataRows = rows.slice(headerIndex + 1).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));

  const headerMapping = headers.map((h) => {
    const norm = normalize(h);
    const match = Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(norm));
    return { column: h || '(blank)', mapsTo: match ? match[0] : null };
  });

  const moduleColIndex = headers.findIndex((h) => HEADER_ALIASES.Module.includes(normalize(h)));
  const modules = moduleColIndex >= 0
    ? Array.from(new Set(dataRows.map((r) => String(r[moduleColIndex] ?? '').trim()).filter(Boolean))).sort()
    : [];

  return {
    headers,
    headerMapping,
    rows: dataRows.slice(0, 5),
    totalRows: dataRows.length,
    modules,
  };
}
