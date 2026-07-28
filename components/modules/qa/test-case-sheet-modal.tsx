'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  Copy, Download, Eye, FileSpreadsheet, Loader2, Pencil,
  Search, Star, Trash2, UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  duplicateTestCaseSheet, deleteTestCaseSheet, toggleSheetFavorite, uploadTestCaseSheet,
} from '@/app/qa/sheets/actions';
import { exportExcel } from '@/lib/qa/export';
import { parseSheetPreview, type SheetPreview } from '@/lib/qa/sheet-preview';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TestCaseSheetEditor } from '@/components/modules/qa/test-case-sheet-editor';

export interface RepositorySheetSummary {
  id: string;
  sheetName: string;
  platform: 'android' | 'ios' | 'web';
  // Kept on the summary for search purposes even though none of these are
  // shown as table columns anymore.
  projectName: string;
  applicationName: string;
  module: string;
  currentVersion: string;
  versionCount: number;
  totalTestCases: number;
  uploadedByName: string;
  status: 'active' | 'archived';
  isFavorite: boolean;
  createdAt: string;
  lastModified: string;
}

/** The Repository groups sheets into these three sections — same application
 * types offered on the execution page's own Source Type tabs. */
const PLATFORM_TABS = [
  { value: 'android', label: '📱 Android Application' },
  { value: 'ios', label: '🍎 iOS Application' },
  { value: 'web', label: '🌐 Web Application' },
] as const;

const PAGE_SIZES = [10, 25, 50];

function formatDateTime(v: string): string {
  return new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TestCaseSheetModal({
  open, onOpenChange, onSelect, pendingFile, onPendingFileConsumed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user picks a sheet+version for execution. */
  onSelect: (sheet: { id: string; sheetName: string; versionIndex: number; versionLabel: string; totalTestCases: number }) => void;
  /** A file dropped directly onto the "Select Test Case Sheet" trigger before
   * this modal was even open — fast-tracked straight into the Upload dialog
   * with its preview, instead of making the user pick it again from disk. */
  pendingFile?: File | null;
  onPendingFileConsumed?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [sheets, setSheets] = useState<RepositorySheetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [recent, setRecent] = useState<Array<{ id: string; sheetName: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Which application-type section is showing — sheets are grouped
  // separately by platform rather than mixed in one flat list.
  const [platformTab, setPlatformTab] = useState<'android' | 'ios' | 'web'>('android');
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [viewingSheetId, setViewingSheetId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // A file was dropped directly onto the "Select Test Case Sheet" trigger
  // before the modal opened — jump straight into Upload with it pre-loaded.
  useEffect(() => {
    if (open && pendingFile) setUploadOpen(true);
  }, [open, pendingFile]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      search, platform: platformTab,
      favorites: String(favoritesOnly), sort, page: String(page), pageSize: String(pageSize),
    });
    const res = await fetch(`/api/qa/sheets?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setSheets(data.sheets ?? []);
      setTotal(data.total ?? 0);
      setRecent(data.recent ?? []);
    }
    setLoading(false);
  }, [search, platformTab, favoritesOnly, sort, page, pageSize]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { setPage(1); }, [search, platformTab, favoritesOnly, sort]);

  function pick(sheet: RepositorySheetSummary) {
    // Selecting always targets the sheet's CURRENT version — the same one
    // shown in this table row.
    onSelect({
      id: sheet.id, sheetName: sheet.sheetName, versionIndex: -1 /* server resolves current */,
      versionLabel: sheet.currentVersion, totalTestCases: sheet.totalTestCases,
    });
    onOpenChange(false);
  }

  function onDuplicate(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const r = await duplicateTestCaseSheet(id);
      setBusyId(null);
      if ('error' in r && r.error) { toast.error(r.error); return; }
      toast.success('Sheet duplicated.');
      load();
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This removes all its versions permanently.`)) return;
    setBusyId(id);
    startTransition(async () => {
      const r = await deleteTestCaseSheet(id);
      setBusyId(null);
      if ('error' in r && r.error) { toast.error(r.error); return; }
      toast.success('Sheet deleted.');
      load();
    });
  }

  function onToggleFavorite(id: string) {
    startTransition(async () => {
      const r = await toggleSheetFavorite(id);
      if ('error' in r && r.error) { toast.error(r.error); return; }
      load();
    });
  }


  async function onDownload(sheet: RepositorySheetSummary) {
    const res = await fetch(`/api/qa/sheets/${sheet.id}`);
    if (!res.ok) { toast.error('Could not load the sheet for download.'); return; }
    const data = await res.json();
    const version = data.sheet.versions[data.sheet.currentVersionIndex ?? data.sheet.versions.length - 1];
    const rows = version.rows.map((r: any) => ({
      'TC ID': r.testCaseId, Module: r.module, 'Test Case': r.scenario,
      'Steps': r.steps.join('\n'), 'Expected Result': r.expectedResult,
      Priority: r.priority, Severity: r.severity,
    }));
    exportExcel(sheet.sheetName, rows);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <Dialog open={open && !uploadOpen && !editingSheetId && !viewingSheetId} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[1400px]">
          <DialogHeader>
            <DialogTitle>Test Case Repository</DialogTitle>
          </DialogHeader>

          {/* Sheets are grouped separately by application type rather than
              mixed into one flat list. */}
          <div className="flex flex-wrap items-center gap-2">
            {PLATFORM_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setPlatformTab(t.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                  platformTab === t.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <div className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by sheet, project, or application name..."
                className="h-full w-full bg-transparent text-xs outline-none"
              />
            </div>
            <Button
              size="sm" variant={favoritesOnly ? 'default' : 'outline'} className="h-9 gap-1.5 text-xs"
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              <Star className="h-3.5 w-3.5" /> Favorites
            </Button>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Sort: Recent</SelectItem>
                <SelectItem value="oldest">Sort: Oldest</SelectItem>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="most_cases">Sort: Most Cases</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-3.5 w-3.5" /> Upload New Sheet
            </Button>
          </div>

          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Recent:</span>
              {recent.map((r) => (
                <Badge
                  key={r.id} variant="outline"
                  className="cursor-pointer text-[10px] hover:bg-secondary"
                  onClick={() => setSearch(r.sheetName)}
                >
                  {r.sheetName}
                </Badge>
              ))}
            </div>
          )}

          <div className="max-h-[65vh] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Sheet Name</TableHead>
                  <TableHead>Cases</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">Loading…</TableCell></TableRow>
                ) : sheets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                      No {PLATFORM_TABS.find((t) => t.value === platformTab)?.label} test case sheets yet. Click <strong>Upload New Sheet</strong> to add one.
                    </TableCell>
                  </TableRow>
                ) : sheets.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <button onClick={() => onToggleFavorite(s.id)} title="Toggle favorite">
                        <Star className={`h-3.5 w-3.5 ${s.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs font-medium">
                      <span className="flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {s.sheetName}</span>
                    </TableCell>
                    <TableCell className="text-xs">{s.totalTestCases}</TableCell>
                    <TableCell className="max-w-[110px] truncate text-xs text-muted-foreground">{s.uploadedByName || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(s.lastModified)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="h-7 text-[11px]" onClick={() => pick(s)}>Select</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => setViewingSheetId(s.id)}><Eye className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditingSheetId(s.id)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicate" disabled={busyId === s.id} onClick={() => onDuplicate(s.id)}>
                          {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Download" onClick={() => onDownload(s)}><Download className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" disabled={busyId === s.id} onClick={() => onDelete(s.id, s.sheetName)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-[70px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span>Page {page} of {totalPages} · {total} sheet(s)</span>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <UploadSheetDialog
        open={uploadOpen}
        onOpenChange={(v) => { setUploadOpen(v); if (!v) onPendingFileConsumed?.(); }}
        onUploaded={() => { load(); }}
        presetFile={pendingFile ?? null}
        onPresetConsumed={onPendingFileConsumed}
        defaultPlatform={platformTab}
      />

      {editingSheetId && (
        <TestCaseSheetEditor
          sheetId={editingSheetId}
          readOnly={false}
          onClose={() => { setEditingSheetId(null); load(); }}
        />
      )}
      {viewingSheetId && (
        <TestCaseSheetEditor
          sheetId={viewingSheetId}
          readOnly
          onClose={() => setViewingSheetId(null)}
        />
      )}
    </>
  );
}

function UploadSheetDialog({
  open, onOpenChange, onUploaded, presetFile, onPresetConsumed, defaultPlatform,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; onUploaded: () => void;
  /** A file already chosen (e.g. dropped on the trigger before this dialog opened) — loaded automatically instead of asking the user to browse again. */
  presetFile?: File | null;
  onPresetConsumed?: () => void;
  /** Pre-selects the application type to match whichever Repository section was open when Upload was clicked. */
  defaultPlatform?: 'android' | 'ios' | 'web';
}) {
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [platform, setPlatform] = useState<'android' | 'ios' | 'web'>(defaultPlatform ?? 'android');
  const [projectName, setProjectName] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const consumedPresetRef = useRef<File | null>(null);

  useEffect(() => {
    if (open && defaultPlatform) setPlatform(defaultPlatform);
  }, [open, defaultPlatform]);

  function reset() {
    setFile(null); setSheetName(''); setProjectName(''); setApplicationName('');
    setIsDragging(false); setPreview(null); setPreviewError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function acceptFile(f: File | null) {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      toast.error('Only .xlsx, .xls, or .csv files are supported.');
      return;
    }
    setFile(f);
    if (!sheetName) setSheetName(f.name.replace(/\.(xlsx|xls|csv)$/i, ''));
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await parseSheetPreview(f));
    } catch {
      setPreviewError('Could not preview this file — it will still be validated when uploaded.');
    }
  }

  useEffect(() => {
    if (open && presetFile && consumedPresetRef.current !== presetFile) {
      consumedPresetRef.current = presetFile;
      acceptFile(presetFile);
      onPresetConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetFile]);

  function onSubmit() {
    if (!file) { toast.error('Choose an Excel or CSV file.'); return; }
    const fd = new FormData();
    fd.set('file', file);
    fd.set('sheetName', sheetName);
    fd.set('platform', platform);
    fd.set('projectName', projectName);
    fd.set('applicationName', applicationName);
    startTransition(async () => {
      const r = await uploadTestCaseSheet(fd);
      if ('error' in r && r.error) { toast.error(r.error); return; }
      toast.success('Sheet uploaded to the repository.');
      reset();
      onOpenChange(false);
      onUploaded();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Upload New Sheet</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="repoSheetFile">Excel / CSV file *</Label>
            <label
              htmlFor="repoSheetFile"
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                acceptFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-xs transition',
                isDragging ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40',
              )}
            >
              <UploadCloud className="h-5 w-5 flex-shrink-0" />
              {file ? (
                <span className="flex items-center gap-1.5 truncate text-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> {file.name}</span>
              ) : (
                <span>{isDragging ? 'Drop it here…' : 'Click to browse, or drag & drop a .xlsx or .csv file.'}</span>
              )}
              <input
                ref={inputRef} id="repoSheetFile" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {previewError && <p className="text-[11px] text-destructive">{previewError}</p>}

          {preview && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div><div className="text-[10px] text-muted-foreground">Test Cases</div><div className="text-sm font-semibold">{preview.totalRows}</div></div>
                <div><div className="text-[10px] text-muted-foreground">Columns</div><div className="text-sm font-semibold">{preview.headers.length}</div></div>
                <div><div className="text-[10px] text-muted-foreground">Modules</div><div className="text-sm font-semibold">{preview.modules.length}</div></div>
              </div>
              {preview.rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        {preview.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-border last:border-0">
                          {row.map((cell, ci) => <td key={ci} className="max-w-[100px] truncate whitespace-nowrap px-2 py-1 text-muted-foreground">{String(cell)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Application Type *</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as 'android' | 'ios' | 'web')}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORM_TABS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repoSheetName">Sheet Name</Label>
            <Input id="repoSheetName" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Login Regression Suite" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="repoProjectName">Project Name</Label>
              <Input id="repoProjectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repoAppName">Application Name</Label>
              <Input id="repoAppName" value={applicationName} onChange={(e) => setApplicationName(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <Button className="w-full gap-2" disabled={pending} onClick={onSubmit}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Upload &amp; Save to Repository
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
