'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Play, RefreshCw, Smartphone, Monitor, Wifi, Usb, Cpu, CircleAlert, Radio, MonitorSmartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface DeviceInfo {
  serial: string;
  type: 'emulator' | 'physical';
  connection: 'usb' | 'wifi';
  model: string;
  state: string;
}
type RunTarget = 'auto' | 'emulator' | 'real-device';

export function DevicePanel({
  projectId, apkReady, webReady,
}: {
  projectId: string | null;
  apkReady: boolean;
  webReady: boolean;
}) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [toolchain, setToolchain] = useState<{ adb: boolean; emulator: boolean; flutter: boolean } | null>(null);
  const [target, setTarget] = useState<RunTarget>('emulator');
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState(false);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [wifiPending, setWifiPending] = useState(false);
  const [frameOk, setFrameOk] = useState(true);
  const [wifiHost, setWifiHost] = useState('');
  const [wifiPort, setWifiPort] = useState('5555');
  const [connecting, setConnecting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const isVirtual = target === 'emulator';

  const refreshDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/app-factory/devices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setDevices(data.devices ?? []);
      setToolchain(data.status ?? null);
      setSelectedSerial((prev) => {
        if (prev && (data.devices ?? []).some((d: DeviceInfo) => d.serial === prev)) return prev;
        return (data.devices ?? [])[0]?.serial ?? null;
      });
    } catch {
      /* offline; ignore */
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const id = setInterval(refreshDevices, 5000);
    return () => clearInterval(id);
  }, [refreshDevices]);

  // Auto-show the dashboard virtual emulator when a web build is ready.
  useEffect(() => {
    if (isVirtual && projectId && webReady) {
      setPreviewUrl(`/api/app-factory/preview/${projectId}/`);
      setMirroring(false);
    } else if (!isVirtual) {
      setPreviewUrl(null);
    }
  }, [isVirtual, projectId, webReady]);

  // Live screen mirror (real device) — poll a fresh screenshot while on.
  useEffect(() => {
    if (!mirroring || !selectedSerial || previewUrl) return;
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, [mirroring, selectedSerial, previewUrl]);

  const selectedDevice = devices.find((d) => d.serial === selectedSerial) ?? null;
  const physicalUsb = selectedDevice?.type === 'physical' && selectedDevice.connection === 'usb';

  async function onRun() {
    if (!projectId) {
      toast.error('Select a project first.');
      return;
    }
    setRunning(true);
    try {
      const res = await fetch('/api/app-factory/devices/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, target, serial: selectedSerial ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Run failed');
        return;
      }
      const r = data.result;
      if (r.mode === 'web-preview') {
        if (r.previewUrl) {
          setPreviewUrl(r.previewUrl);
          setPreviewNonce((n) => n + 1);
          setMirroring(false);
          toast.success('Running in the dashboard virtual emulator');
        } else {
          toast.error('Web preview unavailable — rebuild the project.');
        }
      } else if (r.status === 'launched' || r.status === 'installed') {
        setPreviewUrl(null);
        setSelectedSerial(r.serial);
        setMirroring(true);
        setFrameOk(true);
        toast.success(`App ${r.status} on real device ${r.serial}`);
        refreshDevices();
      } else if (r.status === 'no-device') {
        toast.error('No physical device detected.');
      } else if (r.status === 'unavailable') {
        toast.error('Android SDK (adb) not found on this host.');
      } else {
        toast.error('Run did not complete. Check the logs.');
      }
    } finally {
      setRunning(false);
    }
  }

  async function onEnableWifi() {
    if (!selectedDevice) return;
    setWifiPending(true);
    try {
      const res = await fetch('/api/app-factory/devices/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: selectedDevice.serial }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Wi-Fi adb enabled at ${data.wifiSerial}. You can now unplug USB.`);
        if (data.ip) { setWifiHost(data.ip); setWifiPort('5555'); }
        await refreshDevices();
        setSelectedSerial(data.wifiSerial);
      } else {
        toast.error('Could not enable Wi-Fi adb. Ensure the device is on Wi-Fi.');
      }
    } finally {
      setWifiPending(false);
    }
  }

  async function onConnectManual() {
    setConnecting(true);
    try {
      const res = await fetch('/api/app-factory/devices/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: wifiHost.trim(), port: Number(wifiPort) || 5555 }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Connected to ${data.serial}`);
        await refreshDevices();
        setSelectedSerial(data.serial);
      } else {
        toast.error(data.error ?? 'Could not connect. Check the IP, port, and network.');
      }
    } finally {
      setConnecting(false);
    }
  }

  const runLabel = isVirtual ? 'Run on emulator' : target === 'real-device' ? 'Run on real device' : 'Run';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
      {/* Controls */}
      <div className="min-w-0 space-y-4">
        {/* Target picker */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Run target</label>
            <Select value={target} onValueChange={(v) => setTarget(v as RunTarget)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="emulator">Virtual emulator (dashboard)</SelectItem>
                <SelectItem value="real-device">Real device</SelectItem>
                <SelectItem value="auto">Auto-detect</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isVirtual && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Device</label>
              <div className="flex gap-2">
                <Select
                  value={selectedSerial ?? ''}
                  onValueChange={(v) => setSelectedSerial(v)}
                  disabled={devices.length === 0}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder={devices.length ? 'Select device' : 'None detected'} />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d) => (
                      <SelectItem key={d.serial} value={d.serial}>
                        {d.type === 'emulator' ? '🖥️ ' : '📱 '}{d.model} ({d.connection})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={refreshDevices} title="Refresh devices" className="shrink-0">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {isVirtual ? (
          <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-xs text-muted-foreground">
            <MonitorSmartphone className="h-4 w-4 shrink-0 text-primary" />
            <span>The app runs live in the phone frame on this dashboard (Flutter web) — no external device or emulator needed.</span>
          </div>
        ) : (
          <>
            {/* Detected devices */}
            <div className="space-y-1.5">
              {devices.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  {toolchain && !toolchain.adb
                    ? 'Android SDK (adb) not found on this host.'
                    : 'No devices detected. Connect a device over USB or Wi-Fi below.'}
                </div>
              ) : (
                devices.map((d) => (
                  <button
                    key={d.serial}
                    onClick={() => setSelectedSerial(d.serial)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition',
                      selectedSerial === d.serial ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-secondary/50',
                    )}
                  >
                    {d.type === 'emulator' ? <Monitor className="h-4 w-4 shrink-0 text-primary" /> : <Smartphone className="h-4 w-4 shrink-0 text-primary" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{d.model}</span>
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      {d.connection === 'wifi' ? <Wifi className="h-3 w-3" /> : d.type === 'emulator' ? <Cpu className="h-3 w-3" /> : <Usb className="h-3 w-3" />}
                      {d.type === 'emulator' ? 'emulator' : d.connection}
                    </Badge>
                  </button>
                ))
              )}
            </div>

            {/* Wireless connect by IP:port */}
            <div className="rounded-xl border border-border bg-secondary/20 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Radio className="h-3.5 w-3.5" /> Connect over Wi-Fi
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={wifiHost}
                  onChange={(e) => setWifiHost(e.target.value)}
                  placeholder="192.168.1.42"
                  inputMode="decimal"
                  className="min-w-0 flex-1"
                  aria-label="Device IP address"
                />
                <Input
                  value={wifiPort}
                  onChange={(e) => setWifiPort(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="5555"
                  inputMode="numeric"
                  className="w-20 shrink-0"
                  aria-label="Port"
                />
                <Button onClick={onConnectManual} disabled={connecting || !wifiHost.trim()} className="shrink-0 gap-2">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  Connect
                </Button>
              </div>
              {physicalUsb && (
                <Button variant="ghost" size="sm" onClick={onEnableWifi} disabled={wifiPending} className="mt-2 h-7 gap-1.5 px-2 text-xs">
                  {wifiPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Usb className="h-3.5 w-3.5" />}
                  Enable Wi-Fi from this USB device
                </Button>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRun} disabled={running || !projectId || (!apkReady && !webReady)} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {runLabel}
          </Button>
          {previewUrl && (
            <Button variant="outline" onClick={() => setPreviewNonce((n) => n + 1)} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reload app
            </Button>
          )}
          {!isVirtual && (
            <Button variant="outline" onClick={() => setMirroring((m) => !m)} disabled={!selectedSerial} className="gap-2">
              <Monitor className="h-4 w-4" />
              {mirroring ? 'Stop mirror' : 'Live mirror'}
            </Button>
          )}
        </div>

        {!apkReady && !webReady && (
          <p className="text-xs text-muted-foreground">
            Build the app first — the run controls activate once a build completes.
          </p>
        )}
      </div>

      {/* Phone frame — iframe (virtual emulator) or screenshot mirror (real device) */}
      <div className="flex items-start justify-center lg:justify-end">
        <div className="relative aspect-[9/19] w-[190px] shrink-0 rounded-[2rem] border-[6px] border-neutral-800 bg-black shadow-xl sm:w-[210px]">
          <div className="absolute left-1/2 top-1.5 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-neutral-700" />
          <div className="relative h-full w-full overflow-hidden rounded-[1.5rem] bg-neutral-950">
            {previewUrl ? (
              <iframe
                key={previewNonce}
                title="Virtual emulator"
                src={previewUrl}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
            ) : mirroring && selectedSerial ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="Device screen"
                src={`/api/app-factory/devices/screenshot?serial=${encodeURIComponent(selectedSerial)}&t=${tick}`}
                className={cn('h-full w-full object-cover transition-opacity', frameOk ? 'opacity-100' : 'opacity-0')}
                onError={() => setFrameOk(false)}
                onLoad={() => setFrameOk(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-neutral-500">
                <Smartphone className="h-8 w-8" />
                {isVirtual
                  ? projectId
                    ? webReady ? 'Starting virtual emulator…' : 'Build the app, then tap Run to start the emulator'
                    : 'Select a project to run'
                  : selectedSerial
                    ? 'Tap “Run” or “Live mirror”'
                    : 'No device selected'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
