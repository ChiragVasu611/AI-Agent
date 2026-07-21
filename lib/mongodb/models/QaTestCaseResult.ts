import { Schema, model, models } from 'mongoose';

const qaTestCaseResultSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  testCaseId: { type: String, required: true },
  name: { type: String, required: true },
  module: { type: String, required: true },
  screen: { type: String, default: '' },
  result: { type: String, enum: ['pass', 'fail'], required: true },
  failedStepNumber: { type: Number, default: null },
  bugId: { type: Schema.Types.ObjectId, ref: 'QaBug', default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaTestCaseResult = models.QaTestCaseResult ?? model('QaTestCaseResult', qaTestCaseResultSchema);
