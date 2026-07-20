'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground glow">
            <Workflow className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">Enterprise AI</span>
        </Link>
        <Link href="/" className="text-sm text-muted-foreground transition hover:text-foreground">
          Back home
        </Link>
      </header>

      <div className="relative z-10 mx-auto flex max-w-md flex-col items-center px-6 pt-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full rounded-2xl border border-border bg-card/60 p-8 backdrop-blur"
        >
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </motion.div>
        <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  );
}
