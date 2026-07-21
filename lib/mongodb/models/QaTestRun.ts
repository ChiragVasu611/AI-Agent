import { Schema, model, models } from 'mongoose';

const qaTestRunSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },
  modules: { type: [String], default: [] },
  status: { type: String, enum: ['queued', 'running', 'passed', 'failed', 'partial', 'cancelled'], default: 'queued', index: true },
  progress: { type: Number, default: 0 },

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

  performanceScore: { type: Number, default: null },
  errorMessage: { type: String, default: null },
}, { timestamps: true });

export const QaTestRun = models.QaTestRun ?? model('QaTestRun', qaTestRunSchema);
