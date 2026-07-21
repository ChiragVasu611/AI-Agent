import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { buildsRoot, installAndLaunch, GENERATED_PACKAGE, type RunTarget } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

/** (Re)installs and launches a built project's APK on the chosen target. */
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

  const apkPath = path.join(buildsRoot(), projectId, 'app/build/app/outputs/flutter-apk/app-debug.apk');
  try {
    await fs.access(apkPath);
  } catch {
    return NextResponse.json({ error: 'No APK has been built for this project yet.' }, { status: 409 });
  }

  const result = await installAndLaunch(apkPath, GENERATED_PACKAGE, { target, serial });

  project.emulatorStatus = result.status;
  project.runSerial = result.serial;
  project.runTarget = target;
  await project.save();

  return NextResponse.json({ result });
}
