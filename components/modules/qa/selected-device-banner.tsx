'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Smartphone, TriangleAlert } from 'lucide-react';
import { getSelectedDeviceId } from '@/lib/qa/selected-device';

interface Device { id: string; name: string; model: string; osVersion: string; platform: string }

/**
 * Shows which physical device an execution will actually run on, so the choice
 * made on QA → Devices is visible at the moment it matters. Only relevant for
 * mobile sources — web runs execute in headless Chromium.
 */
export function SelectedDeviceBanner({ show }: { show: boolean }) {
  const [online, setOnline] = useState<Device[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    setSelectedId(getSelectedDeviceId());
    let cancelled = false;
    const load = () => {
      fetch('/api/qa/devices', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setOnline(d.online ?? []); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 6000);
    return () => { cancelled = true; clearInterval(t); };
  }, [show]);

  if (!show || online === null) return null;

  const android = online.filter((d) => d.platform === 'android');
  const chosen = selectedId ? android.find((d) => d.id === selectedId) : null;

  let tone = 'border-border bg-card/40 text-muted-foreground';
  let icon = <Smartphone className="h-3.5 w-3.5 shrink-0" />;
  let message: React.ReactNode;

  if (android.length === 0) {
    tone = 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400';
    icon = <TriangleAlert className="h-3.5 w-3.5 shrink-0" />;
    message = <>No Android device is connected. A mobile run will be reported as <strong>blocked</strong> rather than executed.</>;
  } else if (chosen) {
    message = <>Will run on <strong className="text-foreground">{chosen.name}</strong> — {chosen.model}, {chosen.osVersion}.</>;
  } else if (selectedId) {
    tone = 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400';
    icon = <TriangleAlert className="h-3.5 w-3.5 shrink-0" />;
    message = <>The device you selected is not connected. This run will fall back to <strong className="text-foreground">{android[0].name}</strong>.</>;
  } else if (android.length === 1) {
    message = <>Will run on <strong className="text-foreground">{android[0].name}</strong> — the only connected device.</>;
  } else {
    message = <>{android.length} devices connected and none selected — the run will use <strong className="text-foreground">{android[0].name}</strong>.</>;
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] ${tone}`}>
      {icon}
      <span className="flex-1">{message}</span>
      <Link href="/qa/devices" className="shrink-0 underline underline-offset-2 hover:text-foreground">
        Devices
      </Link>
    </div>
  );
}
