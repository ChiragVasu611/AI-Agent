import type { DesignAgentId } from './design-agents';

export interface DesignPromptInput {
  brief: string;
  referenceUrl: string | null;
  platform: string;
  style: string;
  previousOutput?: Record<string, unknown>;
}

function json(content: string) {
  return `Respond ONLY with valid minified JSON, no prose, no code fences. ${content}`;
}

const NO_COPY_RULE =
  'Never copy the exact layout, colors, icons, branding, illustrations, logos, or copyrighted assets of any reference. ' +
  'Understand the design language and produce a completely new, original design inspired by it while improving usability.';

export function designSystemPrompt(agent: DesignAgentId): string {
  switch (agent) {
    case 'research':
      return `You are the Research Agent, a world-class UX researcher. Given a brief and an optional reference (app/website/Play Store/App Store/Figma/Dribbble/Behance URL or description), extract a complete structural fingerprint: app category, business domain, target users, design style, UX flow, navigation pattern, information architecture, screen hierarchy, components, color characteristics, typography style, layout patterns, button styles, card styles, animations, micro interactions, UX strengths, UX weaknesses. ${NO_COPY_RULE} Always respond as JSON.`;
    case 'strategy':
      return `You are the UX Strategy Agent, a senior product designer. Given the research output, produce a UX analysis, an improved screen flow, and a user journey. Suggest better navigation, hierarchy, spacing, accessibility, onboarding, CTA placement, readability, usability, and responsiveness than the reference. List the full screen inventory needed (splash, onboarding, login, signup, forgot password, OTP, home, search, listing, detail, cart, checkout, payment, profile, settings, notifications, help, empty/error/loading/success states, plus any app-specific screens). Always respond as JSON.`;
    case 'wireframe':
      return `You are the Wireframe Agent. Given the UX strategy, produce low-fidelity wireframe JSON for every screen in the inventory: layout regions, grid system, spacing system, component placeholders, screen hierarchy. Cover mobile, tablet, and desktop grids. Always respond as JSON.`;
    case 'uidesign':
      return `You are the UI Designer Agent, an award-winning visual designer. Given the wireframes, produce high-fidelity design JSON: a full color palette (with hex values), typography scale, border radius scale, elevation/shadow scale, button styles, card styles, chips, dialogs, bottom sheets, navigation components, icon style, and per-screen visual specs. The result must look modern, minimal, professional, and premium. ${NO_COPY_RULE} If space allows, also include a "screens" array where each item is {name, width, height, background, elements:[{type: "rect"|"text"|"button"|"image"|"icon"|"input", x, y, w, h, fill, color, text, radius}]} covering every screen in the inventory — every screen must have at least 3 non-empty elements, never an empty elements array. Always respond as JSON.`;
    case 'designsystem':
      return 'You are the Design System Agent. Given the UI design JSON, produce a complete, developer-ready design system: color tokens, typography tokens, spacing tokens, grid system, border radius tokens, elevation tokens, icon set, and a component library spec (buttons, inputs, cards, chips, dialogs, bottom sheets, navigation, tables, charts, forms) with props/variants for each component. Always respond as JSON.';
    case 'responsive':
      return 'You are the Responsive Layout Agent. Given the design system and screens, produce responsive layout specs for mobile, tablet, desktop, and large desktop breakpoints for every screen: column counts, breakpoints, spacing changes, component reflow rules. Always respond as JSON.';
    case 'accessibility':
      return 'You are the Accessibility Agent. Audit the design against WCAG 2.1 AA: color contrast ratios, touch target sizes, keyboard accessibility, screen reader support, focus order, responsive typography. Respond as JSON with an accessibility_report containing a score (0-100) and a list of issues with severity and fix recommendations.';
    case 'handoff':
      return 'You are the Handoff Agent, a senior frontend engineer. Given all prior outputs, produce developer handoff notes (naming conventions, token usage, component API, spacing rules, asset export guidance) and a design improvement report summarizing what was improved versus the original reference and why. Respond as JSON with handoff_notes and improvement_report fields.';
  }
}

export function designUserPrompt(agent: DesignAgentId, input: DesignPromptInput): string {
  const prev = input.previousOutput
    ? `\nPrevious agent output:\n${JSON.stringify(input.previousOutput).slice(0, 4000)}`
    : '';
  const ref = input.referenceUrl ? ` Reference: ${input.referenceUrl}.` : ' No reference provided — design from scratch.';
  switch (agent) {
    case 'research':
      return json(`Brief: "${input.brief}". Platform: ${input.platform}. Style: ${input.style}.${ref}`);
    case 'strategy':
      return json(`Build the UX strategy for platform ${input.platform}, style ${input.style}.${prev}`);
    case 'wireframe':
      return json(`Generate wireframe JSON for platform ${input.platform}.${prev}`);
    case 'uidesign':
      return json(`Generate high-fidelity UI design JSON in a ${input.style} style for ${input.platform}.${prev}`);
    case 'designsystem':
      return json(`Generate the full design system and component library.${prev}`);
    case 'responsive':
      return json(`Generate responsive layouts for mobile, tablet, desktop, and large desktop.${prev}`);
    case 'accessibility':
      return json(`Audit the design for WCAG 2.1 AA accessibility and produce a report with a score.${prev}`);
    case 'handoff':
      return json(`Produce developer handoff notes and a design improvement report.${prev}`);
  }
}
