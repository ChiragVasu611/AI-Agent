import { Schema, model, models } from 'mongoose';

const qaLogEntrySchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  source: { type: String, enum: ['automation', 'logcat', 'api', 'error', 'crash'], required: true },
  level: { type: String, enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
  message: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const QaLogEntry = models.QaLogEntry ?? model('QaLogEntry', qaLogEntrySchema);
