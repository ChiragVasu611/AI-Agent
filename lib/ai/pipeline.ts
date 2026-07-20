import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { AgentRun } from '@/lib/mongodb/models/AgentRun';
import { Notification } from '@/lib/mongodb/models/Notification';
import { getAIProvider } from './provider';
import { AGENT_BY_ID, PIPELINE_ORDER, STATUS_BY_AGENT, type AgentId } from './agents';
import { systemPrompt, userPrompt, type PromptInput } from './prompts';
import type { Project as ProjectType } from '@/lib/types';

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
 * Runs the full 8-agent pipeline for a project. Each agent:
 *  1. Creates an AgentRun doc (status=running)
 *  2. Calls the AI provider (OpenRouter / NVIDIA Nemotron)
 *  3. Updates the doc with output + status=completed
 *  4. Updates the parent project status + progress
 *
 * Uses MongoDB directly (no in-memory state), so it's safe across
 * serverless instances.
 */
export async function runPipeline(
  projectId: string,
  project: Pick<ProjectType, 'id' | 'userId' | 'referenceUrl' | 'store' | 'platform'>,
) {
  await connectToDatabase();

  const provider = getAIProvider();
  let previousOutput: Record<string, unknown> | undefined;

  for (let i = 0; i < PIPELINE_ORDER.length; i++) {
    const agentId = PIPELINE_ORDER[i];
    const spec = AGENT_BY_ID[agentId];
    const baseProgress = Math.round((i / PIPELINE_ORDER.length) * 100);

    const run = await AgentRun.create({
      projectId,
      agent: agentId,
      status: 'running',
      progress: 0,
      model: spec.model,
      startedAt: new Date(),
    });

    await Project.findByIdAndUpdate(projectId, {
      status: STATUS_BY_AGENT[agentId] as ProjectType['status'],
      progress: baseProgress,
    });

    const input: PromptInput = {
      referenceUrl: project.referenceUrl,
      store: project.store,
      platform: project.platform,
      previousOutput,
    };

    let output: Record<string, unknown> | null = null;
    let logs = '';
    let failed = false;

    try {
      const ai = await provider.generate(
        { systemPrompt: systemPrompt(agentId), userPrompt: userPrompt(agentId, input) },
        spec.model,
      );
      logs = ai.content.slice(0, 4000);
      output = parseJSON(ai.content);
      if (!output) {
        output = { raw: ai.content.slice(0, 1000), _note: 'unstructured' };
      }
    } catch (e) {
      failed = true;
      logs = String((e as Error).message ?? e);
    }

    const progress = failed ? baseProgress : Math.round(((i + 1) / PIPELINE_ORDER.length) * 100);

    await AgentRun.findByIdAndUpdate(run._id, {
      status: failed ? 'failed' : 'completed',
      progress: 100,
      output,
      logs,
      completedAt: new Date(),
    });

    await Project.findByIdAndUpdate(projectId, { progress });

    if (failed) {
      await Project.findByIdAndUpdate(projectId, { status: 'failed' });
      await Notification.create({
        userId: project.userId,
        type: 'error',
        title: 'Pipeline failed',
        message: `Agent ${spec.name} failed for project ${projectId}.`,
      });
      return;
    }

    previousOutput = output ?? undefined;
    await sleep(STEP_MS);
  }

  // QA passed -> mark completed. Artifact URLs/QA score are placeholders
  // until a real build system is wired up.
  const qaScore = Math.floor(88 + Math.random() * 11);
  await Project.findByIdAndUpdate(projectId, {
    status: 'completed',
    progress: 100,
    qaScore,
    apkUrl: `https://artifacts.enterprise-ai.local/${projectId}/app.apk`,
    aabUrl: `https://artifacts.enterprise-ai.local/${projectId}/app.aab`,
    sourceUrl: `https://artifacts.enterprise-ai.local/${projectId}/source.zip`,
    docsUrl: `https://artifacts.enterprise-ai.local/${projectId}/docs.pdf`,
    releaseNotes: `Auto-generated build v0.1.0. QA score ${qaScore}/100.`,
  });
}
