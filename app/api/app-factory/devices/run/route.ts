import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import {
  buildsRoot, buildFlutterWeb, installAndLaunch, listDevices, webDirFor,
  GENERATED_PACKAGE, type RunTarget,
} from '@/lib/build/toolchain';
import { buildProfile } from '@/lib/ai/factory';
import { generateFlutterFiles } from '@/lib/ai/codegen';

export const runtime = 'nodejs';

/**
 * Runs a built project.
 *  - target 'emulator' → the dashboard virtual emulator (Flutter web preview),
 *    built on demand if it isn't ready yet. Returns a previewUrl for the iframe.
 *  - target 'real-device' / 'auto' (with a device) → adb install + launch.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId ?? '');
  const serial: string | undefined = body.serial ? String(body.serial) : undefined;
  const targetRaw = String(body.target ?? 'auto');
  const target: RunTarget = (['emulator', 'real-device', 'auto'] as const).includes(targetRaw as RunTarget)
    ? (targetRaw as RunTarget)
    : 'auto';

  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  await connectToDatabase();
  const project = await Project.findOne({ _id: projectId, userId: user.id });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const previewUrl = `/api/app-factory/preview/${projectId}/`;

  async function ensureWebPreview(): Promise<boolean> {
    if (await exists(path.join(webDirFor(projectId), 'index.html'))) return true;
    const profile = buildProfile(project.referenceUrl, project.store);
    const files = generateFlutterFiles(profile, project.referenceUrl);
    const res = await buildFlutterWeb(projectId, files);
    project.webReady = res.ok;
    await project.save();
    return res.ok;
  }

  // Virtual emulator → dashboard web preview.
  if (target === 'emulator') {
    const ok = await ensureWebPreview();
    project.emulatorStatus = ok ? 'dashboard' : 'preview-failed';
    project.runTarget = target;
    project.runSerial = null;
    await project.save();
    return NextResponse.json({
      result: {
        mode: 'web-preview',
        status: ok ? 'running-dashboard' : 'preview-unavailable',
        previewUrl: ok ? previewUrl : null,
        deviceType: 'emulator',
        serial: null,
      },
    });
  }

  // Real device path.
  const apkPath = path.join(buildsRoot(), projectId, 'app/build/app/outputs/flutter-apk/app-debug.apk');
  const apkExists = await exists(apkPath);

  if (target === 'auto') {
    const devices = await listDevices();
    const hasPhysical = devices.some((d) => d.type === 'physical');
    if (!hasPhysical) {
      // Auto with no device → fall back to the dashboard virtual emulator.
      const ok = await ensureWebPreview();
      project.emulatorStatus = ok ? 'dashboard' : 'preview-failed';
      project.runTarget = target;
      await project.save();
      return NextResponse.json({
        result: {
          mode: 'web-preview',
          status: ok ? 'running-dashboard' : 'preview-unavailable',
          previewUrl: ok ? previewUrl : null,
          deviceType: 'emulator',
          serial: null,
        },
      });
    }
  }

  if (!apkExists) {
    return NextResponse.json({ error: 'No APK has been built for this project yet.' }, { status: 409 });
  }

  const result = await installAndLaunch(apkPath, GENERATED_PACKAGE, { target, serial });
  project.emulatorStatus = result.status;
  project.runSerial = result.serial;
  project.runTarget = target;
  await project.save();

  return NextResponse.json({ result: { mode: 'device', ...result } });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
