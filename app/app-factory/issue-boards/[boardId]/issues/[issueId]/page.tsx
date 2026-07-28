'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Bot, Bug, CalendarClock, ClipboardList, FileText, History, Image as ImageIcon,
  Loader2, MessageSquare, Paperclip, Reply, Send, Sparkles, Terminal, Upload, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  addIssueAttachment, addIssueComment, assignIssueCard, moveIssueCard, updateIssueCard,
} from '../../../actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ISSUE_COLUMNS, ISSUE_STATUS_LABEL, CATEGORY_LABEL, MODULE_TYPE_LABEL,
  PRIORITIES, PRIORITY_BADGE, PRIORITY_LABEL, SEVERITIES, SEVERITY_BADGE,
} from '@/lib/issue-boards/constants';
import { cn } from '@/lib/utils';

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

interface Assignable { id: string; name: string; email: string; role: string }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Section({ title, icon: Icon, children, actions }: {
  title: string;
  icon: typeof Bug;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card/60 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 break-words text-xs', mono && 'font-mono')}>{value || '—'}</div>
    </div>
  );
}

export default function IssueDetailPage({ params }: { params: { boardId: string; issueId: string } }) {
  const { boardId, issueId } = params;
  const [issue, setIssue] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [users, setUsers] = useState<Assignable[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const [comment, setComment] = useState('');
  const [commentKind, setCommentKind] = useState<'qa' | 'developer' | 'note'>('note');
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const [commentFiles, setCommentFiles] = useState<Array<{ name: string; kind: string; dataUrl: string }>>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/app-factory/issue-boards/cards/${issueId}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.error) {
      setIssue(data.issue);
      setBoard(data.board);
      setLabelDraft((data.issue.labels ?? []).join(', '));
    }
    setLoading(false);
  }, [issueId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/app-factory/issue-boards/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.users) setUsers(d.users); })
      .catch(() => null);
  }, []);

  /** Top-level comments with their replies nested one level, as a thread. */
  const threads = useMemo(() => {
    const all: any[] = issue?.comments ?? [];
    const roots = all.filter((c) => !c.parentId);
    return roots.map((root) => ({
      root,
      replies: all.filter((c) => c.parentId === root.id),
    }));
  }, [issue]);

  function run(action: () => Promise<any>, successMessage: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else { toast.success(successMessage); await load(); }
    });
  }

  async function readFiles(files: FileList): Promise<Array<{ name: string; kind: string; dataUrl: string }>> {
    const out: Array<{ name: string; kind: string; dataUrl: string }> = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than 3 MB and was skipped.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      out.push({
        name: file.name,
        kind: file.type.startsWith('image/') ? 'screenshot' : file.type.startsWith('video/') ? 'recording' : 'file',
        dataUrl,
      });
    }
    return out;
  }

  if (loading) {
    return (
      <div className="p-8">
        <Card className="border-border bg-card/40 p-10 text-center text-sm text-muted-foreground backdrop-blur">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading issue…
        </Card>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-8">
        <Card className="border-border bg-card/60 p-10 text-center backdrop-blur">
          <p className="text-sm font-medium">This issue no longer exists.</p>
          <Link href={`/app-factory/issue-boards/${boardId}`} className="mt-3 inline-block text-xs text-primary hover:underline">
            Back to the board
          </Link>
        </Card>
      </div>
    );
  }

  const screenshots: string[] = issue.screenshots ?? [];
  const extraAttachments: any[] = issue.attachments ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      {/* Header + workflow controls */}
      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Link href={`/app-factory/issue-boards/${boardId}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to board">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{issue.issueKey}</span>
                <Badge className={cn('text-[10px] uppercase', PRIORITY_BADGE[issue.priority] ?? '')}>{issue.priority}</Badge>
                <Badge className={cn('text-[10px] capitalize', SEVERITY_BADGE[issue.severity] ?? '')}>{issue.severity}</Badge>
                <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[issue.category] ?? issue.category}</Badge>
                {issue.reopenCount > 0 && (
                  <Badge className="bg-rose-500/15 text-[10px] text-rose-500">Reopened {issue.reopenCount}×</Badge>
                )}
              </div>
              <h1 className="mt-1 font-display text-lg font-semibold leading-snug">{issue.title}</h1>
              {board && (
                <Link href={`/app-factory/issue-boards/${boardId}`} className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-primary">
                  {board.boardName}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
            <Select
              value={issue.status}
              onValueChange={(v) => run(() => moveIssueCard(issueId, v), `Moved to ${ISSUE_STATUS_LABEL[v as keyof typeof ISSUE_STATUS_LABEL]}`)}
            >
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ISSUE_COLUMNS.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.emoji} {c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Assigned Developer</div>
            <Select
              value={issue.assignedToUserId ?? 'unassigned'}
              onValueChange={(v) => run(
                () => assignIssueCard(issueId, v === 'unassigned' ? null : v),
                v === 'unassigned' ? 'Issue unassigned' : 'Issue assigned',
              )}
            >
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Priority</div>
            <Select value={issue.priority} onValueChange={(v) => run(() => updateIssueCard(issueId, { priority: v }), 'Priority updated')}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Severity</div>
            <Select value={issue.severity} onValueChange={(v) => run(() => updateIssueCard(issueId, { severity: v }), 'Severity updated')}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Due Date</div>
            <Input
              type="date"
              className="h-9 text-xs"
              value={issue.dueDate ? new Date(issue.dueDate).toISOString().slice(0, 10) : ''}
              onChange={(e) => run(() => updateIssueCard(issueId, { dueDate: e.target.value || null }), 'Due date updated')}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Labels (comma separated)</div>
            <div className="flex gap-2">
              <Input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} className="h-9 text-xs" placeholder="Functional, UX, Checkout" />
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                disabled={pending}
                onClick={() => run(() => updateIssueCard(issueId, { labels: labelDraft.split(',') }), 'Labels updated')}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* General */}
          <Section title="General" icon={Bug}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issue ID" value={issue.issueKey} mono />
              <Field label="Status" value={ISSUE_STATUS_LABEL[issue.status as keyof typeof ISSUE_STATUS_LABEL] ?? issue.status} />
              <Field label="Priority" value={PRIORITY_LABEL[issue.priority] ?? issue.priority} />
              <Field label="Severity" value={<span className="capitalize">{issue.severity}</span>} />
              <div className="sm:col-span-2">
                <Field label="Title" value={issue.title} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Description" value={<span className="whitespace-pre-wrap">{issue.description}</span>} />
              </div>
              <div className="sm:col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Labels</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(issue.labels ?? []).length === 0
                    ? <span className="text-xs text-muted-foreground">—</span>
                    : issue.labels.map((l: string) => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
                </div>
              </div>
            </div>
          </Section>

          {/* QA details */}
          <Section title="QA Details" icon={ClipboardList}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Test Case ID" value={issue.testCaseId} mono />
              <Field label="Failed Step" value={issue.failedStepNumber != null
                ? `Step ${issue.failedStepNumber}${issue.failedStepText ? ` — ${issue.failedStepText}` : ''}`
                : '—'} />
              <div className="sm:col-span-2">
                <Field label="Expected Result" value={<span className="whitespace-pre-wrap">{issue.expectedResult}</span>} />
              </div>
              <div className="sm:col-span-2">
                <Field label="Actual Result" value={<span className="whitespace-pre-wrap">{issue.actualResult}</span>} />
              </div>
              <div className="sm:col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Steps to Reproduce</div>
                {(issue.stepsToReproduce ?? []).length === 0 ? (
                  <div className="mt-0.5 text-xs">—</div>
                ) : (
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs">
                    {issue.stepsToReproduce.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ol>
                )}
              </div>
            </div>
          </Section>

          {/* Execution details */}
          <Section title="Execution Details" icon={History}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Execution ID" value={`#${issue.executionId}`} mono />
              <Field label="Project" value={issue.projectName} />
              <Field label="Application" value={issue.applicationName} />
              <Field label="Module" value={`${MODULE_TYPE_LABEL[issue.moduleType] ?? issue.moduleType}${issue.module ? ` · ${issue.module}` : ''}`} />
              <Field label="Platform" value={<span className="capitalize">{issue.platform}</span>} />
              <Field label="Device" value={issue.deviceName} />
              <Field label="Build Version" value={issue.buildVersion} />
              <Field label="Screen" value={issue.screenName} />
              <Field label="Detected" value={new Date(issue.createdAt).toLocaleString('en-US')} />
            </div>
          </Section>

          {/* Attachments */}
          <Section
            title="Attachments"
            icon={Paperclip}
            actions={(
              <>
                <input
                  ref={attachInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    if (!e.target.files?.length) return;
                    const files = await readFiles(e.target.files);
                    e.target.value = '';
                    if (files.length === 0) return;
                    startTransition(async () => {
                      for (const f of files) {
                        const res = await addIssueAttachment(issueId, f);
                        if (res?.error) { toast.error(res.error); return; }
                      }
                      toast.success(`${files.length} attachment(s) added`);
                      await load();
                    });
                  }}
                />
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={pending} onClick={() => attachInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Add
                </Button>
              </>
            )}
          >
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <ImageIcon className="h-3 w-3" /> Screenshot Gallery
                </div>
                {screenshots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No screenshot was captured for this issue.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {screenshots.map((src, i) => (
                      <button
                        key={i}
                        onClick={() => setLightbox(src)}
                        className="overflow-hidden rounded-lg border border-border transition hover:border-primary/60"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`Evidence ${i + 1}`} className="h-28 w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Video className="h-3 w-3" /> Screen Recording
                </div>
                {issue.screenRecordingUrl ? (
                  <video src={issue.screenRecordingUrl} controls className="w-full rounded-lg border border-border" />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No screen recording was captured by the execution engine for this run.
                  </p>
                )}
              </div>

              {extraAttachments.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> Added by the team
                  </div>
                  <ul className="space-y-1">
                    {extraAttachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-xs">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <a href={a.dataUrl} download={a.name} className="truncate text-primary hover:underline">{a.name}</a>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {a.addedByName} · {new Date(a.createdAt).toLocaleDateString('en-US')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Terminal className="h-3 w-3" /> Logs
                </div>
                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-[11px] leading-relaxed">
                  {issue.logs || 'No log output was captured.'}
                </pre>
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3 w-3" /> Stack Trace
                </div>
                <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-[11px] leading-relaxed">
                  {issue.stackTrace || 'No stack trace was produced.'}
                </pre>
              </div>

              {(issue.apiRequest || issue.apiResponse) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {issue.apiRequest && (
                    <div>
                      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">API Request</div>
                      <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-[11px]">{issue.apiRequest}</pre>
                    </div>
                  )}
                  {issue.apiResponse && (
                    <div>
                      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">API Response</div>
                      <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-[11px]">{issue.apiResponse}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* AI analysis */}
          <Section title="AI Analysis" icon={Sparkles}>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Bot className="h-3 w-3" /> AI Root Cause Analysis
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">
                  {issue.aiRootCause || 'No AI root-cause analysis is attached to this issue.'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> AI Suggested Fix
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">
                  {issue.aiSuggestedFix || 'No AI fix suggestion is attached to this issue.'}
                </p>
              </div>
            </div>
          </Section>

          {/* Comments */}
          <Section title="Comments" icon={MessageSquare}>
            <div className="space-y-4">
              {threads.length === 0 && (
                <p className="text-xs text-muted-foreground">No comments yet. QA notes and developer notes both live here.</p>
              )}

              {threads.map(({ root, replies }) => (
                <div key={root.id} className="rounded-lg border border-border p-3">
                  <CommentBody comment={root} />
                  {replies.length > 0 && (
                    <div className="mt-3 space-y-3 border-l border-border pl-3">
                      {replies.map((r: any) => <CommentBody key={r.id} comment={r} />)}
                    </div>
                  )}
                  <button
                    onClick={() => setReplyTo({ id: root.id, author: root.authorName })}
                    className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <Reply className="h-3 w-3" /> Reply
                  </button>
                </div>
              ))}

              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                {replyTo && (
                  <div className="mb-2 flex items-center justify-between rounded-md bg-secondary/60 px-2 py-1 text-[11px]">
                    <span>Replying to {replyTo.author}</span>
                    <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                )}
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment. Use @name to mention a teammate…"
                  className="min-h-[80px] text-xs"
                />
                {commentFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {commentFiles.map((f, i) => (
                      <Badge key={i} variant="outline" className="gap-1 text-[10px]">
                        <Paperclip className="h-2.5 w-2.5" />{f.name}
                        <button onClick={() => setCommentFiles((prev) => prev.filter((_, idx) => idx !== i))} className="ml-0.5">×</button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select value={commentKind} onValueChange={(v) => setCommentKind(v as typeof commentKind)}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">Team Comment</SelectItem>
                      <SelectItem value="developer">Developer Note</SelectItem>
                      <SelectItem value="qa">QA Note</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-2.5 text-xs hover:bg-secondary">
                    <Paperclip className="h-3.5 w-3.5" /> Attach
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        if (!e.target.files?.length) return;
                        const files = await readFiles(e.target.files);
                        e.target.value = '';
                        setCommentFiles((prev) => [...prev, ...files].slice(0, 5));
                      }}
                    />
                  </label>
                  <Button
                    size="sm"
                    className="ml-auto h-8 gap-1.5"
                    disabled={pending || !comment.trim()}
                    onClick={() => {
                      const payload = {
                        body: comment, kind: commentKind,
                        parentId: replyTo?.id ?? null, attachments: commentFiles,
                      };
                      startTransition(async () => {
                        const res = await addIssueComment(issueId, payload);
                        if (res?.error) { toast.error(res.error); return; }
                        setComment('');
                        setCommentFiles([]);
                        setReplyTo(null);
                        toast.success('Comment added');
                        await load();
                      });
                    }}
                  >
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Comment
                  </Button>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Activity timeline */}
        <div className="lg:col-span-1">
          <Section title="Activity" icon={History}>
            <ol className="relative space-y-4 border-l border-border pl-4">
              {(issue.activity ?? []).slice().reverse().map((a: any) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary/70 ring-4 ring-card" />
                  <div className="text-xs leading-snug">{a.message}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{a.actorName}</span>
                    <span>·</span>
                    <span>{new Date(a.createdAt).toLocaleString('en-US')}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              Detected {new Date(issue.createdAt).toLocaleDateString('en-US')}
              {issue.closedAt && ` · closed ${new Date(issue.closedAt).toLocaleDateString('en-US')}`}
            </div>
          </Section>
        </div>
      </div>

      {lightbox && (
        <button
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-background/90 p-6 backdrop-blur"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Evidence" className="max-h-full max-w-full rounded-lg border border-border" />
        </button>
      )}
    </div>
  );
}

function CommentBody({ comment }: { comment: any }) {
  const kindLabel = comment.kind === 'qa' ? 'QA Note' : comment.kind === 'developer' ? 'Developer Note' : 'Comment';
  return (
    <div className="flex gap-2.5">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-primary/15 text-[9px] text-primary">{initials(comment.authorName || '?')}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">{comment.authorName}</span>
          <Badge variant="secondary" className="text-[9px]">{kindLabel}</Badge>
          <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString('en-US')}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{comment.body}</p>
        {(comment.attachments ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {comment.attachments.map((a: any, i: number) => (
              <a key={i} href={a.dataUrl} download={a.name} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-primary hover:bg-secondary">
                <Paperclip className="h-2.5 w-2.5" />{a.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
