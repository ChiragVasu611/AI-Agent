import { Schema, model, models } from 'mongoose';

const designAgentRunSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'DesignProject', required: true, index: true },
  agent: {
    type: String,
    enum: ['research', 'strategy', 'wireframe', 'uidesign', 'designsystem', 'responsive', 'accessibility', 'handoff'],
    required: true,
  },
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  progress: { type: Number, default: 0 },
  model: { type: String, default: null },
  input: { type: Schema.Types.Mixed, default: null },
  output: { type: Schema.Types.Mixed, default: null },
  logs: { type: String, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const DesignAgentRun = models.DesignAgentRun ?? model('DesignAgentRun', designAgentRunSchema);
