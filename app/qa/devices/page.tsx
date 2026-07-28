'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  Battery, BatteryCharging, Cable, CheckCircle2, Cpu, Loader2, Monitor, RefreshCw,
  RotateCcw, ScrollText, Smartphone, TriangleAlert, Usb, Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { restartAdbServer, reconnectQaDevice, fetchAdbLogs } from '@/app/qa/devices/actions';
import { getSelectedDeviceId, setSelectedDeviceId } from '@/lib/qa/selected-device';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/** How often to re-scan for connected hardware. */
const POLL_MS = 4000;

interface DetectedDevice {
  id: string; name: string; model: string; manufacturer: string;
  platform: 'android' | 'ios'; type: string; osVersion: string;
  apiLevel: string | null; resolution: string | null;
  battery: number | null; charging: boolean | null;
  connection: 'usb' | 'wifi' | 'unknown';
  authorization: 'authorized' | 'unauthorized' | 'unknown';
  state: 'online' | 'offline';
}

interface DetectionIssue {
  code: string; platform: 'android' | 'ios';
  title: string; detail: string; remediation: string[];
}

interface Scan {
  devices: DetectedDevice[];
  online: DetectedDevice[];
  issues: DetectionIssue[];
  android: { toolAvailable: boolean; toolPath: string | null; version: string | null };
  ios: { toolAvailable: boolean; toolName: string | null };
  scannedAt: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}

export default function DevicesPage() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Avoids overlapping scans if one poll runs long.
  const inFlight = useRef(false);

  // Wireless connect form
  const [connectHost, setConnectHost] = useState('');
  const [connectPort, setConnectPort] = useState('5555');
  const [connecting, setConnecting] = useState(false);

  // Wireless pair form (Android 11+)
  const [pairHost, setPairHost] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/qa/devices', { cache: 'no-store' });
      if (res.ok) setScan(await res.json());
    } catch {
      // transient fetch failure — the next poll will retry
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setSelected(getSelectedDeviceId());
    load();
    const t = setInterval(load, POLL_MS);
    // Re-scan immediately when the tab regains focus — the user has usually
    // just plugged something in.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const online = scan?.online ?? [];
  const problem = (scan?.devices ?? []).filter((d) => d.state !== 'online');

  function selectDevice(d: DetectedDevice) {
    setSelectedDeviceId(d.id);
    setSelected(d.id);
    toast.success(`${d.name} selected for test execution.`);
  }

  function onRestartAdb() {
    setBusy('adb');
    startTransition(async () => {
      const r = await restartAdbServer();
      setBusy(null);
      if ('error' in r && r.error) toast.error(r.error);
      else toast.success('ADB server restarted.');
      load();
    });
  }

  function onReconnect(serial: string) {
    setBusy(serial);
    startTransition(async () => {
      const r = await reconnectQaDevice(serial);
      setBusy(null);
      if ('error' in r && r.error) toast.error(r.error);
      else toast.success(`Reconnect requested for ${serial}.`);
      load();
    });
  }

  function onViewLogs(serial: string | null) {
    setBusy('logs');
    startTransition(async () => {
      const r = await fetchAdbLogs(serial);
      setBusy(null);
      if ('error' in r && r.error) { toast.error(r.error); return; }
      setLogs(('output' in r ? r.output : '') || 'No log output.');
      setLogsOpen(true);
    });
  }

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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Device Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live USB detection for physically connected Android and iOS devices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={online.length > 0 ? 'default' : 'secondary'} className="gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${online.length > 0 ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
            {online.length} online
          </Badge>
          <Button size="sm" variant="outline" onClick={load} disabled={pending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={onRestartAdb} disabled={pending}>
            {busy === 'adb' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            Restart ADB
          </Button>
          <Button size="sm" variant="outline" onClick={() => onViewLogs(selected)} disabled={pending}>
            <ScrollText className="mr-1.5 h-3.5 w-3.5" /> ADB Logs
          </Button>
        </div>
      </div>

      {/* Toolchain status — makes it obvious why a platform reports nothing. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex items-center gap-3 border-border bg-card/60 p-4 backdrop-blur">
          <Cpu className={`h-4 w-4 ${scan?.android.toolAvailable ? 'text-emerald-500' : 'text-muted-foreground'}`} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">Android — ADB {scan?.android.version ? `v${scan.android.version}` : ''}</div>
            <div className="truncate text-muted-foreground">{scan?.android.toolPath ?? 'Not detected'}</div>
          </div>
          <Badge variant={scan?.android.toolAvailable ? 'default' : 'secondary'} className="text-[10px]">
            {scan?.android.toolAvailable ? 'Ready' : 'Unavailable'}
          </Badge>
        </Card>
        <Card className="flex items-center gap-3 border-border bg-card/60 p-4 backdrop-blur">
          <Monitor className={`h-4 w-4 ${scan?.ios.toolAvailable ? 'text-emerald-500' : 'text-muted-foreground'}`} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">iOS — {scan?.ios.toolName ?? 'no bridge'}</div>
            <div className="truncate text-muted-foreground">
              {scan?.ios.toolAvailable ? 'Device bridge available' : 'libimobiledevice / Xcode device tools not found'}
            </div>
          </div>
          <Badge variant={scan?.ios.toolAvailable ? 'default' : 'secondary'} className="text-[10px]">
            {scan?.ios.toolAvailable ? 'Ready' : 'Unavailable'}
          </Badge>
        </Card>
      </div>

      {!loaded && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      )}

      {/* Connected, usable devices */}
      {online.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {online.map((d) => (
            <Card
              key={d.id}
              className={`border-border bg-card/60 p-5 backdrop-blur transition ${selected === d.id ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="mb-3 flex items-start justify-between">
                <Smartphone className="h-5 w-5 text-primary" />
                <div className="flex flex-col items-end gap-1">
                  <Badge className="gap-1 bg-emerald-500/15 text-[10px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    {d.connection === 'wifi' ? <Wifi className="h-2.5 w-2.5" /> : <Usb className="h-2.5 w-2.5" />}
                    {d.connection.toUpperCase()}
                  </Badge>
                </div>
              </div>

              <h3 className="font-display text-sm font-semibold">{d.name}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{d.manufacturer} {d.model}</p>

              <div className="space-y-1 border-t border-border pt-3 text-[11px]">
                <Row label="Device ID" value={<span className="font-mono">{d.id}</span>} />
                <Row label="OS Version" value={d.osVersion} />
                {d.apiLevel && <Row label="API Level" value={d.apiLevel} />}
                {d.resolution && <Row label="Resolution" value={d.resolution} />}
                <Row
                  label="Battery"
                  value={d.battery != null ? (
                    <span className="inline-flex items-center gap-1">
                      {d.charging ? <BatteryCharging className="h-3 w-3 text-emerald-500" /> : <Battery className="h-3 w-3" />}
                      {d.battery}%
                    </span>
                  ) : '—'}
                />
                <Row
                  label="Authorization"
                  value={<span className={d.authorization === 'authorized' ? 'text-emerald-500' : 'text-amber-500'}>
                    {d.authorization === 'authorized' ? 'Authorized' : 'Unauthorized'}
                  </span>}
                />
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  variant={selected === d.id ? 'default' : 'outline'}
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => selectDevice(d)}
                >
                  {selected === d.id ? <><CheckCircle2 className="mr-1 h-3 w-3" /> Selected</> : 'Select for Execution'}
                </Button>
                {d.platform === 'android' && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px]"
                    disabled={pending} onClick={() => onReconnect(d.id)} title="Reconnect device"
                  >
                    {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && online.some((d) => d.id === selected) && (
        <Card className="border-border bg-card/40 p-3 text-[11px] text-muted-foreground backdrop-blur">
          <span className="font-medium text-foreground">Selected device is recorded for test execution.</span>{' '}
          Detection, properties, and logs above are read live from the real device over ADB. Actually
          <em> driving</em> UI steps on it additionally requires an Appium server, which is not installed here —
          until then, mobile runs still execute on the simulated engine and say so in the run report.
        </Card>
      )}

      {/* Detected but unusable (unauthorized / offline) */}
      {problem.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Detected but not usable</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problem.map((d) => (
              <Card key={d.id} className="border-amber-500/30 bg-amber-500/5 p-5">
                <div className="mb-2 flex items-start justify-between">
                  <TriangleAlert className="h-5 w-5 text-amber-500" />
                  <Badge variant="outline" className="text-[10px] capitalize">{d.authorization}</Badge>
                </div>
                <h3 className="font-display text-sm font-semibold">{d.name}</h3>
                <p className="font-mono text-[11px] text-muted-foreground">{d.id}</p>
                <Button
                  size="sm" variant="outline" className="mt-3 h-7 w-full text-[11px]"
                  disabled={pending} onClick={() => onReconnect(d.id)}
                >
                  {busy === d.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                  Reconnect
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state + troubleshooting, driven by the real detection reason */}
      {loaded && online.length === 0 && problem.length === 0 && (
        <Card className="flex flex-col items-center gap-3 border-dashed border-border bg-card/40 px-6 py-14 text-center backdrop-blur">
          <Cable className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No Devices Connected</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Connect an Android or iOS device over USB, or pair one wirelessly below. This page re-scans
              automatically every {POLL_MS / 1000} seconds — no manual refresh needed.
            </p>
          </div>
        </Card>
      )}

      {/* Exact reasons reported by the toolchain */}
      {(scan?.issues.length ?? 0) > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Why devices may not appear</h2>
          {scan!.issues.map((issue, i) => (
            <Card key={`${issue.code}-${i}`} className="border-border bg-card/60 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold">{issue.title}</h3>
                    <Badge variant="outline" className="text-[9px] uppercase">{issue.platform}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{issue.detail}</p>
                  <ol className="mt-2 list-inside list-decimal space-y-0.5 text-[11px] text-muted-foreground">
                    {issue.remediation.map((step, si) => <li key={si}>{step}</li>)}
                  </ol>
                </div>
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

      {scan && (
        <p className="text-center text-[11px] text-muted-foreground">
          Last scanned {new Date(scan.scannedAt).toLocaleTimeString()} · auto-refreshing every {POLL_MS / 1000}s
        </p>
      )}

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>ADB Logs {selected ? `— ${selected}` : ''}</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-secondary/30 p-3 font-mono text-[10px] leading-relaxed">
            {logs}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
