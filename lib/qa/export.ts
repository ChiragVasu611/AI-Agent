'use client';

/** Client-side report export — CSV (native), Excel (SheetJS), PDF (jsPDF). No server round-trip, no paid service. */

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function bugsToRows(bugs: any[]): Record<string, unknown>[] {
  return bugs.map((b) => ({
    'Bug ID': b.bugNumber,
    Title: b.title,
    Category: b.type,
    Module: b.module,
    Feature: b.feature,
    'Test Case ID': b.testCaseId,
    'Failed Step': b.failedStepNumber ?? '',
    Severity: b.severity,
    Priority: b.priority,
    Screen: b.screenName,
    'Expected Result': b.expectedResult,
    'Actual Result': b.actualResult,
    'Device Info': b.deviceInfo,
    'OS Version': b.osVersion,
    'App Version': b.appVersion,
    'AI Root Cause': b.aiRootCause,
    'Suggested Fix': b.suggestedFix,
  }));
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    downloadBlob(filename, new Blob(['No data'], { type: 'text/csv' }));
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ];
  downloadBlob(filename, new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
}

export async function exportExcel(filename: string, rows: Record<string, unknown>[], sheetName = 'Report') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export async function exportPdf(filename: string, title: string, subtitle: string, rows: Record<string, unknown>[]) {
  const { default: jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTable = (autoTableModule as any).default ?? autoTableModule;

  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(subtitle, 14, 22);

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    autoTable(doc, {
      startY: 28,
      head: [headers],
      body: rows.map((r) => headers.map((h) => String(r[h] ?? ''))),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229] },
    });
  } else {
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text('No data for this report.', 14, 32);
  }

  doc.save(filename);
}
