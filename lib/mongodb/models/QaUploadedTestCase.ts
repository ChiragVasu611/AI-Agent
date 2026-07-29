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

  /**
   * Per-step execution evidence. Every step the engine runs appends one entry
   * here, so a failed case can prove exactly which step diverged and what was
   * actually observed at that moment.
   */
  stepResults: {
    type: [new Schema({
      stepNumber: { type: Number, required: true },
      action: { type: String, default: '' },       // interpreted action kind
      instruction: { type: String, default: '' },  // verbatim step text from the sheet
      status: { type: String, enum: ['pass', 'fail', 'blocked', 'skipped'], required: true },
      actual: { type: String, default: '' },
      assertion: { type: String, default: '' },
      durationMs: { type: Number, default: 0 },
      url: { type: String, default: '' },
      screenshotDataUrl: { type: String, default: null },
    }, { _id: false })],
    default: [],
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaUploadedTestCase = models.QaUploadedTestCase ?? model('QaUploadedTestCase', qaUploadedTestCaseSchema);
