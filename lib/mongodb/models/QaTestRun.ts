import { Schema } from 'mongoose';
import { defineModel } from '@/lib/mongodb/define-model';

const qaTestRunSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },
  modules: { type: [String], default: [] },
  status: { type: String, enum: ['queued', 'running', 'passed', 'failed', 'partial', 'cancelled'], default: 'queued', index: true },
  progress: { type: Number, default: 0 },
  sourceMode: { type: String, enum: ['catalog', 'uploaded'], default: 'catalog' },
  // 'blocked_no_runtime' = the artifact type has no executor attached (e.g. an
  // APK with no Appium/device farm), so the run reported BLOCKED instead of
  // inventing pass/fail results.
  engineMode: { type: String, enum: ['real_browser', 'real_device', 'simulated', 'blocked_no_runtime'], default: 'simulated' },
  // Serial of the device chosen on QA → Devices. A preference, not a hard
  // requirement: if it is no longer attached the engine falls back to any
  // authorized device and says so in the run log.
  deviceSerial: { type: String, default: null },
  // Live-preview fields: what the current step expected, what was actually
  // observed, and whether it passed — surfaced during execution, not just in
  // the final report.
  currentExpected: { type: String, default: '' },
  currentActual: { type: String, default: '' },
  currentStepStatus: { type: String, enum: ['running', 'pass', 'fail', 'blocked', 'skipped'], default: 'running' },
  /**
   * Which step within the current test case these live values describe. Paired
   * with the same field on QaScreenshot so the Live Device panel can tell
   * whether the frame on screen is the one the text is talking about, instead of
   * silently rendering a frame from the previous step beside the current step's
   * expected/actual.
   */
  currentStepNumber: { type: Number, default: null },

  runNumber: { type: Number, required: true, index: true },
  runName: { type: String, default: '' },
  buildVersion: { type: String, default: '1.0.0' },
  executedByName: { type: String, default: '' },

  currentSuite: { type: String, default: null },
  currentCase: { type: String, default: null },
  // The sheet's own columns, kept as their own fields rather than concatenated
  // into `currentCase`. Live Tracking has to label the Module, the Test Case ID
  // and the Test Case separately, which a single "TC-001: scenario" string
  // cannot be split back into reliably (scenarios contain colons).
  currentModule: { type: String, default: null },
  currentTestCaseId: { type: String, default: null },
  currentScenario: { type: String, default: null },
  currentStep: { type: String, default: null },
  currentScreen: { type: String, default: null },
  currentFeature: { type: String, default: null },
  currentDevice: { type: String, default: null },

  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  estimatedSeconds: { type: Number, default: null },

  totalCases: { type: Number, default: 0 },
  passedCases: { type: Number, default: 0 },
  failedCases: { type: Number, default: 0 },
  blockedCases: { type: Number, default: 0 },
  skippedCases: { type: Number, default: 0 },
  etaSeconds: { type: Number, default: null },

  performanceScore: { type: Number, default: null },
  errorMessage: { type: String, default: null },

  /**
   * Opt-in for `pm clear` before an installed-app run. Defaults to FALSE because
   * wiping an app already on someone's device destroys their real data (logins,
   * photos, downloads). Uploaded-APK runs always start fresh regardless, since a
   * reinstall has no pre-existing user data worth preserving.
   */
  resetAppData: { type: Boolean, default: false },
}, { timestamps: true });

export const QaTestRun = defineModel('QaTestRun', qaTestRunSchema);
