import { Schema } from 'mongoose';
import { defineModel } from '@/lib/mongodb/define-model';

const qaTestRunSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },
  modules: { type: [String], default: [] },
  status: { type: String, enum: ['queued', 'running', 'passed', 'failed', 'partial', 'cancelled'], default: 'queued', index: true },
  progress: { type: Number, default: 0 },
  sourceMode: { type: String, enum: ['catalog', 'uploaded'], default: 'catalog' },
  engineMode: { type: String, enum: ['real_browser', 'real_device', 'simulated'], default: 'simulated' },

  runNumber: { type: Number, required: true, index: true },
  runName: { type: String, default: '' },
  buildVersion: { type: String, default: '1.0.0' },
  executedByName: { type: String, default: '' },

  currentSuite: { type: String, default: null },
  currentCase: { type: String, default: null },
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
