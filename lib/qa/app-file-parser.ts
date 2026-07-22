import os from 'os';
import path from 'path';
import fs from 'fs/promises';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppInfoParser = require('app-info-parser');

export interface ParsedAppInfo {
  packageName: string | null;
  appName: string | null;
  versionName: string | null;
  versionCode: string | null;
  iconDataUrl: string | null;
}

const EMPTY_INFO: ParsedAppInfo = {
  packageName: null, appName: null, versionName: null, versionCode: null, iconDataUrl: null,
};

/**
 * Extracts real app metadata (package/bundle id, display name, version) from an
 * uploaded APK or IPA binary using app-info-parser — no AI, no external service.
 * Android App Bundles (.aab) use a protobuf-encoded manifest that this library
 * doesn't decode, so .aab uploads intentionally return empty metadata rather
 * than a guessed/fabricated result.
 */
export async function parseAppFile(buffer: Buffer, fileName: string): Promise<ParsedAppInfo> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.aab')) return EMPTY_INFO;

  const ext = lower.endsWith('.ipa') ? '.ipa' : '.apk';
  const tmpPath = path.join(os.tmpdir(), `qa-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(tmpPath, buffer);

  try {
    const parser = new AppInfoParser(tmpPath);
    const result = await parser.parse();

    if (ext === '.ipa') {
      return {
        packageName: result.CFBundleIdentifier ?? null,
        appName: result.CFBundleDisplayName ?? result.CFBundleName ?? null,
        versionName: result.CFBundleShortVersionString ?? null,
        versionCode: result.CFBundleVersion != null ? String(result.CFBundleVersion) : null,
        iconDataUrl: result.icon ? `data:image/png;base64,${result.icon}` : null,
      };
    }

    return {
      packageName: result.package ?? null,
      appName: result.application?.label ?? result.label ?? null,
      versionName: result.versionName ?? null,
      versionCode: result.versionCode != null ? String(result.versionCode) : null,
      iconDataUrl: result.icon ? `data:image/png;base64,${result.icon}` : null,
    };
  } catch {
    return EMPTY_INFO;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
