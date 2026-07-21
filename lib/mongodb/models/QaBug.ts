import { Schema, model, models } from 'mongoose';

const qaBugSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'QaProject', required: true, index: true },
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },

  type: {
    type: String,
    enum: [
      'functional', 'ui', 'api', 'security', 'performance', 'memory', 'battery',
      'network', 'accessibility', 'compatibility', 'crash', 'anr',
    ],
    required: true,
    index: true,
  },
  module: { type: String, required: true },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true, index: true },
  priority: { type: String, enum: ['p1', 'p2', 'p3', 'p4'], default: 'p3' },

  bugNumber: { type: String, required: true, index: true },
  feature: { type: String, default: '' },
  testCaseId: { type: String, default: '' },
  failedStepNumber: { type: Number, default: null },

  title: { type: String, required: true },
  description: { type: String, default: '' },
  screenName: { type: String, default: '' },
  stepsToReproduce: { type: [String], default: [] },
  expectedResult: { type: String, default: '' },
  actualResult: { type: String, default: '' },
  screenshotDataUrl: { type: String, default: null },
  logs: { type: String, default: '' },
  stackTrace: { type: String, default: null },
  apiRequest: { type: String, default: null },
  apiResponse: { type: String, default: null },
  deviceInfo: { type: String, default: '' },
  osVersion: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  aiRootCause: { type: String, default: '' },
  suggestedFix: { type: String, default: '' },

  status: { type: String, enum: ['open', 'resolved', 'ignored'], default: 'open' },
}, { timestamps: true });

export const QaBug = models.QaBug ?? model('QaBug', qaBugSchema);
