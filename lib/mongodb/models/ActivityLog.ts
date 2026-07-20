import { Schema, model, models } from 'mongoose';

const activityLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true },
  entity: { type: String, default: null },
  entityId: { type: String, default: null },
  meta: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const ActivityLog = models.ActivityLog ?? model('ActivityLog', activityLogSchema);
