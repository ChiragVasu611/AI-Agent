'use server';

import { requireWorkspaceAction } from '@/lib/auth/require-workspace';
import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestCaseSheet } from '@/lib/mongodb/models/QaTestCaseSheet';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { parseTestCaseFile } from '@/lib/qa/testCaseParser';
import { serializeDoc } from '@/lib/mongodb/serialize';

/**
 * Ownership-checked fetch — every mutation below goes through this. Not
 * async: returns the query itself so callers can chain `.lean()` for reads
 * or await it directly for a mutable document.
 */
function loadOwnedSheet(userId: string, sheetId: string) {
  return QaTestCaseSheet.findOne({ _id: sheetId, userId });
}

export async function uploadTestCaseSheet(formData: FormData) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  const file = formData.get('file') as File | null;
  const sheetName = String(formData.get('sheetName') ?? '').trim();
  const projectName = String(formData.get('projectName') ?? '').trim();
  const applicationName = String(formData.get('applicationName') ?? '').trim();
  const platformRaw = String(formData.get('platform') ?? '').trim();
  const platform = (['android', 'ios', 'web'] as const).includes(platformRaw as never) ? platformRaw : null;

  if (!platform) return { error: 'Select which application type this sheet belongs to (Android, iOS, or Web).' };
  if (!file || file.size === 0) return { error: 'Choose an Excel or CSV file to upload.' };
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
    return { error: 'Only .xlsx, .xls, or .csv files are supported.' };
  }

  let parsed;
  try {
    parsed = await parseTestCaseFile(file);
  } catch {
    return { error: 'Could not read the uploaded file. Confirm it is a valid Excel or CSV file.' };
  }
  if (parsed.length === 0) {
    return { error: 'No test cases were found in the uploaded file. Check the column headers and try again.' };
  }

  await connectToDatabase();

  const primaryModule = parsed.find((r) => r.module && r.module !== 'General')?.module ?? parsed[0]?.module ?? '';

  const sheet = await QaTestCaseSheet.create({
    userId: user.id,
    sheetName: sheetName || file.name.replace(/\.(xlsx|xls|csv)$/i, ''),
    platform,
    projectName,
    applicationName,
    module: primaryModule,
    uploadedByName: user.fullName || user.email,
    originalFileName: file.name,
    originalFormat: lower.endsWith('.csv') ? 'csv' : 'xlsx',
    versions: [{
      version: 'v1.0',
      versionNumber: 1,
      rows: parsed,
      totalTestCases: parsed.length,
      note: 'Initial upload',
    }],
    currentVersionIndex: 0,
  });

  await ActivityLog.create({
    userId: user.id, action: 'qa.sheet.upload', entity: 'qa_test_case_sheet', entityId: String(sheet._id),
    meta: { sheetName: sheet.sheetName, count: parsed.length },
  });

  revalidatePath('/qa/test-case-execution');
  return { ok: true, sheetId: String(sheet._id) };
}

export async function getTestCaseSheet(sheetId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId).lean();
  if (!sheet) return { error: 'Sheet not found.' };

  return { ok: true, sheet: serializeDoc(sheet) };
}

/**
 * Auto-save: overwrites the rows of the CURRENT version in place. This is
 * deliberately non-versioning — the user is still actively editing this
 * version; `saveAsNewVersion` is the explicit action that promotes a snapshot
 * into permanent history.
 */
export async function updateSheetRows(sheetId: string, rows: unknown[]) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId);
  if (!sheet) return { error: 'Sheet not found.' };

  const idx = sheet.currentVersionIndex ?? sheet.versions.length - 1;
  if (!sheet.versions[idx]) return { error: 'Current version not found.' };

  sheet.versions[idx].rows = rows as never;
  sheet.versions[idx].totalTestCases = rows.length;
  sheet.markModified(`versions.${idx}.rows`);
  await sheet.save();

  revalidatePath('/qa/test-case-execution');
  return { ok: true, savedAt: new Date().toISOString() };
}

function bumpVersion(current: string): string {
  const m = current.match(/^v(\d+)\.(\d+)$/i);
  if (!m) return 'v1.1';
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

/** Explicitly promote the current working rows into permanent version history. */
export async function saveAsNewVersion(sheetId: string, rows: unknown[], note: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId);
  if (!sheet) return { error: 'Sheet not found.' };

  const last = sheet.versions[sheet.versions.length - 1];
  const nextVersionNumber = (last?.versionNumber ?? 0) + 1;
  const nextLabel = bumpVersion(last?.version ?? 'v1.0');

  sheet.versions.push({
    version: nextLabel,
    versionNumber: nextVersionNumber,
    rows: rows as never,
    totalTestCases: rows.length,
    note: note || '',
    createdAt: new Date(),
  } as never);
  sheet.currentVersionIndex = sheet.versions.length - 1;
  await sheet.save();

  await ActivityLog.create({
    userId: user.id, action: 'qa.sheet.new_version', entity: 'qa_test_case_sheet', entityId: sheetId,
    meta: { version: nextLabel },
  });

  revalidatePath('/qa/test-case-execution');
  return { ok: true, version: nextLabel, versionIndex: sheet.currentVersionIndex };
}

/** Point `currentVersionIndex` at an older snapshot — nothing is deleted. */
export async function restoreSheetVersion(sheetId: string, versionIndex: number) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId);
  if (!sheet) return { error: 'Sheet not found.' };
  if (!sheet.versions[versionIndex]) return { error: 'That version does not exist.' };

  sheet.currentVersionIndex = versionIndex;
  await sheet.save();

  await ActivityLog.create({
    userId: user.id, action: 'qa.sheet.restore_version', entity: 'qa_test_case_sheet', entityId: sheetId,
    meta: { version: sheet.versions[versionIndex].version },
  });

  revalidatePath('/qa/test-case-execution');
  return { ok: true, version: sheet.versions[versionIndex].version };
}

export async function duplicateTestCaseSheet(sheetId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const original = await loadOwnedSheet(user.id, sheetId).lean<any>();
  if (!original) return { error: 'Sheet not found.' };

  const copy = await QaTestCaseSheet.create({
    userId: user.id,
    sheetName: `${original.sheetName} (Copy)`,
    platform: original.platform,
    projectName: original.projectName,
    applicationName: original.applicationName,
    module: original.module,
    uploadedByName: user.fullName || user.email,
    originalFileName: original.originalFileName,
    originalFormat: original.originalFormat,
    versions: original.versions,
    currentVersionIndex: original.currentVersionIndex,
  });

  revalidatePath('/qa/test-case-execution');
  return { ok: true, sheetId: String(copy._id) };
}

export async function deleteTestCaseSheet(sheetId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId);
  if (!sheet) return { error: 'Sheet not found.' };

  await QaTestCaseSheet.deleteOne({ _id: sheetId });

  await ActivityLog.create({
    userId: user.id, action: 'qa.sheet.deleted', entity: 'qa_test_case_sheet', entityId: sheetId,
    meta: { sheetName: sheet.sheetName },
  });

  revalidatePath('/qa/test-case-execution');
  return { ok: true };
}

export async function toggleSheetFavorite(sheetId: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const user = gate.user;

  await connectToDatabase();
  const sheet = await loadOwnedSheet(user.id, sheetId);
  if (!sheet) return { error: 'Sheet not found.' };

  sheet.isFavorite = !sheet.isFavorite;
  await sheet.save();

  revalidatePath('/qa/test-case-execution');
  return { ok: true, isFavorite: sheet.isFavorite };
}

