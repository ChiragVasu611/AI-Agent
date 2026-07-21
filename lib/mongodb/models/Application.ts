import { Schema, model, models } from 'mongoose';

const matchScoreSchema = new Schema({
  overall: Number,
  skills: Number,
  experience: Number,
  education: Number,
  certification: Number,
  communication: Number,
}, { _id: false });

const aiInsightsSchema = new Schema({
  strengths: { type: [String], default: [] },
  weaknesses: { type: [String], default: [] },
  missingSkills: { type: [String], default: [] },
  recommendedSkills: { type: [String], default: [] },
}, { _id: false });

const flagsSchema = new Schema({
  duplicateResume: { type: Boolean, default: false },
  fakeExperienceSuspected: { type: Boolean, default: false },
  employmentGap: { type: Boolean, default: false },
  skillMismatch: { type: Boolean, default: false },
  overqualified: { type: Boolean, default: false },
  underqualified: { type: Boolean, default: false },
}, { _id: false });

const applicationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  stage: {
    type: String,
    enum: ['applied', 'screening', 'shortlisted', 'hr_interview', 'technical_interview', 'final_interview', 'offer', 'joined', 'rejected'],
    default: 'applied',
    index: true,
  },
  matchScore: { type: matchScoreSchema, default: null },
  aiInsights: { type: aiInsightsSchema, default: null },
  flags: { type: flagsSchema, default: null },
  recommendation: { type: String, enum: ['strong_hire', 'hire', 'consider', 'reject', null], default: null },
  notes: { type: String, default: '' },
}, { timestamps: true });

applicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });

export const Application = models.Application ?? model('Application', applicationSchema);
