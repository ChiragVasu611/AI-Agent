'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, ClipboardCopy, ClipboardPaste, History, Loader2, Plus, Redo2, Save, Search, Trash2, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { updateSheetRows, saveAsNewVersion, restoreSheetVersion } from '@/app/qa/sheets/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface SheetRow {
  _id: string;
  testCaseId: string;
  module: string;
  feature: string;
  scenario: string;
  preconditions: string;
  steps: string[];
  testData: string;
  expectedResult: string;
  priority: string;
  severity: string;
}

interface SheetVersion {
  version: string;
  versionNumber: number;
  rows: SheetRow[];
  totalTestCases: number;
  note: string;
  createdAt: string;
}

interface SheetDoc {
  id: string;
  sheetName: string;
  versions: SheetVersion[];
  currentVersionIndex: number;
}

const AUTOSAVE_DELAY_MS = 1500;
const MAX_HISTORY = 50;

let rowIdSeq = 0;
function newRowId(): string {
  // Client-only temp id for a not-yet-persisted row; the server assigns the
  // real one on save. Avoids Date.now()/crypto dependency for a throwaway key.
  rowIdSeq += 1;
  return `new-${rowIdSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankRow(): SheetRow {
  return {
    _id: newRowId(), testCaseId: '', module: '', feature: '', scenario: '', preconditions: '',
    steps: [], testData: '', expectedResult: '', priority: 'p3', severity: 'medium',
  };
}

export function TestCaseSheetEditor({
  sheetId, readOnly, onClose,
}: { sheetId: string; readOnly: boolean; onClose: () => void }) {
  const [sheet, setSheet] = useState<SheetDoc | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<SheetRow[]>([]);
  const [versionNote, setVersionNote] = useState('');
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);

  // Undo/redo: a plain snapshot stack of the rows array. Simple and correct
  // for a table this size — no need for a diff-based history.
  const history = useRef<SheetRow[][]>([]);
  const historyIndex = useRef(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextHistoryPush = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/qa/sheets/${sheetId}`).then((r) => r.json()).then((data) => {
      if (cancelled) return;
      if (data.error) { toast.error(data.error); onClose(); return; }
      const s: SheetDoc = data.sheet;
      setSheet(s);
      const idx = s.currentVersionIndex ?? s.versions.length - 1;
      const initialRows = (s.versions[idx]?.rows ?? []).map((r) => ({ ...r }));
      setRows(initialRows);
      history.current = [initialRows];
      historyIndex.current = 0;
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  const commit = useCallback((next: SheetRow[], opts: { fromHistory?: boolean } = {}) => {
    setRows(next);
    if (!opts.fromHistory) {
      // Drop any redo branch, then push.
      history.current = history.current.slice(0, historyIndex.current + 1);
      history.current.push(next);
      if (history.current.length > MAX_HISTORY) history.current.shift();
      historyIndex.current = history.current.length - 1;
    }
    if (readOnly) return;
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const r = await updateSheetRows(sheetId, next);
      setSaving(false);
      if ('error' in r && r.error) toast.error(r.error);
    }, AUTOSAVE_DELAY_MS);
  }, [sheetId, readOnly]);

  function undo() {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    commit(history.current[historyIndex.current], { fromHistory: true });
  }
  function redo() {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    commit(history.current[historyIndex.current], { fromHistory: true });
  }

  function updateCell(id: string, field: keyof SheetRow, value: string | string[]) {
    commit(rows.map((r) => (r._id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    commit([...rows, blankRow()]);
  }
  function deleteSelected() {
    if (selected.size === 0) return;
    commit(rows.filter((r) => !selected.has(r._id)));
    setSelected(new Set());
  }
  function deleteRow(id: string) {
    commit(rows.filter((r) => r._id !== id));
  }
  function moveRow(id: string, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r._id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    commit(next);
  }
  function copySelected() {
    const copied = rows.filter((r) => selected.has(r._id));
    if (copied.length === 0) { toast.error('Select at least one row to copy.'); return; }
    setClipboard(copied);
    toast.success(`Copied ${copied.length} row(s).`);
  }
  function pasteRows() {
    if (clipboard.length === 0) { toast.error('Clipboard is empty.'); return; }
    const pasted = clipboard.map((r) => ({ ...r, _id: newRowId(), testCaseId: `${r.testCaseId}-COPY` }));
    commit([...rows, ...pasted]);
    toast.success(`Pasted ${pasted.length} row(s).`);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function onSaveAsNewVersion() {
    setSaving(true);
    const r = await saveAsNewVersion(sheetId, rows, versionNote);
    setSaving(false);
    if ('error' in r && r.error) { toast.error(r.error); return; }
    toast.success(`Saved as ${r.version}.`);
    setVersionNote('');
    // Refresh sheet metadata (new version list, currentVersionIndex) in place.
    const data = await fetch(`/api/qa/sheets/${sheetId}`).then((res) => res.json());
    setSheet(data.sheet);
  }

  async function onRestoreVersion(index: number) {
    const r = await restoreSheetVersion(sheetId, index);
    if ('error' in r && r.error) { toast.error(r.error); return; }
    toast.success(`Restored ${r.version}.`);
    const data = await fetch(`/api/qa/sheets/${sheetId}`).then((res) => res.json());
    setSheet(data.sheet);
    const restoredRows = (data.sheet.versions[index]?.rows ?? []).map((row: SheetRow) => ({ ...row }));
    setRows(restoredRows);
    history.current = [restoredRows];
    historyIndex.current = 0;
    setVersionPickerOpen(false);
  }

  const modules = useMemo(() => Array.from(new Set(rows.map((r) => r.module).filter(Boolean))).sort(), [rows]);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (moduleFilter !== 'all' && r.module !== moduleFilter) return false;
      if (!q) return true;
      return r.testCaseId.toLowerCase().includes(q)
        || r.scenario.toLowerCase().includes(q)
        || r.module.toLowerCase().includes(q)
        || r.expectedResult.toLowerCase().includes(q)
        || r.steps.some((s) => s.toLowerCase().includes(q));
    });
  }, [rows, search, moduleFilter]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {readOnly ? 'View Sheet' : 'Edit Sheet'}: {sheet?.sheetName ?? '…'}
            {sheet && <Badge variant="secondary" className="text-[10px]">{sheet.versions[sheet.currentVersionIndex]?.version}</Badge>}
            {!readOnly && (saving
              ? <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
              : <span className="text-[11px] font-normal text-muted-foreground">Saved</span>)}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <div className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search test cases..." className="h-full w-full bg-transparent text-xs outline-none"
                />
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Module" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Modules</SelectItem>
                  {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>

              {!readOnly && (
                <>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px]" onClick={undo} disabled={historyIndex.current <= 0}>
                    <Undo2 className="h-3.5 w-3.5" /> Undo
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px]" onClick={redo} disabled={historyIndex.current >= history.current.length - 1}>
                    <Redo2 className="h-3.5 w-3.5" /> Redo
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px]" onClick={copySelected}>
                    <ClipboardCopy className="h-3.5 w-3.5" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px]" onClick={pasteRows} disabled={clipboard.length === 0}>
                    <ClipboardPaste className="h-3.5 w-3.5" /> Paste
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px] text-destructive" onClick={deleteSelected} disabled={selected.size === 0}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete ({selected.size})
                  </Button>
                  <Button size="sm" className="h-8 gap-1 text-[11px]" onClick={addRow}>
                    <Plus className="h-3.5 w-3.5" /> Add Test Case
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px]" onClick={() => setVersionPickerOpen(true)}>
                <History className="h-3.5 w-3.5" /> Versions ({sheet?.versions.length ?? 0})
              </Button>
            </div>

            <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    {!readOnly && <TableHead className="w-8"></TableHead>}
                    <TableHead className="w-[110px]">TC ID</TableHead>
                    <TableHead className="w-[110px]">Module</TableHead>
                    <TableHead className="min-w-[180px]">Test Case</TableHead>
                    <TableHead className="min-w-[220px]">Steps</TableHead>
                    <TableHead className="min-w-[180px]">Expected Result</TableHead>
                    {!readOnly && <TableHead className="w-[90px]">Order</TableHead>}
                    {!readOnly && <TableHead className="w-8"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                        {rows.length === 0 ? 'No test cases yet — click Add Test Case to start.' : 'No test cases match this search/filter.'}
                      </TableCell>
                    </TableRow>
                  ) : filteredRows.map((row) => (
                    <TableRow key={row._id}>
                      {!readOnly && (
                        <TableCell><Checkbox checked={selected.has(row._id)} onCheckedChange={() => toggleSelect(row._id)} /></TableCell>
                      )}
                      <TableCell className="align-top">
                        {readOnly ? <span className="text-xs font-mono">{row.testCaseId}</span> : (
                          <Input className="h-7 text-xs" value={row.testCaseId} onChange={(e) => updateCell(row._id, 'testCaseId', e.target.value)} />
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {readOnly ? <span className="text-xs">{row.module}</span> : (
                          <Input className="h-7 text-xs" value={row.module} onChange={(e) => updateCell(row._id, 'module', e.target.value)} />
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {readOnly ? <span className="text-xs">{row.scenario}</span> : (
                          <Textarea className="min-h-[32px] text-xs" value={row.scenario} onChange={(e) => updateCell(row._id, 'scenario', e.target.value)} />
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {readOnly ? (
                          <ol className="list-inside list-decimal text-xs text-muted-foreground">
                            {row.steps.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                        ) : (
                          <Textarea
                            className="min-h-[60px] text-xs"
                            value={row.steps.join('\n')}
                            placeholder="One step per line"
                            onChange={(e) => updateCell(row._id, 'steps', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                          />
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {readOnly ? <span className="text-xs text-muted-foreground">{row.expectedResult}</span> : (
                          <Textarea className="min-h-[32px] text-xs" value={row.expectedResult} onChange={(e) => updateCell(row._id, 'expectedResult', e.target.value)} />
                        )}
                      </TableCell>
                      {!readOnly && (
                        <TableCell className="align-top">
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Move up" onClick={() => moveRow(row._id, -1)}><ChevronUp className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Move down" onClick={() => moveRow(row._id, 1)}><ChevronDown className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      )}
                      {!readOnly && (
                        <TableCell className="align-top">
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteRow(row._id)}><X className="h-3.5 w-3.5" /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{filteredRows.length} of {rows.length} test case(s)</span>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <Input
                    value={versionNote} onChange={(e) => setVersionNote(e.target.value)}
                    placeholder="Version note (optional)" className="h-8 w-[220px] text-xs"
                  />
                  <Button size="sm" className="h-8 gap-1.5 text-[11px]" onClick={onSaveAsNewVersion} disabled={saving}>
                    <Save className="h-3.5 w-3.5" /> Save As New Version
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>

      <Dialog open={versionPickerOpen} onOpenChange={setVersionPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Version History</DialogTitle></DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {sheet?.versions.slice().reverse().map((v, revIdx) => {
              const idx = sheet.versions.length - 1 - revIdx;
              const isCurrent = idx === sheet.currentVersionIndex;
              return (
                <div key={idx} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${isCurrent ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      {v.version} {isCurrent && <Badge className="text-[9px]">Current</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {v.totalTestCases} case(s) · {new Date(v.createdAt).toLocaleString()}{v.note ? ` · ${v.note}` : ''}
                    </div>
                  </div>
                  {!isCurrent && !readOnly && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onRestoreVersion(idx)}>Restore</Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
