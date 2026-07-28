import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runQaTestExecution } from '@/lib/qa/engine';
import { runUploadedTestExecution } from '@/lib/qa/uploadedEngine';
import { runAndroidDeviceExecution } from '@/lib/qa/android-engine';
import { parseTestCaseFile } from '@/lib/qa/testCaseParser';
import { DEFAULT_SMOKE_MODULES } from '@/lib/qa/modules';
import { PLATFORM_BY_SOURCE, BINARY_SOURCE_TYPES, handleAppFileUpload } from '@/lib/qa/app-upload';
import { firstOnlineDevice, listDevices } from '@/lib/qa/adb';
import { nextRunNumber } from '@/lib/qa/run-number';
import type { QaSourceType } from '@/lib/types';

/**
 * Starts a Test Execution / AI Test Case Execution run for a real uploaded
 * APK/AAB/IPA binary. This is a Route Handler rather than a Server Action
 * specifically because this Next.js version hard-caps Server Action request
 * bodies at 1MB with no way to configure it — far too small for a real app
 * binary. Route Handlers have no such limit. Text/URL-based sources (web,
 * store links, etc.) are unaffected and continue through the original
 * startTestExecution/startUploadedTestExecution server actions.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error('QA start-binary: failed to parse multipart body', e);
    return NextResponse.json(
      { error: 'Could not read the uploaded file. It may be too large or the upload was interrupted.' },
      { status: 400 },
    );
  }

  const mode = String(formData.get('mode') ?? 'catalog');
  const sourceType = String(formData.get('sourceType') ?? '') as QaSourceType;
  const buildVersion = String(formData.get('buildVersion') ?? '').trim() || '1.0.0';

  if (!sourceType || !BINARY_SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: `This endpoint only accepts APK, AAB, or IPA uploads (received sourceType="${sourceType || 'none'}").` }, { status: 400 });
  }

  const upload = await handleAppFileUpload(sourceType, formData);
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: 400 });
  }

  const name = String(formData.get('name') ?? '').trim() || upload.appInfo.appDisplayName || upload.sourceRef;

  let project;
  let runNumber: number;
  let apiKey: string | null;
  try {
    await connectToDatabase();

    project = await QaProject.create({
      userId: user.id,
      name,
      sourceType,
      sourceRef: upload.sourceRef,
      platform: PLATFORM_BY_SOURCE[sourceType],
      binaryPath: upload.binaryPath,
      ...upload.appInfo,
    });

    runNumber = await nextRunNumber(user.id);

    const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null }>();
    apiKey = dbUser?.qaOpenRouterApiKey ?? null;
  } catch (e) {
    console.error('QA start-binary: database error while creating project/run', e);
    try {
      const { appendFileSync } = await import('fs');
      const { join } = await import('path');
      appendFileSync(join(process.cwd(), 'qa-upload-debug.log'), `[${new Date().toISOString()}] DB error: ${(e as Error)?.message}\n${(e as Error)?.stack ?? ''}\n\n`);
    } catch { /* ignore */ }
    return NextResponse.json(
      { error: `Could not save the run to the database: ${(e as Error)?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  if (mode === 'uploaded') {
    const testCaseFile = formData.get('testCaseFile') as File | null;
    if (!testCaseFile || testCaseFile.size === 0) {
      return NextResponse.json({ error: 'Upload a test case file (.xlsx or .csv).' }, { status: 400 });
    }
    const lowerName = testCaseFile.name.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
      return NextResponse.json({ error: 'Only .xlsx, .xls, or .csv test case files are supported.' }, { status: 400 });
    }

    let parsedCases;
    try {
      parsedCases = await parseTestCaseFile(testCaseFile);
    } catch {
      return NextResponse.json({ error: 'Could not read the uploaded test case file. Confirm it is a valid Excel or CSV file.' }, { status: 400 });
    }
    if (parsedCases.length === 0) {
      return NextResponse.json({ error: 'No test cases were found in the uploaded file. Check the column headers and try again.' }, { status: 400 });
    }

    const run = await QaTestRun.create({
      userId: user.id,
      projectId: project._id,
      modules: [],
      sourceMode: 'uploaded',
      status: 'queued',
      runNumber,
      runName: `${name} Run #${runNumber}`,
      buildVersion,
      executedByName: user.fullName || user.email,
      totalCases: parsedCases.length,
    });

    await QaUploadedTestCase.insertMany(parsedCases.map((tc, index) => ({ runId: run._id, order: index, ...tc })));

    await ActivityLog.create({
      userId: user.id, action: 'qa.run.start.uploaded', entity: 'qa_test_run', entityId: String(run._id), meta: { name, count: parsedCases.length },
    });

    runUploadedTestExecution(String(run._id), apiKey).catch((e) => console.error('QA uploaded execution error', e));
    return NextResponse.json({ runId: String(run._id) });
  }

  const modulesRaw = formData.getAll('modules').map(String);
  const modules = modulesRaw.length > 0 ? modulesRaw : DEFAULT_SMOKE_MODULES;

  // Decide whether this run can execute on a REAL connected Android device.
  // Only a genuine .apk can be installed directly via `adb install` (an .aab
  // needs bundletool), so real-device execution is limited to APKs with a
  // stored binary and at least one online device.
  const requestedDeviceId = String(formData.get('deviceId') ?? '').trim();
  let targetSerial: string | null = null;
  if (sourceType === 'apk' && upload.binaryPath) {
    try {
      if (requestedDeviceId && requestedDeviceId !== 'simulated') {
        const online = (await listDevices()).find((d) => d.id === requestedDeviceId && d.status === 'online');
        targetSerial = online?.id ?? null;
      } else if (requestedDeviceId !== 'simulated') {
        const online = await firstOnlineDevice();
        targetSerial = online?.id ?? null;
      }
    } catch (e) {
      console.error('QA start-binary: device lookup failed, falling back to simulated', e);
    }
  }

  const run = await QaTestRun.create({
    userId: user.id,
    projectId: project._id,
    modules,
    status: 'queued',
    engineMode: targetSerial ? 'real_device' : 'simulated',
    runNumber,
    runName: `${name} Run #${runNumber}`,
    buildVersion,
    executedByName: user.fullName || user.email,
  });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.start', entity: 'qa_test_run', entityId: String(run._id), meta: { name, modules, engine: targetSerial ? 'real_device' : 'simulated' },
  });

  if (targetSerial) {
    // Real device: install + launch + capture genuine screenshots + logcat crash scan.
    runAndroidDeviceExecution(String(run._id), targetSerial).catch((e) => console.error('QA real-device execution error', e));
  } else {
    // No connected device (or non-APK) — fall back to the simulated engine.
    runQaTestExecution(String(run._id), apiKey).catch((e) => console.error('QA execution error', e));
  }

  return NextResponse.json({ runId: String(run._id), engine: targetSerial ? 'real_device' : 'simulated' });
}
