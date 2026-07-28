'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { runQaTestExecution } from '@/lib/qa/engine';
import { runWebTestExecution } from '@/lib/qa/web-engine';
import { runUploadedTestExecution } from '@/lib/qa/uploadedEngine';
import { runAndroidDeviceExecution } from '@/lib/qa/android-engine';
import { listDevices, isPackageInstalled } from '@/lib/qa/adb';
import { parseTestCaseFile } from '@/lib/qa/testCaseParser';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { DEFAULT_SMOKE_MODULES } from '@/lib/qa/modules';
import { PLATFORM_BY_SOURCE } from '@/lib/qa/app-upload';
import { nextRunNumber } from '@/lib/qa/run-number';
import type { QaSourceType } from '@/lib/types';

export async function startTestExecution(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const sourceType = String(formData.get('sourceType') ?? '') as QaSourceType;
  const sourceRef = String(formData.get('sourceRef') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || sourceRef.split('/').filter(Boolean).pop() || 'Untitled App';
  const buildVersion = String(formData.get('buildVersion') ?? '').trim() || '1.0.0';
  const modulesRaw = formData.getAll('modules').map(String);
  const modules = modulesRaw.length > 0 ? modulesRaw : DEFAULT_SMOKE_MODULES;

  if (!sourceType || !PLATFORM_BY_SOURCE[sourceType]) return { error: 'Select a valid source type.' };
  if (!sourceRef) return { error: 'Provide a file name or URL for the app under test.' };

  await connectToDatabase();

  const project = await QaProject.create({
    userId: user.id,
    name,
    sourceType,
    sourceRef,
    platform: PLATFORM_BY_SOURCE[sourceType],
  });

  const runNumber = await nextRunNumber(user.id);

  const run = await QaTestRun.create({
    userId: user.id,
    projectId: project._id,
    modules,
    status: 'queued',
    runNumber,
    runName: `${name} Run #${runNumber}`,
    buildVersion,
    executedByName: user.fullName || user.email,
  });

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.start', entity: 'qa_test_run', entityId: String(run._id), meta: { name, modules },
  });

  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null }>();
  const apiKey = dbUser?.qaOpenRouterApiKey ?? null;

  const isRealBrowserTarget = PLATFORM_BY_SOURCE[sourceType] === 'web' && /^https?:\/\//i.test(sourceRef);

  // Fire-and-forget; the client polls the run for live status. Web URLs get a real
  // headless-Chromium execution; there's no real device farm for mobile/store sources,
  // so those stay on the honestly-labeled simulated engine.
  const execution = isRealBrowserTarget
    ? runWebTestExecution(String(run._id))
    : runQaTestExecution(String(run._id), apiKey);
  execution.catch((e) => console.error('QA execution error', e));

  revalidatePath('/qa');
  revalidatePath('/qa/test-execution');
  return { runId: String(run._id) };
}

/**
 * Starts a real-device run against an app ALREADY INSTALLED on a connected
 * device. Nothing is uploaded: the project records the package name and leaves
 * `binaryPath` null, and the Android engine attaches to the installed package
 * instead of installing one.
 *
 * `resetAppData` is opt-in and defaults to false — clearing data on an app that
 * lives on someone's own device destroys their real logins/photos/downloads.
 */
export async function startInstalledAppExecution(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const packageName = String(formData.get('packageName') ?? '').trim();
  const requestedSerial = String(formData.get('deviceId') ?? '').trim();
  const versionName = String(formData.get('appVersionName') ?? '').trim() || null;
  const resetAppData = String(formData.get('resetAppData') ?? '') === 'on';
  const modulesRaw = formData.getAll('modules').map(String);
  const modules = modulesRaw.length > 0 ? modulesRaw : DEFAULT_SMOKE_MODULES;
  const name = String(formData.get('name') ?? '').trim() || packageName;

  if (!packageName || !/^[A-Za-z][\w.]*$/.test(packageName)) {
    return { error: 'Select an installed app to test.' };
  }

  // The device must still be attached, and the serial must be one we can see —
  // never pass an unvalidated string through to adb.
  const online = (await listDevices()).filter((d) => d.status === 'online');
  if (online.length === 0) {
    return { error: 'No device is connected. Connect a device with USB debugging enabled and try again.' };
  }
  const target = requestedSerial ? online.find((d) => d.id === requestedSerial) : online[0];
  if (!target) return { error: 'That device is no longer connected. Reload the device list and try again.' };

  if (!(await isPackageInstalled(target.id, packageName))) {
    return { error: `"${packageName}" is not installed on ${target.name}. Reload the installed apps list.` };
  }

  await connectToDatabase();

  const project = await QaProject.create({
    userId: user.id,
    name,
    sourceType: 'installed_app',
    sourceRef: packageName,
    platform: 'android',
    appPackageName: packageName,
    appVersionName: versionName,
    // No binary is uploaded — the engine attaches to the installed package.
    binaryPath: null,
  });

  const runNumber = await nextRunNumber(user.id);

  const run = await QaTestRun.create({
    userId: user.id,
    projectId: project._id,
    modules,
    status: 'queued',
    engineMode: 'real_device',
    runNumber,
    runName: `${name} Run #${runNumber}`,
    buildVersion: versionName || '1.0.0',
    executedByName: user.fullName || user.email,
    resetAppData,
  });

  await ActivityLog.create({
    userId: user.id,
    action: 'qa.run.start',
    entity: 'qa_test_run',
    entityId: String(run._id),
    meta: { name, modules, engine: 'real_device', source: 'installed_app', packageName, resetAppData },
  });

  runAndroidDeviceExecution(String(run._id), target.id)
    .catch((e) => console.error('QA installed-app execution error', e));

  revalidatePath('/qa');
  revalidatePath('/qa/test-execution');
  return { runId: String(run._id) };
}

export async function startUploadedTestExecution(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  const sourceType = String(formData.get('sourceType') ?? '') as QaSourceType;
  const sourceRef = String(formData.get('sourceRef') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || sourceRef.split('/').filter(Boolean).pop() || 'Untitled App';
  const buildVersion = String(formData.get('buildVersion') ?? '').trim() || '1.0.0';
  const file = formData.get('testCaseFile') as File | null;

  if (!sourceType || !PLATFORM_BY_SOURCE[sourceType]) return { error: 'Select a valid source type.' };
  if (!sourceRef) return { error: 'Provide a file name or URL for the app under test.' };
  if (!file || file.size === 0) return { error: 'Upload a test case file (.xlsx or .csv).' };

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
    return { error: 'Only .xlsx, .xls, or .csv test case files are supported.' };
  }

  let parsedCases;
  try {
    parsedCases = await parseTestCaseFile(file);
  } catch {
    return { error: 'Could not read the uploaded file. Confirm it is a valid Excel or CSV file.' };
  }
  if (parsedCases.length === 0) {
    return { error: 'No test cases were found in the uploaded file. Check the column headers and try again.' };
  }

  await connectToDatabase();

  const project = await QaProject.create({
    userId: user.id,
    name,
    sourceType,
    sourceRef,
    platform: PLATFORM_BY_SOURCE[sourceType],
  });

  const runNumber = await nextRunNumber(user.id);

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

  await QaUploadedTestCase.insertMany(parsedCases.map((tc, index) => ({
    runId: run._id,
    order: index,
    ...tc,
  })));

  await ActivityLog.create({
    userId: user.id, action: 'qa.run.start.uploaded', entity: 'qa_test_run', entityId: String(run._id), meta: { name, count: parsedCases.length },
  });

  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null }>();
  const apiKey = dbUser?.qaOpenRouterApiKey ?? null;

  runUploadedTestExecution(String(run._id), apiKey).catch((e) => console.error('QA uploaded execution error', e));

  revalidatePath('/qa');
  revalidatePath('/qa/test-case-execution');
  return { runId: String(run._id) };
}

export async function saveQaApiKey(apiKey: string, tier: 'free' | 'paid') {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };

  await connectToDatabase();
  await User.findByIdAndUpdate(user.id, {
    qaOpenRouterApiKey: apiKey.trim() || null,
    qaApiKeyTier: apiKey.trim() ? tier : null,
  });

  revalidatePath('/qa/settings');
  return { ok: true };
}
