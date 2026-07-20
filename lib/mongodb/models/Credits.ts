import { Schema, model, models } from 'mongoose';

const creditsSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 100 },
}, { timestamps: true });

export const Credits = models.Credits ?? model('Credits', creditsSchema);
