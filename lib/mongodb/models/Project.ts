import { Schema, model, models } from 'mongoose';

const projectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  referenceUrl: { type: String, required: true },
  platform: { type: String, enum: ['flutter', 'android', 'ios', 'react-native'], required: true },
  store: { type: String, enum: ['google_play', 'apple', 'unknown'], required: true },
  status: {
    type: String,
    enum: ['queued', 'analyzing', 'planning', 'designing', 'coding', 'building', 'testing', 'fixing', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  progress: { type: Number, default: 0 },
  version: { type: String, default: '0.1.0' },
  qaScore: { type: Number, default: null },
  apkUrl: { type: String, default: null },
  aabUrl: { type: String, default: null },
  sourceUrl: { type: String, default: null },
  docsUrl: { type: String, default: null },
  previewUrl: { type: String, default: null },
  buildLog: { type: String, default: null },
  releaseNotes: { type: String, default: null },
}, { timestamps: true });

export const Project = models.Project ?? model('Project', projectSchema);
