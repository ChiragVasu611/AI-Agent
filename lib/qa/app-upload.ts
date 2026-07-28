import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { parseAppFile } from '@/lib/qa/app-file-parser';
import type { QaPlatform, QaSourceType } from '@/lib/types';

export const PLATFORM_BY_SOURCE: Record<QaSourceType, QaPlatform> = {
  apk: 'android',
  aab: 'android',
  play_store_url: 'android',
  ipa: 'ios',
  app_store_url: 'ios',
  flutter: 'cross_platform',
  react_native: 'cross_platform',
  hybrid: 'cross_platform',
  web_app: 'web',
  web_url: 'web',
  installed_app: 'android',
};

export const BINARY_SOURCE_TYPES = new Set<QaSourceType>(['apk', 'aab', 'ipa']);
export const BINARY_EXTENSIONS: Record<'apk' | 'aab' | 'ipa', string> = { apk: '.apk', aab: '.aab', ipa: '.ipa' };
export const MAX_APP_FILE_SIZE_MB = 500;

export interface AppInfoFields {
  appPackageName: string | null;
  appDisplayName: string | null;
  appVersionName: string | null;
  appVersionCode: string | null;
  appIconDataUrl: string | null;
  sourceFileName: string | null;
  fileSizeBytes: number | null;
}

export type AppUploadResult =
  | { ok: true; sourceRef: string; appInfo: AppInfoFields; binaryPath: string | null }
  | { ok: false; error: string };

/** Directory where uploaded APK/IPA binaries are persisted for real-device installs. */
export const QA_UPLOAD_DIR = path.join(os.tmpdir(), 'qa-app-uploads');

/**
 * Real APK/AAB/IPA binary handling — extracts genuine package/version metadata
 * via app-info-parser (see lib/qa/app-file-parser.ts). Only used from API route
 * handlers, never from a 'use server' Server Action: this Next.js version caps
 * Server Action request bodies at 1MB with no way to raise it, which is far too
 * small for a real app binary. Route Handlers have no such limit.
 */
export async function handleAppFileUpload(sourceType: QaSourceType, formData: FormData): Promise<AppUploadResult> {
  const file = formData.get('appFile') as File | null;
  const key = sourceType as 'apk' | 'aab' | 'ipa';
  if (!file || file.size === 0) {
    return { ok: false, error: `Upload an ${BINARY_EXTENSIONS[key]} file for the app under test.` };
  }
  const expectedExt = BINARY_EXTENSIONS[key];
  if (!file.name.toLowerCase().endsWith(expectedExt)) {
    return { ok: false, error: `The uploaded file must be a ${expectedExt} file to match the selected source type.` };
  }
  if (file.size > MAX_APP_FILE_SIZE_MB * 1024 * 1024) {
    return { ok: false, error: `File exceeds the ${MAX_APP_FILE_SIZE_MB}MB size limit.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseAppFile(buffer, file.name);

  // Persist the binary so a background real-device run can install it later.
  // Best-effort: if the write fails the run simply falls back to simulated.
  let binaryPath: string | null = null;
  try {
    await fs.mkdir(QA_UPLOAD_DIR, { recursive: true });
    const safeExt = expectedExt;
    const dest = path.join(QA_UPLOAD_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);
    await fs.writeFile(dest, buffer);
    binaryPath = dest;
  } catch (e) {
    console.error('QA app-upload: could not persist binary to disk', e);
  }

  return {
    ok: true,
    sourceRef: file.name,
    binaryPath,
    appInfo: {
      appPackageName: parsed.packageName,
      appDisplayName: parsed.appName,
      appVersionName: parsed.versionName,
      appVersionCode: parsed.versionCode,
      appIconDataUrl: parsed.iconDataUrl,
      sourceFileName: file.name,
      fileSizeBytes: file.size,
    },
  };
}
