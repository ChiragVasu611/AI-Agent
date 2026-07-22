import { Schema, model, models } from 'mongoose';

const qaUploadedTestCaseSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  order: { type: Number, required: true },

  testCaseId: { type: String, required: true },
  module: { type: String, default: '' },
  feature: { type: String, default: '' },
  scenario: { type: String, required: true },
  preconditions: { type: String, default: '' },
  steps: { type: [String], default: [] },
  testData: { type: String, default: '' },
  expectedResult: { type: String, default: '' },
  priority: { type: String, default: 'p3' },
  severity: { type: String, default: 'medium' },

  result: { type: String, enum: ['pending', 'pass', 'fail', 'blocked', 'skipped'], default: 'pending', index: true },
  actualResult: { type: String, default: '' },
  failedStepIndex: { type: Number, default: null },
  screenName: { type: String, default: '' },
  bugId: { type: Schema.Types.ObjectId, ref: 'QaBug', default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaUploadedTestCase = models.QaUploadedTestCase ?? model('QaUploadedTestCase', qaUploadedTestCaseSchema);
