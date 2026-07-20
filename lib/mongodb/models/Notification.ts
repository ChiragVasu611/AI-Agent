import { Schema, model, models } from 'mongoose';

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, default: null },
  read: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const Notification = models.Notification ?? model('Notification', notificationSchema);
