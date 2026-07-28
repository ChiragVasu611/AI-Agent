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
 * app-info-parser can return a field as an array (e.g. a localized `label`
 * appears as ['Video Downloader']) or a non-string primitive. Mongoose string
 * fields reject arrays, so every extracted value is normalized to a single
 * trimmed string (first meaningful element of an array) or null.
 */
function toStr(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = toStr(item);
      if (s) return s;
    }
    return null;
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * Detects the real image MIME type from the leading bytes of a base64 payload.
 * app-info-parser hardcodes `image/png` even when the extracted icon is
 * actually WebP/JPEG/GIF, so we sniff the magic bytes instead of trusting it.
 */
function mimeFromBase64(base64: string): string {
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp'; // RIFF container (WebP)
  if (base64.startsWith('PHN2Zy') || base64.startsWith('PD94bWw')) return 'image/svg+xml';
  return 'image/png';
}

/**
 * app-info-parser sometimes returns the icon already as a full `data:` URI
 * (e.g. `data:image/png;base64,...`) and sometimes as a bare base64 payload.
 * Blindly prefixing `data:image/png;base64,` produced a doubled, invalid URI
 * that browsers refused to render — the app logo silently disappeared. This
 * normalizes both shapes into a single valid data URI and, because the
 * parser's declared MIME is often wrong, re-derives the correct type from the
 * actual image bytes so every browser renders it.
 */
function toIconDataUrl(value: unknown): string | null {
  const raw = toStr(value);
  if (!raw) return null;
  const base64 = raw.startsWith('data:') ? (raw.split(',')[1] ?? '') : raw;
  if (!base64) return null;
  return `data:${mimeFromBase64(base64)};base64,${base64}`;
}

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
        packageName: toStr(result.CFBundleIdentifier),
        appName: toStr(result.CFBundleDisplayName) ?? toStr(result.CFBundleName),
        versionName: toStr(result.CFBundleShortVersionString),
        versionCode: toStr(result.CFBundleVersion),
        iconDataUrl: toIconDataUrl(result.icon),
      };
    }

    return {
      packageName: toStr(result.package),
      appName: toStr(result.application?.label) ?? toStr(result.label),
      versionName: toStr(result.versionName),
      versionCode: toStr(result.versionCode),
      iconDataUrl: toIconDataUrl(result.icon),
    };
  } catch {
    return EMPTY_INFO;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
