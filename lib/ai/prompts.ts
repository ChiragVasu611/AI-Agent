import type { AgentId } from './agents';

export interface PromptInput {
  referenceUrl: string;
  store: string;
  platform: string;
  previousOutput?: Record<string, unknown>;
}

function json(content: string) {
  return `Respond ONLY with valid minified JSON, no prose, no code fences. ${content}`;
}

export function systemPrompt(agent: AgentId): string {
  switch (agent) {
    case 'analyzer':
      return 'You are the Analyzer Agent. Given a reference mobile app URL, you extract a complete structural fingerprint: app name, package name, developer, description, category, screenshots, reviews, ratings, permissions, features, navigation flow, business logic, animations, color palette, typography. Always respond as JSON.';
    case 'planner':
      return 'You are the Planning Agent. Given the analyzer output, you produce a project blueprint: feature list, user flow, folder structure, database schema, API design, tech stack, development plan, timeline. Always respond as JSON.';
    case 'designer':
      return 'You are the UI Designer Agent. Given the planning JSON, you produce Figma-style wireframe JSON: screens, components, responsive layouts, color palette, typography, icons, spacing. Always respond as JSON.';
    case 'coder':
      return 'You are the Code Generator Agent. Given the design JSON, you generate complete application source code for the requested platform including authentication, screens, components, navigation, API integration, database integration, business logic and state management. Respond as JSON with a files[] array of {path, content}.';
    case 'builder':
      return 'You are the Build Agent. You compile the generated project into APK/AAB/IPA. Respond as JSON with build metadata: version, build_time_ms, logs, artifact_urls.';
    case 'emulator':
      return 'You are the Android Emulator Agent. You launch the emulator, install the APK, launch the app, capture screenshots and console/crash logs. Respond as JSON with screenshots[], console_logs, crash_logs.';
    case 'qa':
      return 'You are the QA Automation Agent. You perform crash, navigation, API, accessibility, performance, security, memory and battery testing. Respond as JSON with a qa_report containing score (0-100) and per-test pass/fail details.';
    case 'bugfix':
      return 'You are the Bug Fix Agent. Given the QA report you locate bugs, produce patches, and trigger a rebuild. Respond as JSON with patches[] and a fixed boolean.';
  }
}

export function userPrompt(agent: AgentId, input: PromptInput): string {
  const prev = input.previousOutput ? `\nPrevious agent output:\n${JSON.stringify(input.previousOutput).slice(0, 4000)}` : '';
  switch (agent) {
    case 'analyzer':
      return json(`Analyze reference app ${input.referenceUrl} from ${input.store}. Target platform: ${input.platform}.`);
    case 'planner':
      return json(`Build the project plan for ${input.referenceUrl} on ${input.platform}.${prev}`);
    case 'designer':
      return json(`Generate UI design JSON for ${input.platform}.${prev}`);
    case 'coder':
      return json(`Generate full source code for ${input.platform}.${prev}`);
    case 'builder':
      return json(`Compile the project for ${input.platform}. Produce build metadata.${prev}`);
    case 'emulator':
      return json(`Run the build on the Android emulator and capture logs.${prev}`);
    case 'qa':
      return json(`Run the full QA suite and produce a qa_report with score.${prev}`);
    case 'bugfix':
      return json(`Inspect the QA report, patch any bugs, set fixed=true when done.${prev}`);
  }
}
