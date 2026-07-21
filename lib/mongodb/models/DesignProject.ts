import { Schema, model, models } from 'mongoose';

const designProjectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  brief: { type: String, required: true },
  referenceUrl: { type: String, default: null },
  platform: { type: String, enum: ['mobile', 'web', 'both'], required: true },
  style: { type: String, default: 'modern' },
  status: {
    type: String,
    enum: ['queued', 'researching', 'strategizing', 'wireframing', 'designing', 'systemizing', 'adapting', 'auditing', 'handoff', 'completed', 'failed'],
    default: 'queued',
    index: true,
  },
  progress: { type: Number, default: 0 },
  score: { type: Number, default: null },
  figmaExportUrl: { type: String, default: null },
  designSystemUrl: { type: String, default: null },
  prototypeUrl: { type: String, default: null },
  handoffUrl: { type: String, default: null },
  summary: { type: String, default: null },
}, { timestamps: true });

export const DesignProject = models.DesignProject ?? model('DesignProject', designProjectSchema);
