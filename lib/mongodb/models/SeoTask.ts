import { Schema, model, models } from 'mongoose';

const seoTaskSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'SeoProject', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  priority: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
  category: { type: String, enum: ['quick_win', 'long_term', 'technical', 'content', 'aso'], default: 'technical' },
  estimatedTime: { type: String, default: '30 min' },
  status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
  assignedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  completionPercent: { type: Number, default: 0 },
  estimatedImpact: { type: String, default: null },
  planHorizon: { type: String, enum: ['weekly', '30_day', '90_day', null], default: null },
  sourceFindingRef: { type: String, default: null },
}, { timestamps: true });

export const SeoTask = models.SeoTask ?? model('SeoTask', seoTaskSchema);
