export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type WorkMode = 'onsite' | 'remote' | 'hybrid';
export type JobPriority = 'low' | 'medium' | 'high' | 'urgent';
export type JobStatus = 'open' | 'closed' | 'draft';

export interface Job {
  id: string;
  userId: string;
  title: string;
  department: string;
  employmentType: EmploymentType;
  workMode: WorkMode;
  experienceMinYears: number;
  experienceMaxYears: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  requiredSkills: string[];
  preferredSkills: string[];
  description: string;
  responsibilities: string;
  qualifications: string;
  benefits: string;
  hiringManager: string;
  openings: number;
  priority: JobPriority;
  closingDate: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceEntry {
  company?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface EducationEntry {
  school?: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface Candidate {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  photoUrl: string | null;
  skills: string[];
  experience: ExperienceEntry[];
  totalExperienceYears: number;
  education: EducationEntry[];
  certifications: string[];
  languages: string[];
  projects: string[];
  companiesWorked: string[];
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  notes: string;
  resumeFileName: string | null;
  resumeText: string;
  resumeTextHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStage =
  | 'applied'
  | 'screening'
  | 'shortlisted'
  | 'hr_interview'
  | 'technical_interview'
  | 'final_interview'
  | 'offer'
  | 'joined'
  | 'rejected';

export type Recommendation = 'strong_hire' | 'hire' | 'consider' | 'reject' | null;

export interface MatchScore {
  overall: number;
  skills: number;
  experience: number;
  education: number;
  certification: number;
  communication: number;
}

export interface AIInsights {
  strengths: string[];
  weaknesses: string[];
  missingSkills: string[];
  recommendedSkills: string[];
}

export interface ApplicationFlags {
  duplicateResume: boolean;
  fakeExperienceSuspected: boolean;
  employmentGap: boolean;
  skillMismatch: boolean;
  overqualified: boolean;
  underqualified: boolean;
}

export interface Application {
  id: string;
  userId: string;
  jobId: string;
  candidateId: string;
  stage: ApplicationStage;
  matchScore: MatchScore | null;
  aiInsights: AIInsights | null;
  flags: ApplicationFlags | null;
  recommendation: Recommendation;
  notes: string;
  createdAt: string;
  updatedAt: string;
  candidate?: Candidate;
  job?: Job;
}

export type InterviewStage = 'hr_interview' | 'technical_interview' | 'final_interview';
export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled';
export type InterviewRecommendation = 'strong_hire' | 'hire' | 'hold' | 'reject' | null;
export type QuestionCategory = 'hr' | 'technical' | 'behavioral' | 'coding' | 'scenario';

export interface InterviewQuestionItem {
  category: QuestionCategory;
  question: string;
}

export interface InterviewRatings {
  technicalKnowledge: number;
  communication: number;
  problemSolving: number;
  leadership: number;
  confidence: number;
  cultureFit: number;
  learningAbility: number;
}

export interface InterviewSession {
  id: string;
  userId: string;
  applicationId: string;
  stage: InterviewStage;
  interviewer: string;
  scheduledAt: string | null;
  status: InterviewStatus;
  questions: InterviewQuestionItem[];
  liveNotes: string;
  durationSeconds: number;
  ratings: InterviewRatings;
  overallScore: number | null;
  recommendation: InterviewRecommendation;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'designing'
  | 'coding'
  | 'building'
  | 'testing'
  | 'fixing'
  | 'completed'
  | 'failed';

export type AgentName =
  | 'analyzer'
  | 'planner'
  | 'designer'
  | 'coder'
  | 'builder'
  | 'emulator'
  | 'qa'
  | 'bugfix';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type Platform = 'flutter' | 'android' | 'ios' | 'react-native';

export type Store = 'google_play' | 'apple' | 'unknown';

export interface Project {
  id: string;
  userId: string;
  name: string;
  referenceUrl: string;
  platform: Platform;
  store: Store;
  status: ProjectStatus;
  progress: number;
  version: string;
  qaScore: number | null;
  apkUrl: string | null;
  aabUrl: string | null;
  sourceUrl: string | null;
  docsUrl: string | null;
  releaseNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  agent: AgentName;
  status: RunStatus;
  progress: number;
  model: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type DesignProjectStatus =
  | 'queued'
  | 'researching'
  | 'strategizing'
  | 'wireframing'
  | 'designing'
  | 'systemizing'
  | 'adapting'
  | 'auditing'
  | 'handoff'
  | 'completed'
  | 'failed';

export type DesignAgentName =
  | 'research'
  | 'strategy'
  | 'wireframe'
  | 'uidesign'
  | 'designsystem'
  | 'responsive'
  | 'accessibility'
  | 'handoff';

export type DesignPlatform = 'mobile' | 'web' | 'both';

export interface DesignProject {
  id: string;
  userId: string;
  name: string;
  brief: string;
  referenceUrl: string | null;
  platform: DesignPlatform;
  style: string;
  status: DesignProjectStatus;
  progress: number;
  score: number | null;
  figmaExportUrl: string | null;
  designSystemUrl: string | null;
  prototypeUrl: string | null;
  handoffUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignAgentRun {
  id: string;
  projectId: string;
  agent: DesignAgentName;
  status: RunStatus;
  progress: number;
  model: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type DesignElementType = 'rect' | 'text' | 'button' | 'image' | 'icon' | 'input';

export interface DesignElement {
  id: string;
  type: DesignElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  radius?: number;
  text?: string;
  target?: string | null;
}

export interface DesignScreen {
  id: string;
  name: string;
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
}

export interface DesignDocumentVersion {
  screens: DesignScreen[];
  savedAt: string;
}

export interface DesignDocument {
  id: string;
  projectId: string;
  screens: DesignScreen[];
  versions: DesignDocumentVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface Credits {
  id: string;
  userId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'user' | 'manager';
  createdAt: string;
}
