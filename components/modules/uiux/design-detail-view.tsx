'use client';

import { useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { DESIGN_AGENT_BY_ID, DESIGN_PIPELINE_ORDER } from '@/lib/ai/design-agents';
import { DesignOutputViewer } from './design-output-viewer';
import type { DesignAgentRun, DesignProject } from '@/lib/types';

export function DesignDetailView({
  project,
  runs,
}: {
  project: DesignProject;
  runs: DesignAgentRun[];
}) {
  const searchParams = useSearchParams();
  const runByAgent = new Map(runs.map((r) => [r.agent, r]));
  const availableAgents = DESIGN_PIPELINE_ORDER.filter((id) => runByAgent.has(id));
  const requestedTab = searchParams.get('tab');
  const defaultTab = requestedTab && runByAgent.has(requestedTab as never)
    ? requestedTab
    : availableAgents[availableAgents.length - 1] ?? 'overview';

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
        <TabsTrigger value="overview" className="data-[state=active]:bg-secondary">Overview</TabsTrigger>
        {availableAgents.map((agentId) => (
          <TabsTrigger key={agentId} value={agentId} className="data-[state=active]:bg-secondary">
            {DESIGN_AGENT_BY_ID[agentId].name}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">{project.status}</Badge>
            <Badge variant="secondary" className="capitalize">{project.platform}</Badge>
            <Badge variant="secondary" className="capitalize">{project.style}</Badge>
            {project.score != null && <Badge className="bg-success/15 text-success">{project.score}/100</Badge>}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brief</div>
            <p className="text-sm text-foreground/90">{project.brief}</p>
          </div>
          {project.referenceUrl && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference</div>
              <p className="break-all text-sm text-primary">{project.referenceUrl}</p>
            </div>
          )}
          {project.summary && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</div>
              <p className="text-sm text-foreground/90">{project.summary}</p>
            </div>
          )}
        </div>
      </TabsContent>

      {availableAgents.map((agentId) => {
        const run = runByAgent.get(agentId);
        return (
          <TabsContent key={agentId} value={agentId}>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground">{DESIGN_AGENT_BY_ID[agentId].description}</p>
            </div>
            {run?.status === 'failed' ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">This agent failed to run.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.logs?.includes('429')
                    ? 'The OpenRouter free-tier daily rate limit was hit. Try again after the quota resets, or add credits to your OpenRouter account.'
                    : (run.logs || 'Unknown error.')}
                </p>
              </div>
            ) : (
              <DesignOutputViewer output={run?.output ?? null} />
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
