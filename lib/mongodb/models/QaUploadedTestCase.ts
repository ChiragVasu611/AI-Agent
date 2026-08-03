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
      /**
       * The expectation THIS step was judged against — the sheet's per-step
       * Expected Result when it enumerated one per step, otherwise the case-level
       * expectation on the step that carried it. Stored per step so the report
       * can show expected-vs-actual on the row where it was actually asserted,
       * rather than repeating the case's end-state expectation on every row.
       */
      expected: { type: String, default: '' },
      /**
       * Whether the expectation was genuinely asserted against the screen. A
       * PASS with verified:false executed correctly but its expected result was
       * not machine-checkable (visual quality, timing, audio) — which is a real
       * pass needing human confirmation, NOT a blocker.
       */
      verified: { type: Boolean, default: false },
      assertion: { type: String, default: '' },
      durationMs: { type: Number, default: 0 },
      url: { type: String, default: '' },
      screenshotDataUrl: { type: String, default: null },
    }, { _id: false })],
    default: [],
  },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaUploadedTestCase = models.QaUploadedTestCase ?? model('QaUploadedTestCase', qaUploadedTestCaseSchema);
