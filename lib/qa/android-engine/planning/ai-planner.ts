import type { Interaction, ScreenState } from '../types';
import { labelOf, shortId } from '../ui-parser';
import type { TestingGoal } from './types';

/** Read-only context the AI may use to rank — never to fabricate. */
export interface AiPlanContext {
  coverageOverall?: number;
  knownScreen?: boolean;
  versionChanged?: boolean;
  deadEndsHere?: number;
  isPriorProductive?: (key: string) => boolean;
}

/**
 * The AI Planning layer.
 *
 * The model is asked exactly ONE thing: given the current screen, the unmet
 * testing goals, and the concrete list of candidate interactions the execution
 * layer already enumerated, which candidate should be tried next to maximise
 * NEW feature discovery and workflow completion.
 *
 * Hard guarantees:
 *  • The AI only ever returns an INDEX into a list of real, executable actions.
 *  • It can NEVER author a bug, a result, or a screen — those come only from
 *    deterministic checks and real device signals elsewhere in the engine.
 *  • Any malformed / out-of-range / unavailable response falls back silently
 *    to the deterministic goal ranking, so the run never depends on the model.
 *
 * To keep cost and latency bounded, the planner is consulted sparingly (once
 * per newly-seen screen signature, and only when the choice is non-trivial).
 */
export class AiPlanner {
  private apiKey: string | null;
  private log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
  private askedFor = new Set<string>();
  private calls = 0;
  private readonly maxCalls: number;
  private available: boolean;

  constructor(opts: {
    apiKey: string | null;
    maxCalls?: number;
    log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
  }) {
    this.apiKey = opts.apiKey;
    this.log = opts.log;
    // Each consultation is a blocking network round-trip inside the exploration
    // loop, so the budget is deliberately small: on a real device an
    // interaction step already costs seconds, and spending the run's clock on
    // model latency buys fewer screens tested. The deterministic goal ranking
    // handles every screen; the model only refines the genuinely ambiguous ones.
    this.maxCalls = opts.maxCalls ?? 10;
    this.available = Boolean(opts.apiKey || process.env.OPENROUTER_API_KEY);
  }

  get enabled(): boolean { return this.available && this.calls < this.maxCalls; }

  /** Should we spend an AI call on this screen? Only when it's new and non-trivial. */
  shouldConsult(state: ScreenState, candidates: Interaction[]): boolean {
    if (!this.enabled) return false;
    if (candidates.length < 2) return false;
    if (this.askedFor.has(state.signature)) return false;
    return true;
  }

  /**
   * Returns the index of the chosen candidate, or null to defer to the
   * deterministic planner. Ranks using the live UI state, the unmet goals, the
   * coverage reached so far, and reused application knowledge. Never throws,
   * and NEVER produces anything but an index into the real action list.
   */
  async chooseNext(
    state: ScreenState,
    candidates: Interaction[],
    unmetGoals: TestingGoal[],
    context: AiPlanContext = {},
  ): Promise<{ index: number; reason: string } | null> {
    if (!this.shouldConsult(state, candidates)) return null;
    this.askedFor.add(state.signature);
    this.calls += 1;

    const options = candidates.slice(0, 14).map((c, i) => {
      const id = c.target ? (labelOf(c.target) || shortId(c.target)) : '';
      const known = context.isPriorProductive?.(c.key) ? ' [known-productive]' : '';
      return `${i}: ${c.kind}${id ? ` "${id.slice(0, 40)}"` : ''}${known} — ${c.reason.slice(0, 60)}`;
    });
    const goals = unmetGoals.slice(0, 8).map((g) => `${g.kind}(${g.status},p${g.priority})`).join(', ');
    const knowledge = [
      context.coverageOverall != null ? `overall coverage ${Math.round(context.coverageOverall * 100)}%` : null,
      context.knownScreen ? 'screen seen in a prior run' : null,
      context.versionChanged ? 'app version changed — new/modified flows are high value' : null,
      context.deadEndsHere ? `${context.deadEndsHere} action(s) here were dead ends before` : null,
    ].filter(Boolean).join('; ');

    try {
      const { generateQaAnalysis, parseJsonLoose } = await import('@/lib/qa/ai-provider');
      const content = await generateQaAnalysis(this.apiKey, {
        systemPrompt:
          'You are the planning brain of an autonomous mobile QA agent. You are given the current '
          + 'screen, the still-unmet testing goals, the coverage/knowledge context, and a numbered list '
          + 'of ACTIONS that are already available on this screen. Choose the single action that best '
          + 'advances an unmet goal and maximises discovery of NEW features and completion of user '
          + 'workflows. You are ONLY selecting an action index. You must NOT invent actions, bugs, '
          + 'results, screenshots, or UI. Prefer entering forms, opening navigation, and reaching '
          + 'un-visited features over repeating trivial taps or known dead ends. '
          + 'Respond ONLY with minified JSON: {"choice": <index>, "reason": "<short>"}.',
        userPrompt:
          `Screen: "${state.label}" [${state.kind}]\n`
          + `Unmet goals: ${goals || '(none)'}\n`
          + `Context: ${knowledge || '(first run, no prior knowledge)'}\n`
          + `Actions:\n${options.join('\n')}`,
        maxTokens: 120,
      });
      const parsed = parseJsonLoose(content) as { choice?: number; reason?: string } | null;
      const idx = Number(parsed?.choice);
      if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
        return null;
      }
      const reason = String(parsed?.reason ?? 'AI-selected').slice(0, 100);
      await this.log('debug', `AI planner chose action #${idx} on "${state.label}": ${reason}`);
      return { index: idx, reason };
    } catch (e) {
      // One failure disables the layer for the rest of the run — the
      // deterministic planner is fully capable on its own.
      this.available = false;
      await this.log('warn', `AI planner unavailable (${(e as Error)?.message?.slice(0, 100)}) — continuing with deterministic planning.`);
      return null;
    }
  }

  get callsMade(): number { return this.calls; }
}
