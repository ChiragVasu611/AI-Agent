import type { AIModel } from './provider';

export type AgentId =
  | 'analyzer'
  | 'planner'
  | 'designer'
  | 'coder'
  | 'builder'
  | 'emulator'
  | 'qa'
  | 'bugfix';

export interface AgentSpec {
  id: AgentId;
  name: string;
  description: string;
  model: AIModel;
  icon: string;
}

const SUPER: AIModel = 'nvidia/nemotron-3-super-120b-a12b:free';
const ULTRA: AIModel = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export const AGENTS: AgentSpec[] = [
  { id: 'analyzer', name: 'Analyzer Agent', description: 'Analyzes the reference app and extracts features, navigation, business flow, theme, permissions.', model: SUPER, icon: 'ScanSearch' },
  { id: 'planner', name: 'Planning Agent', description: 'Generates the project blueprint, feature list, folder structure, schema, API design, timeline.', model: ULTRA, icon: 'ListTree' },
  { id: 'designer', name: 'UI Designer Agent', description: 'Produces wireframes, screens, components, color palette, typography as Figma-style JSON.', model: SUPER, icon: 'PenTool' },
  { id: 'coder', name: 'Code Generator Agent', description: 'Generates the full source code for Flutter / Android / iOS / React Native.', model: ULTRA, icon: 'Code2' },
  { id: 'builder', name: 'Build Agent', description: 'Compiles the project into APK / AAB / IPA and stores build logs and artifacts.', model: SUPER, icon: 'Hammer' },
  { id: 'emulator', name: 'Android Emulator', description: 'Launches the emulator, installs the APK, captures screenshots and crash logs.', model: SUPER, icon: 'Smartphone' },
  { id: 'qa', name: 'QA Automation Agent', description: 'Performs crash, navigation, API, accessibility, performance, security, memory, battery testing.', model: ULTRA, icon: 'ShieldCheck' },
  { id: 'bugfix', name: 'Bug Fix Agent', description: 'Locates bugs from the QA report, patches code, triggers a rebuild, re-runs QA until passed.', model: ULTRA, icon: 'Bug' },
];

export const AGENT_BY_ID: Record<AgentId, AgentSpec> = AGENTS.reduce(
  (acc, a) => ({ ...acc, [a.id]: a }),
  {} as Record<AgentId, AgentSpec>,
);

export const PIPELINE_ORDER: AgentId[] = [
  'analyzer',
  'planner',
  'designer',
  'coder',
  'builder',
  'emulator',
  'qa',
  'bugfix',
];

export const STATUS_BY_AGENT: Record<AgentId, string> = {
  analyzer: 'analyzing',
  planner: 'planning',
  designer: 'designing',
  coder: 'coding',
  builder: 'building',
  emulator: 'testing',
  qa: 'testing',
  bugfix: 'fixing',
};
