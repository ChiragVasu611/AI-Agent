import Link from 'next/link';
import { ArrowRight, Bot, Boxes, Cpu, Layers, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { Credits } from '@/lib/mongodb/models/Credits';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

const MODULES = [
  {
    name: 'AI App Factory',
    desc: 'Drop a reference app URL and let 8 autonomous agents build, test, and ship an APK.',
    href: '/dashboard/app-factory',
    icon: Bot,
    accent: 'from-sky-500/20 to-blue-500/5',
    status: 'live' as const,
  },
  {
    name: 'QA Automation Agent',
    desc: 'Crash, navigation, API, accessibility, performance, security, memory & battery testing.',
    href: '/dashboard/qa',
    icon: ShieldCheck,
    accent: 'from-emerald-500/20 to-green-500/5',
    status: 'soon' as const,
  },
  {
    name: 'AI HR Assistant',
    desc: 'Recruitment pipeline, AI resume screening, interview assistant, and an HR copilot.',
    href: '/dashboard/hr',
    icon: Boxes,
    accent: 'from-amber-500/20 to-yellow-500/5',
    status: 'live' as const,
  },
  {
    name: 'AI Marketing Agent',
    desc: 'Campaign generation, copywriting, and audience segmentation.',
    href: '/dashboard/marketing',
    icon: Sparkles,
    accent: 'from-pink-500/20 to-rose-500/5',
    status: 'soon' as const,
  },
  {
    name: 'UI/UX AI Designer',
    desc: 'Wireframes, design systems, and interactive prototypes from a brief.',
    href: '/dashboard/uiux',
    icon: Layers,
    accent: 'from-cyan-500/20 to-teal-500/5',
    status: 'live' as const,
  },
  {
    name: 'Future AI Modules',
    desc: 'Plug-in new agents without touching existing core logic.',
    href: '/dashboard/templates',
    icon: Cpu,
    accent: 'from-violet-500/20 to-purple-500/5',
    status: 'soon' as const,
  },
];

export default async function DashboardHome() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const projectDocs = await Project.find({ userId: user?.id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  const projects = projectDocs.map(serializeDoc);

  const credits = user
    ? await Credits.findOne({ userId: user.id }).lean<{ balance: number }>()
    : null;

  const stats = [
    { label: 'Active Projects', value: projects.filter((p) => p.status !== 'completed' && p.status !== 'failed').length },
    { label: 'Completed Builds', value: projects.filter((p) => p.status === 'completed').length },
    { label: 'Credits Balance', value: credits?.balance ?? 100 },
    { label: 'Agents Online', value: 16 },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border bg-card/60 p-5 backdrop-blur">
            <div className="font-display text-3xl font-semibold">{s.value}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Module cards */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">AI Modules</h2>
          <span className="text-xs text-muted-foreground">3 live · 2 coming soon</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Link key={m.name} href={m.href}>
              <Card className="group relative h-full overflow-hidden border-border bg-card/60 p-6 backdrop-blur transition hover:border-primary/40 hover:bg-card">
                <div className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${m.accent} blur-2xl transition group-hover:scale-125`} />
                <div className="relative flex items-start justify-between">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <m.icon className="h-5 w-5" />
                  </div>
                  {m.status === 'soon' ? (
                    <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>
                  ) : (
                    <Badge className="bg-success/15 text-success hover:bg-success/15">Live</Badge>
                  )}
                </div>
                <h3 className="relative mt-4 font-display text-lg font-semibold">{m.name}</h3>
                <p className="relative mt-1 text-sm text-muted-foreground">{m.desc}</p>
                <div className="relative mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition group-hover:opacity-100">
                  Open module <ArrowRight className="h-4 w-4" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent projects */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight">Recent Projects</h2>
          <Link href="/dashboard/projects" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <Card className="overflow-hidden border-border bg-card/60 backdrop-blur">
          {projects && projects.length > 0 ? (
            <div className="divide-y divide-border">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Workflow className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs capitalize text-muted-foreground">{p.status} · {new Date(p.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="hidden w-40 sm:block">
                    <Progress value={p.progress} className="h-1.5" />
                  </div>
                  {p.qaScore != null && (
                    <Badge variant="secondary" className="text-xs">{p.qaScore}/100</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <Bot className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No projects yet. Launch the App Factory to start building.</p>
              <Link href="/dashboard/app-factory" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Open App Factory <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
