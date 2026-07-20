'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight, Bot, Boxes, Cpu, Gauge, Layers, Shield, Sparkles, Workflow,
} from 'lucide-react';

const modules = [
  { name: 'AI App Factory', desc: 'Reference URL → production APK in one pipeline.', icon: Bot },
  { name: 'QA Automation', desc: 'Crash, perf, security, accessibility testing.', icon: Shield },
  { name: 'AI HR Assistant', desc: 'Screening, onboarding, policy Q&A.', icon: Boxes },
  { name: 'AI Marketing Agent', desc: 'Campaigns, copy, audience segmentation.', icon: Sparkles },
  { name: 'UI/UX AI Designer', desc: 'Wireframes, design systems, prototypes.', icon: Layers },
  { name: 'Future AI Modules', desc: 'Plug-in new agents without touching core.', icon: Cpu },
];

const pipeline = ['Analyzer', 'Planner', 'UI Designer', 'Code Gen', 'Build', 'Emulator', 'QA', 'Bug Fix'];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground glow">
            <Workflow className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">Enterprise AI</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-16 pb-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          8 autonomous agents online
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mx-auto mt-8 max-w-4xl font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl"
        >
          One platform.
          <br />
          <span className="text-gradient">Every AI agent.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
        >
          Sign in once and orchestrate an entire fleet of AI agents. Drop a reference
          app URL, watch the pipeline build, test, and ship a downloadable APK.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-10 flex items-center justify-center gap-3"
        >
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground glow transition hover:opacity-90"
          >
            Start building free
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-6 py-3 text-sm font-semibold backdrop-blur transition hover:bg-card"
          >
            Sign in
          </Link>
        </motion.div>

        {/* Pipeline strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mx-auto mt-16 flex max-w-5xl flex-wrap items-center justify-center gap-2"
        >
          {pipeline.map((p, i) => (
            <div key={p} className="flex items-center gap-2">
              <div className="rounded-lg border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
                {i + 1}. {p}
              </div>
              {i < pipeline.length - 1 && <ArrowRight className="h-3 w-3 text-primary/60" />}
            </div>
          ))}
        </motion.div>
      </section>

      {/* Modules grid */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => (
            <motion.div
              key={m.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-6 backdrop-blur transition hover:border-primary/40"
            >
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/20" />
              <m.icon className="h-7 w-7 text-primary" />
              <h3 className="mt-4 font-display text-lg font-semibold">{m.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Gauge, label: 'Avg. build time', value: '< 6 min' },
            { icon: Shield, label: 'QA coverage', value: '8 suites' },
            { icon: Cpu, label: 'AI models', value: 'NVIDIA Nemotron' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur">
              <s.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 font-display text-2xl font-semibold">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-8 text-center text-xs text-muted-foreground">
          Enterprise AI Agent Framework · Modular · Secure · Scalable
        </div>
      </footer>
    </div>
  );
}
