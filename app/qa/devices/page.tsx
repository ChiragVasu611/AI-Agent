'use client';

import { useEffect, useState } from 'react';
import { Cable, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function DevicesPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/qa/devices').then((r) => r.json()).then((d) => {
      setDevices(d.devices ?? []);
      setConfigured(d.configured ?? false);
      setLoaded(true);
    });
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Device Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">Real Android/iOS devices, emulators, and simulators.</p>
        </div>
        <Badge variant={configured ? 'default' : 'secondary'}>{configured ? 'Connected' : 'Not configured'}</Badge>
      </div>

      {loaded && devices.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border-dashed border-border bg-card/40 px-6 py-16 text-center backdrop-blur">
          <Cable className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No device farm connected</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              This page is wired to a device adapter interface (ADB, BrowserStack, AWS Device Farm, or Xcode
              Simulators can all plug in here) but no real device source is configured yet. Test runs currently
              use a simulated device during execution — see a run&apos;s Live Device Preview panel.
            </p>
          </div>
        </Card>
      )}

      {devices.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <Card key={d.id} className="border-border bg-card/60 p-5 backdrop-blur">
              <Smartphone className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-display text-sm font-semibold">{d.name}</h3>
              <p className="text-xs text-muted-foreground capitalize">{d.type.replace('_', ' ')} · {d.osVersion}</p>
              <Badge variant="outline" className="mt-2 text-[10px] capitalize">{d.status}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
