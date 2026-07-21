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

// Shared rules for emitting a full, directly-compilable Flutter project as a
// set of delimited file blocks (far more robust than JSON for source code).
const FILE_PROTOCOL = `Output format — emit one or more file blocks and NOTHING else (no prose, no markdown fences):
=== FILE: lib/main.dart ===
<verbatim file contents>
=== END ===
=== FILE: lib/screens/home_screen.dart ===
<verbatim file contents>
=== END ===

Hard rules:
- Entry point MUST be lib/main.dart with a top-level void main().
- Only write files under lib/. Do NOT emit pubspec.yaml, android/, ios/, web/ or any file outside lib/.
- Use ONLY the Flutter SDK and Material (package:flutter/material.dart). NO third-party packages, NO assets, NO network/image URLs, NO plugins.
- Null-safe Dart 3, Material 3. Code MUST compile with a clean 'flutter analyze' (no undefined names, no missing imports, every referenced widget/class defined).
- Every path in an "import '...';" that points into lib/ must correspond to a file you also emit.`;

const CODER_SYSTEM = `You are the Code Generator Agent. You author a COMPLETE, real, multi-screen Flutter application in Dart that recreates the given reference app. Produce at least 4 distinct screens with working navigation (e.g. a bottom NavigationBar plus pushed detail routes), realistic in-app content/data, a coherent theme, and clean widget composition split across multiple files under lib/.

${FILE_PROTOCOL}`;

export function fixerSystemPrompt(): string {
  return `You are the Build Fixer Agent. You are given the current Flutter source files and the exact errors from 'flutter analyze' or 'flutter build'. Return the corrected project so it compiles cleanly.

${FILE_PROTOCOL}

Additional rules:
- Re-emit EVERY file the app needs (full contents), not just the changed ones — the previous files are replaced wholesale by what you output.
- Fix the reported errors directly: define missing names, add missing imports, correct types, remove any third-party package usage.`;
}

export function fixerUserPrompt(errors: string, files: { path: string; content: string }[]): string {
  const bundle = files
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END ===`)
    .join('\n')
    .slice(0, 24000);
  const errText = errors.slice(-6000);
  return `The build failed with these errors:\n\n${errText}\n\nHere are the current files:\n\n${bundle}\n\nReturn the full corrected fileset.`;
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
      return CODER_SYSTEM;
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
      return `Write the complete Flutter source for an app inspired by ${input.referenceUrl} (from ${input.store}). Target platform: ${input.platform}. Recreate its real screens, navigation and content. Output only the FILE blocks described in your instructions.${prev}`;
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
