import { Schema, model, models } from 'mongoose';

const ratingsSchema = new Schema({
  technicalKnowledge: { type: Number, default: 0 },
  communication: { type: Number, default: 0 },
  problemSolving: { type: Number, default: 0 },
  leadership: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  cultureFit: { type: Number, default: 0 },
  learningAbility: { type: Number, default: 0 },
}, { _id: false });

const questionSchema = new Schema({
  category: { type: String, enum: ['hr', 'technical', 'behavioral', 'coding', 'scenario'], required: true },
  question: { type: String, required: true },
}, { _id: false });

const interviewSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  applicationId: { type: Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
  stage: {
    type: String,
    enum: ['hr_interview', 'technical_interview', 'final_interview'],
    required: true,
  },
  interviewer: { type: String, default: '' },
  scheduledAt: { type: Date, default: null },
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled', index: true },
  questions: { type: [questionSchema], default: [] },
  liveNotes: { type: String, default: '' },
  durationSeconds: { type: Number, default: 0 },
  ratings: { type: ratingsSchema, default: () => ({}) },
  overallScore: { type: Number, default: null },
  recommendation: { type: String, enum: ['strong_hire', 'hire', 'hold', 'reject', null], default: null },
  summary: { type: String, default: null },
}, { timestamps: true });

export const InterviewSession = models.InterviewSession ?? model('InterviewSession', interviewSessionSchema);
