'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, RefreshCw, Smartphone, Wifi, BatteryFull } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Device {
  id: string;
  name: string;
  type: string;
  osVersion: string;
  status: 'online' | 'offline' | 'busy';
  battery: number | null;
}

const STATUS_BADGE: Record<string, string> = {
  online: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  offline: 'bg-secondary text-muted-foreground',
  busy: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Wireless connect form
  const [connectHost, setConnectHost] = useState('');
  const [connectPort, setConnectPort] = useState('5555');
  const [connecting, setConnecting] = useState(false);

  // Wireless pair form (Android 11+)
  const [pairHost, setPairHost] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/qa/devices');
      const d = await res.json();
      setDevices(d.devices ?? []);
      setConfigured(d.configured ?? false);
    } finally {
      setLoaded(true);
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    try {
      const res = await fetch('/api/qa/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', host: connectHost.trim(), port: Number(connectPort) }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { toast.success(data.message || 'Device connected.'); setConnectHost(''); load(); }
      else toast.error(data.message || data.error || 'Could not connect to the device.');
    } catch {
      toast.error('Connection request failed.');
    } finally {
      setConnecting(false);
    }
  }

  async function onPair(e: React.FormEvent) {
    e.preventDefault();
    setPairing(true);
    try {
      const res = await fetch('/api/qa/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pair', host: pairHost.trim(), port: Number(pairPort), code: pairCode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || 'Paired. Now connect using the connection port.');
        setPairCode('');
        load();
      } else toast.error(data.message || data.error || 'Pairing failed.');
    } catch {
      toast.error('Pairing request failed.');
    } finally {
      setPairing(false);
    }
  }

  const onlineCount = devices.filter((d) => d.status === 'online').length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Device Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real Android devices and emulators discovered over ADB. {onlineCount} online.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={configured ? 'default' : 'secondary'}>{configured ? 'ADB ready' : 'ADB not found'}</Badge>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={refreshing} onClick={() => load(true)}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {!configured && loaded && (
        <Card className="border-dashed border-amber-500/40 bg-amber-500/5 p-5 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">ADB was not found on the server.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Install the Android platform-tools and ensure <code className="rounded bg-secondary px-1">adb</code> is on the
            server&apos;s PATH (or set the <code className="rounded bg-secondary px-1">ADB_PATH</code> environment variable).
          </p>
        </Card>
      )}

      {/* Connected devices */}
      {loaded && devices.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed border-border bg-card/40 px-6 py-16 text-center backdrop-blur">
          <Cable className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No devices connected</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Connect an Android device over USB with USB debugging enabled, or pair one wirelessly below. It will appear
              here automatically and become selectable in Test Execution.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <Card key={d.id} className="border-border bg-card/60 p-5 backdrop-blur">
              <div className="flex items-start justify-between">
                <Smartphone className="h-5 w-5 text-primary" />
                <Badge className={`${STATUS_BADGE[d.status] ?? ''} text-[10px] capitalize`}>{d.status}</Badge>
              </div>
              <h3 className="mt-2 font-display text-sm font-semibold">{d.name}</h3>
              <p className="text-xs capitalize text-muted-foreground">{d.type.replace('_', ' ')} · {d.osVersion}</p>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="font-mono">{d.id}</span>
                {d.battery != null && (
                  <span className="flex items-center gap-1"><BatteryFull className="h-3 w-3" /> {d.battery}%</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Wireless connect + pair */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold"><Wifi className="h-4 w-4 text-primary" /> Connect wirelessly</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For a device already in Wireless debugging mode. Use the IP &amp; port shown under
            Developer options → Wireless debugging.
          </p>
          <form onSubmit={onConnect} className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="c-host" className="text-xs">IP address</Label>
                <Input id="c-host" value={connectHost} onChange={(e) => setConnectHost(e.target.value)} placeholder="192.168.1.42" className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-port" className="text-xs">Port</Label>
                <Input id="c-port" value={connectPort} onChange={(e) => setConnectPort(e.target.value)} placeholder="5555" className="h-9 text-xs" required />
              </div>
            </div>
            <Button type="submit" size="sm" className="w-full gap-1.5" disabled={connecting}>
              <Wifi className="h-3.5 w-3.5" /> {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </form>
        </Card>

        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold"><Cable className="h-4 w-4 text-primary" /> Pair (Android 11+)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            First-time Wi-Fi pairing. On the phone: Wireless debugging → &quot;Pair device with pairing code&quot;, then enter
            the IP, <strong>pairing</strong> port, and 6-digit code shown there.
          </p>
          <form onSubmit={onPair} className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="p-host" className="text-xs">IP address</Label>
                <Input id="p-host" value={pairHost} onChange={(e) => setPairHost(e.target.value)} placeholder="192.168.1.42" className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-port" className="text-xs">Pair port</Label>
                <Input id="p-port" value={pairPort} onChange={(e) => setPairPort(e.target.value)} placeholder="37123" className="h-9 text-xs" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-code" className="text-xs">Pairing code</Label>
              <Input id="p-code" value={pairCode} onChange={(e) => setPairCode(e.target.value)} placeholder="123456" className="h-9 text-xs" required />
            </div>
            <Button type="submit" size="sm" variant="outline" className="w-full gap-1.5" disabled={pairing}>
              <Cable className="h-3.5 w-3.5" /> {pairing ? 'Pairing…' : 'Pair'}
            </Button>
          </form>
        </Card>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Note: pairing only establishes trust — after a successful pair, use &quot;Connect wirelessly&quot; with the
        connection port (not the pairing port) to attach the device.
      </p>
    </div>
  );
}
