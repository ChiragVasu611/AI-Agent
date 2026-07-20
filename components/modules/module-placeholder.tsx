'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
  features,
  accent,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  features: string[];
  accent: string;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <div className="flex items-start gap-4">
        <div className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${accent} text-foreground`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" /> Coming soon
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <motion.div
            key={f}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="h-full border-border bg-card/60 p-5 backdrop-blur">
              <div className="mb-2 h-1.5 w-8 rounded-full bg-primary/40" />
              <p className="text-sm font-medium">{f}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-card/40 px-6 py-12 text-center backdrop-blur">
        <p className="text-sm text-muted-foreground">
          This module is part of the Enterprise AI roadmap. Its workflow will plug into the
          shared agent pipeline without touching existing modules.
        </p>
        <Link href="/dashboard/app-factory">
          <Button variant="outline" className="gap-2">
            Try the live App Factory <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </Card>
    </div>
  );
}
