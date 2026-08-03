'use client';

/**
 * Client-side preview only — reads the uploaded test case sheet in the
 * browser purely to show a live preview (row/column counts, header mapping,
 * detected modules) before submission. The actual parsing that drives
 * execution still happens server-side in lib/qa/testCaseParser.ts; this file
 * never affects what gets executed, it only mirrors the same header aliases
 * so the preview reflects reality.
 */

import {
  TEST_CASE_ID_ALIASES, MODULE_ALIASES, FEATURE_ALIASES, SCENARIO_ALIASES,
  PRECONDITIONS_ALIASES, STEPS_ALIASES, TEST_DATA_ALIASES, EXPECTED_RESULT_ALIASES,
  PRIORITY_ALIASES, SEVERITY_ALIASES, normalizeHeader as normalize,
} from '@/lib/qa/sheet-header-aliases';

const HEADER_ALIASES: Record<string, string[]> = {
  'Test Case ID': TEST_CASE_ID_ALIASES,
  Module: MODULE_ALIASES,
  Feature: FEATURE_ALIASES,
  'Test Scenario': SCENARIO_ALIASES,
  Preconditions: PRECONDITIONS_ALIASES,
  'Test Steps': STEPS_ALIASES,
  'Test Data': TEST_DATA_ALIASES,
  'Expected Result': EXPECTED_RESULT_ALIASES,
  Priority: PRIORITY_ALIASES,
  Severity: SEVERITY_ALIASES,
};

export interface SheetPreview {
  headers: string[];
  headerMapping: Array<{ column: string; mapsTo: string | null }>;
  rows: string[][];
  totalRows: number;
  modules: string[];
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
