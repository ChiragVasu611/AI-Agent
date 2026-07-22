import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, required: true, default: 0 },
});

const QaRunCounter = mongoose.models.QaRunCounter || mongoose.model('QaRunCounter', CounterSchema);

/**
 * Atomically allocates the next run number for a user via $inc — replaces the
 * previous countDocuments()+1 pattern, which was a read-then-write race that
 * could hand out the same runNumber (and therefore colliding bugNumber labels
 * like BUG-{runNumber}-001) to two runs started concurrently.
 */
export async function nextRunNumber(userId: string): Promise<number> {
  const doc = await QaRunCounter.findOneAndUpdate(
    { userId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return doc.seq;
}
