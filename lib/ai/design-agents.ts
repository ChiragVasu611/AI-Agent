import type { AIModel } from './provider';

export type DesignAgentId =
  | 'research'
  | 'strategy'
  | 'wireframe'
  | 'uidesign'
  | 'designsystem'
  | 'responsive'
  | 'accessibility'
  | 'handoff';

export interface DesignAgentSpec {
  id: DesignAgentId;
  name: string;
  description: string;
  model: AIModel;
  icon: string;
}

const SUPER: AIModel = 'nvidia/nemotron-3-super-120b-a12b:free';
const ULTRA: AIModel = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export const DESIGN_AGENTS: DesignAgentSpec[] = [
  { id: 'research', name: 'Research Agent', description: 'Analyzes the reference and brief: category, domain, target users, UX strengths and weaknesses.', model: SUPER, icon: 'ScanSearch' },
  { id: 'strategy', name: 'UX Strategy Agent', description: 'Builds the UX analysis, screen flow, and user journey improving on the reference.', model: ULTRA, icon: 'Workflow' },
  { id: 'wireframe', name: 'Wireframe Agent', description: 'Produces low-fidelity wireframes: information architecture, screen hierarchy, layout skeletons.', model: SUPER, icon: 'LayoutTemplate' },
  { id: 'uidesign', name: 'UI Designer Agent', description: 'Produces high-fidelity screens: colors, typography, components, buttons, cards, motion.', model: ULTRA, icon: 'PenTool' },
  { id: 'designsystem', name: 'Design System Agent', description: 'Generates the full design system and component library: tokens, spacing, elevation, forms.', model: SUPER, icon: 'Palette' },
  { id: 'responsive', name: 'Responsive Layout Agent', description: 'Adapts every screen to mobile, tablet, desktop, and large desktop breakpoints.', model: ULTRA, icon: 'Tablet' },
  { id: 'accessibility', name: 'Accessibility Agent', description: 'Audits contrast, touch targets, focus order, and screen reader support against WCAG.', model: SUPER, icon: 'Accessibility' },
  { id: 'handoff', name: 'Handoff Agent', description: 'Writes developer handoff notes and a design improvement report.', model: ULTRA, icon: 'FileOutput' },
];

export const DESIGN_AGENT_BY_ID: Record<DesignAgentId, DesignAgentSpec> = DESIGN_AGENTS.reduce(
  (acc, a) => ({ ...acc, [a.id]: a }),
  {} as Record<DesignAgentId, DesignAgentSpec>,
);

export const DESIGN_PIPELINE_ORDER: DesignAgentId[] = [
  'research',
  'strategy',
  'wireframe',
  'uidesign',
  'designsystem',
  'responsive',
  'accessibility',
  'handoff',
];

export const DESIGN_STATUS_BY_AGENT: Record<DesignAgentId, string> = {
  research: 'researching',
  strategy: 'strategizing',
  wireframe: 'wireframing',
  uidesign: 'designing',
  designsystem: 'systemizing',
  responsive: 'adapting',
  accessibility: 'auditing',
  handoff: 'handoff',
};
