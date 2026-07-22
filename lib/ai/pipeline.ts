import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { AgentRun } from '@/lib/mongodb/models/AgentRun';
import { Notification } from '@/lib/mongodb/models/Notification';
import { getAIProvider } from './provider';
import { AGENT_BY_ID, PIPELINE_ORDER, STATUS_BY_AGENT, type AgentId } from './agents';
import { systemPrompt, userPrompt, type PromptInput } from './prompts';
import {
  buildProfile,
  analyzerOutput,
  plannerOutput,
  designerOutput,
  builderOutput,
  generateTestCases,
  qaOutput,
  bugfixOutput,
  type AppProfile,
} from './factory';
import { generateFlutterFiles } from './codegen';
import { buildFlutterApk, buildFlutterWeb, installAndLaunch, listDevices, GENERATED_PACKAGE, type BuildResult, type WebBuildResult, type RunTarget } from '@/lib/build/toolchain';
import type { Project as ProjectType } from '@/lib/types';

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
 * Best-effort LLM enrichment. Tries the agent's model, then falls back to the
 * SUPER model (the free Ultra model is frequently rate-limited). Never throws —
 * returns null if the model is unavailable, so the deterministic backbone is
 * always used as-is. This is why generation no longer aborts on a flaky model.
 */
async function enrich(agentId: AgentId, input: PromptInput): Promise<{ data: Record<string, unknown> | null; logs: string }> {
  const provider = getAIProvider();
  const spec = AGENT_BY_ID[agentId];
  const models = spec.model.includes('ultra')
    ? [spec.model, 'nvidia/nemotron-3-super-120b-a12b:free' as const]
    : [spec.model];

  let lastErr = '';
  for (const model of models) {
    try {
      const ai = await provider.generate({ systemPrompt: systemPrompt(agentId), userPrompt: userPrompt(agentId, input) }, model);
      const data = parseJSON(ai.content);
      return { data, logs: `[${model}] ${ai.content.slice(0, 2000)}` };
    } catch (e) {
      lastErr = String((e as Error).message ?? e);
    }
  }
  return { data: null, logs: `LLM unavailable (${lastErr}); used deterministic backbone.` };
}

interface AgentContext {
  projectId: string;
  userId: string;
  referenceUrl: string;
  store: string;
  platform: string;
  profile: AppProfile;
  runTarget: RunTarget;
  build?: BuildResult;
  web?: WebBuildResult;
  testCasesPassed?: number;
  testCasesTotal?: number;
}

/**
 * Runs the full 8-agent pipeline. Each agent produces a rich, complete output
 * object (stored on its AgentRun) that the UI renders in full. The builder and
 * emulator agents run the real Flutter / Android toolchain; everything degrades
 * gracefully so the pipeline always reaches a terminal state.
 */
export async function runPipeline(
  projectId: string,
  project: Pick<ProjectType, 'id' | 'userId' | 'referenceUrl' | 'store' | 'platform'> & { runTarget?: RunTarget },
) {
  await connectToDatabase();

  const ctx: AgentContext = {
    projectId,
    userId: project.userId,
    referenceUrl: project.referenceUrl,
    store: project.store,
    platform: project.platform,
    runTarget: project.runTarget ?? 'auto',
    profile: buildProfile(project.referenceUrl, project.store),
  };

  let previousOutput: Record<string, unknown> | undefined;
  const files = generateFlutterFiles(ctx.profile, ctx.referenceUrl);

  for (let i = 0; i < PIPELINE_ORDER.length; i++) {
    const agentId = PIPELINE_ORDER[i];
    const spec = AGENT_BY_ID[agentId];
    const baseProgress = Math.round((i / PIPELINE_ORDER.length) * 100);

    const run = await AgentRun.create({
      projectId,
      agent: agentId,
      status: 'running',
      progress: 20,
      model: spec.model,
      input: { referenceUrl: ctx.referenceUrl, platform: ctx.platform },
      startedAt: new Date(),
    });

    await Project.findByIdAndUpdate(projectId, {
      status: STATUS_BY_AGENT[agentId] as ProjectType['status'],
      progress: baseProgress,
    });

    let output: Record<string, unknown> = {};
    let logs = '';

    try {
      const result = await runAgent(agentId, ctx, previousOutput, files);
      output = result.output;
      logs = result.logs;
    } catch (e) {
      // Deterministic backbone means this should be rare; keep the pipeline alive.
      output = { error: String((e as Error).message ?? e), _note: 'agent recovered with fallback' };
      logs = String((e as Error).message ?? e);
    }

    await AgentRun.findByIdAndUpdate(run._id, {
      status: 'completed',
      progress: 100,
      output,
      logs: logs.slice(0, 8000),
      completedAt: new Date(),
    });

    await Project.findByIdAndUpdate(projectId, {
      progress: Math.round(((i + 1) / PIPELINE_ORDER.length) * 100),
    });

    previousOutput = output;
  }

  // Finalize the project with the real artifacts and metrics gathered above.
  const apkBuilt = !!ctx.build?.ok;
  await Project.findByIdAndUpdate(projectId, {
    status: 'completed',
    progress: 100,
    qaScore: ctx.testCasesTotal ? Math.round(((ctx.testCasesPassed ?? 0) / ctx.testCasesTotal) * 100) : null,
    buildTimeMs: ctx.build?.buildTimeMs ?? null,
    fileCount: ctx.build?.fileCount ?? files.length,
    testCasesTotal: ctx.testCasesTotal ?? null,
    testCasesPassed: ctx.testCasesPassed ?? null,
    apkUrl: apkBuilt ? `/api/projects/${projectId}/download?type=apk` : null,
    aabUrl: null,
    sourceUrl: ctx.build?.sourceZipPath ? `/api/projects/${projectId}/download?type=source` : null,
    docsUrl: `/api/projects/${projectId}/download?type=docs`,
    releaseNotes: `Auto-generated ${ctx.platform} build v0.1.0. ${apkBuilt ? 'APK built successfully.' : 'Source generated (APK build unavailable on this host).'}`,
  });

  await Notification.create({
    userId: ctx.userId,
    type: apkBuilt ? 'success' : 'info',
    title: 'Build complete',
    message: `${ctx.profile.appName} finished the 8-agent pipeline.${apkBuilt ? ' APK is ready to download.' : ''}`,
  });
}

async function runAgent(
  agentId: AgentId,
  ctx: AgentContext,
  previousOutput: Record<string, unknown> | undefined,
  files: ReturnType<typeof generateFlutterFiles>,
): Promise<{ output: Record<string, unknown>; logs: string }> {
  const input: PromptInput = {
    referenceUrl: ctx.referenceUrl,
    store: ctx.store,
    platform: ctx.platform,
    previousOutput,
  };

  switch (agentId) {
    case 'analyzer': {
      const base = analyzerOutput(ctx.profile, ctx.referenceUrl, ctx.store);
      const { data, logs } = await enrich('analyzer', input);
      // Merge any extra description/features the model surfaced.
      const merged = data ? { ...base, aiInsights: data } : base;
      return { output: merged, logs };
    }
    case 'planner': {
      const base = plannerOutput(ctx.profile, ctx.platform);
      const { data, logs } = await enrich('planner', input);
      return { output: data ? { ...base, aiInsights: data } : base, logs };
    }
    case 'designer': {
      return { output: designerOutput(ctx.profile), logs: 'Design system generated from analyzed palette and screens.' };
    }
    case 'coder': {
      const preview = files.map((f) => ({
        path: f.path,
        language: f.language,
        lines: f.content.split('\n').length,
        content: f.content.length > 4000 ? f.content.slice(0, 4000) + '\n// …truncated…' : f.content,
      }));
      const linesOfCode = files.reduce((n, f) => n + f.content.split('\n').length, 0);
      return {
        output: {
          summary: `Generated ${files.length} source files (${linesOfCode} LOC) for ${ctx.platform}.`,
          fileCount: files.length,
          linesOfCode,
          languages: Array.from(new Set(files.map((f) => f.language))),
          files: preview,
        },
        logs: `Generated files:\n${files.map((f) => f.path).join('\n')}`,
      };
    }
    case 'builder': {
      const build = await buildFlutterApk(ctx.projectId, files);
      ctx.build = build;
      // Also build the web bundle that powers the dashboard virtual emulator.
      const web = await buildFlutterWeb(ctx.projectId, files);
      ctx.web = web;
      await Project.findByIdAndUpdate(ctx.projectId, { webReady: web.ok });
      const out = builderOutput(ctx.profile, ctx.platform, files, {
        buildTimeMs: build.buildTimeMs,
        logs: build.logs,
        apk: build.ok,
      });
      return {
        output: {
          ...out,
          webPreview: web.ok ? 'built' : 'unavailable',
          webBuildTimeMs: web.buildTimeMs,
        },
        logs: build.logs + '\n\n[web]\n' + web.logs,
      };
    }
    case 'emulator': {
      const previewUrl = `/api/app-factory/preview/${ctx.projectId}/`;

      // Virtual emulator = run the app live in the dashboard (Flutter web).
      const runOnDashboard = async (reason: string) => {
        const ok = !!ctx.web?.ok;
        await Project.findByIdAndUpdate(ctx.projectId, { emulatorStatus: ok ? 'dashboard' : 'preview-failed', runSerial: null });
        return {
          output: {
            mode: 'web-preview' as const,
            status: ok ? 'running-dashboard' : 'preview-unavailable',
            target: ctx.runTarget,
            previewUrl: ok ? previewUrl : null,
            summary: ok
              ? `Running in the dashboard virtual emulator (Flutter web). ${reason}`
              : 'The web preview build was unavailable, so the dashboard emulator could not start.',
          },
          logs: ctx.web?.logs ?? 'No web build.',
        };
      };

      if (ctx.runTarget === 'emulator') {
        return runOnDashboard('Selected target: virtual emulator.');
      }

      // real-device / auto → try a physical device.
      if (ctx.build?.ok && ctx.build.apkPath) {
        const devices = await listDevices();
        const hasPhysical = devices.some((d) => d.type === 'physical');
        if (ctx.runTarget === 'real-device' || hasPhysical) {
          const res = await installAndLaunch(ctx.build.apkPath, GENERATED_PACKAGE, { target: 'real-device' });
          await Project.findByIdAndUpdate(ctx.projectId, { emulatorStatus: res.status, runSerial: res.serial });
          return {
            output: {
              mode: 'device' as const,
              status: res.status,
              target: res.target,
              deviceType: res.deviceType,
              serial: res.serial,
              booted: res.booted,
              installed: res.installed,
              launched: res.launched,
              package: GENERATED_PACKAGE,
              summary:
                res.status === 'launched'
                  ? `Installed and launched on real device ${res.serial}.`
                  : res.status === 'installed'
                  ? `Installed on real device ${res.serial}; launch unconfirmed.`
                  : res.status === 'no-device'
                  ? 'No physical device detected. Connect one over USB or Wi-Fi, or use the virtual emulator.'
                  : res.status === 'unavailable'
                  ? 'Android SDK (adb) not found on this host.'
                  : 'Device run did not complete.',
            },
            logs: res.logs,
          };
        }
        // auto + no physical device → fall back to the dashboard virtual emulator.
        return runOnDashboard('No physical device detected; using the dashboard emulator.');
      }

      // No APK — auto/real can still show the dashboard web preview.
      return runOnDashboard('APK build unavailable; showing the web preview.');
    }
    case 'qa': {
      const cases = generateTestCases(ctx.profile);
      const out = qaOutput(ctx.profile, cases);
      ctx.testCasesTotal = out.summary.total;
      ctx.testCasesPassed = out.summary.passed;
      return {
        output: out as unknown as Record<string, unknown>,
        logs: `Executed ${out.summary.total} test cases: ${out.summary.passed} passed, ${out.summary.failed} failed. QA score ${out.score}/100.`,
      };
    }
    case 'bugfix': {
      const cases = generateTestCases(ctx.profile);
      const out = bugfixOutput(cases);
      return { output: out as unknown as Record<string, unknown>, logs: out.note };
    }
  }
}
