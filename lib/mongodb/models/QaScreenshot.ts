import { Schema, model, models } from 'mongoose';

const qaScreenshotSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  screenName: { type: String, required: true },
  testStep: { type: String, default: '' },
  imageDataUrl: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaScreenshot = models.QaScreenshot ?? model('QaScreenshot', qaScreenshotSchema);
