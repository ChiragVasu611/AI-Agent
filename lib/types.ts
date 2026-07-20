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
