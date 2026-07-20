import { Schema, model, models } from 'mongoose';

const agentRunSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  agent: {
    type: String,
    enum: ['analyzer', 'planner', 'designer', 'coder', 'builder', 'emulator', 'qa', 'bugfix'],
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

export const AgentRun = models.AgentRun ?? model('AgentRun', agentRunSchema);
