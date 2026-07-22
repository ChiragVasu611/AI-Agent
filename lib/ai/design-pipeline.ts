import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignAgentRun } from '@/lib/mongodb/models/DesignAgentRun';
import { Notification } from '@/lib/mongodb/models/Notification';
import { getAIProvider } from './provider';
import {
  DESIGN_AGENT_BY_ID, DESIGN_PIPELINE_ORDER, DESIGN_STATUS_BY_AGENT, type DesignAgentId,
} from './design-agents';
import { designSystemPrompt, designUserPrompt, type DesignPromptInput } from './design-prompts';
import { buildDesignPlan, type DesignPlan } from './design-planner';
import { getOrCreateDesignDocument } from './design-document';
import { reviewDesign } from './design-review';
import type { DesignProject as DesignProjectType } from '@/lib/types';

const STEP_MS = 700;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseJSON(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Deterministic, always-available output for each agent stage, built from the
 * requirement-analysis plan rather than an LLM call. Used whenever the AI
 * provider throws (no key configured, rate-limited, network error, etc.) so
 * the pipeline — and therefore the whole module — never requires a paid or
 * even a free external API key to produce a complete, usable design.
 */
function deterministicOutputFor(agentId: DesignAgentId, plan: DesignPlan, style: string): Record<string, unknown> {
  switch (agentId) {
    case 'research':
      return {
        category: plan.industry,
        productType: plan.productType,
        targetUsers: plan.personas,
        userRoles: plan.roles,
        uxStrengths: ['Clear primary navigation', 'Consistent screen structure'],
        uxWeaknesses: ['Generated without a live reference — visual polish is templated'],
        navigationPattern: 'Bottom tab navigation with stack-based drill-down',
        screenHierarchy: plan.screens,
        source: 'deterministic-planner',
      };
    case 'strategy':
      return {
        screenInventory: plan.screens,
        userJourney: plan.userJourney,
        navigationFlow: plan.navigationFlow,
        ctaPlacement: 'Primary action anchored to the bottom of each screen',
        requiredModules: plan.modules,
        source: 'deterministic-planner',
      };
    case 'wireframe':
      return {
        grid: '8px baseline grid, 24px screen margins, 4px spacing increments',
        layoutRegions: ['header', 'content', 'bottom-navigation'],
        screens: plan.screens,
        source: 'deterministic-planner',
      };
    case 'uidesign':
      return {
        style,
        colorPalette: { primary: '#4F46E5', background: '#FAFAFB', surface: '#FFFFFF', text: '#1A1B1E' },
        typographyScale: [12, 13, 14, 16, 18, 22, 28],
        source: 'deterministic-planner',
        // Deliberately no `screens` here — the design-document layer's deterministic
        // layout engine (design-fallback-layout.ts) builds real, non-empty screens
        // from screenHierarchy/screenInventory above.
      };
    case 'designsystem':
      return {
        colorTokens: { primary: '#4F46E5', onPrimary: '#FFFFFF', background: '#FAFAFB', surface: '#FFFFFF', text: '#1A1B1E', muted: '#6B7280' },
        spacingTokens: [4, 8, 12, 16, 24, 32, 48],
        radiusTokens: [8, 12, 16, 24],
        componentLibrary: ['Button', 'Input', 'Card', 'Modal', 'BottomNav', 'Badge', 'Avatar'],
        source: 'deterministic-planner',
      };
    case 'responsive':
      return {
        breakpoints: { mobile: 375, tablet: 768, desktop: 1280, largeDesktop: 1440 },
        reflowRules: 'Single column below 768px; two columns 768–1279px; content max-width 1200px above.',
        source: 'deterministic-planner',
      };
    case 'accessibility':
      return {
        // The real score/issues are computed after generation from the actual
        // rendered screens by lib/ai/design-review.ts — this stage just records intent.
        note: 'Full WCAG audit runs automatically against the generated screens once they exist.',
        source: 'deterministic-planner',
      };
    case 'handoff':
      return {
        handoff_notes: 'Follow the generated design tokens (colors, spacing, radius) and component names for implementation.',
        improvement_report: 'Generated using the deterministic design engine — no external AI call was available for this stage.',
        source: 'deterministic-planner',
      };
    default:
      return { source: 'deterministic-planner' };
  }
}

/**
 * Runs the full 8-agent UI/UX design pipeline for a design project.
 * Mirrors lib/ai/pipeline.ts (App Factory) so both modules share the same
 * MongoDB-backed, poll-based orchestration shape.
 *
 * AI is optional end-to-end: a deterministic requirement-analysis plan is
 * built up front and every agent stage has a deterministic fallback, so a
 * missing/failed/rate-limited AI provider degrades quality but never stops
 * the pipeline or the project from completing.
 */
export async function runDesignPipeline(
  projectId: string,
  project: Pick<DesignProjectType, 'id' | 'userId' | 'brief' | 'referenceUrl' | 'platform' | 'style'>,
  opts?: { apiKey?: string | null; aiEnabled?: boolean },
) {
  const aiEnabled = opts?.aiEnabled !== false;
  const aiApiKey = opts?.apiKey ?? null;
  await connectToDatabase();

  const plan = buildDesignPlan(project.brief);
  await DesignProject.findByIdAndUpdate(projectId, { plan });

  const provider = getAIProvider();
  let previousOutput: Record<string, unknown> | undefined;
  let aiEnhanced = false;

  for (let i = 0; i < DESIGN_PIPELINE_ORDER.length; i++) {
    const agentId = DESIGN_PIPELINE_ORDER[i];
    const spec = DESIGN_AGENT_BY_ID[agentId];
    const baseProgress = Math.round((i / DESIGN_PIPELINE_ORDER.length) * 100);

    const run = await DesignAgentRun.create({
      projectId,
      agent: agentId,
      status: 'running',
      progress: 0,
      model: spec.model,
      startedAt: new Date(),
    });

    await DesignProject.findByIdAndUpdate(projectId, {
      status: DESIGN_STATUS_BY_AGENT[agentId] as DesignProjectType['status'],
      progress: baseProgress,
    });

    const input: DesignPromptInput = {
      brief: project.brief,
      referenceUrl: project.referenceUrl,
      platform: project.platform,
      style: project.style,
      previousOutput,
    };

    let output: Record<string, unknown> | null = null;
    let logs = '';
    let usedFallback = false;

    const maxTokens = ['wireframe', 'uidesign', 'designsystem', 'responsive'].includes(agentId) ? 4096 : 2048;

    if (!aiEnabled) {
      usedFallback = true;
      output = deterministicOutputFor(agentId, plan, project.style);
      logs = 'AI generation is disabled in Settings — used the deterministic design engine for this stage.';
    } else {
      try {
        const ai = await provider.generate(
          { systemPrompt: designSystemPrompt(agentId), userPrompt: designUserPrompt(agentId, input), maxTokens },
          spec.model,
          aiApiKey,
        );
        logs = ai.content.slice(0, 4000);
        output = parseJSON(ai.content);
        if (!output) {
          output = { raw: ai.content.slice(0, 1000), _note: 'unstructured' };
        }
        aiEnhanced = true;
      } catch (e) {
        usedFallback = true;
        output = deterministicOutputFor(agentId, plan, project.style);
        logs = `AI call unavailable (${String((e as Error).message ?? e)}) — used the deterministic design engine for this stage.`;
      }
    }

    const progress = Math.round(((i + 1) / DESIGN_PIPELINE_ORDER.length) * 100);

    await DesignAgentRun.findByIdAndUpdate(run._id, {
      status: 'completed',
      progress: 100,
      output,
      logs,
      completedAt: new Date(),
    });

    await DesignProject.findByIdAndUpdate(projectId, { progress });

    if (usedFallback) {
      await Notification.create({
        userId: project.userId,
        type: 'info',
        title: 'Deterministic design engine used',
        message: `${spec.name} used the built-in deterministic engine instead of AI (no key configured, rate-limited, or a network error occurred).`,
      });
    }

    previousOutput = output ?? undefined;
    await sleep(STEP_MS);
  }

  // Real, non-random review — computed from the actual generated screens.
  const doc = await getOrCreateDesignDocument(projectId);
  const review = reviewDesign(doc.screens ?? []);

  await DesignProject.findByIdAndUpdate(projectId, {
    status: 'completed',
    progress: 100,
    score: review.overallScore,
    aiEnhanced,
    uxScore: review.uxScore,
    uiScore: review.uiScore,
    accessibilityScore: review.accessibilityScore,
    consistencyScore: review.consistencyScore,
    responsiveScore: review.responsiveScore,
    reviewIssues: review.issues,
    figmaExportUrl: `https://design-artifacts.enterprise-ai.local/${projectId}/design.fig`,
    designSystemUrl: `https://design-artifacts.enterprise-ai.local/${projectId}/design-system.json`,
    prototypeUrl: `https://design-artifacts.enterprise-ai.local/${projectId}/prototype`,
    handoffUrl: `https://design-artifacts.enterprise-ai.local/${projectId}/handoff.pdf`,
    summary: `${plan.productType} design generated with ${doc.screens?.length ?? 0} screens (${aiEnhanced ? 'AI-enhanced' : 'deterministic engine'}). Overall design score ${review.overallScore}/100${review.issues.length ? `, with ${review.issues.length} improvement suggestion(s) — see Design Review.` : '.'}`,
  });
}
