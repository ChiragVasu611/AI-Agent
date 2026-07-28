/**
 * Posts an APK/AAB/IPA (plus optional test-case file) to the start-binary
 * Route Handler and normalizes the response into `{ runId }` or `{ error }`.
 *
 * The raw `fetch(...).then((r) => r.json())` pattern this replaces swallowed
 * real failures: when the server (or an intermediary/proxy) returns a non-JSON
 * body — e.g. an oversized-upload rejection or an empty 400 — `r.json()` threw
 * a SyntaxError, so the caller only ever saw the bare HTTP status in the
 * console with no user-facing toast. Here we always resolve to a plain object
 * carrying a human-readable `error` so the UI can surface exactly what failed.
 */
export interface SubmitBinaryRunResult {
  runId?: string;
  error?: string;
}

export async function submitBinaryRun(formData: FormData): Promise<SubmitBinaryRunResult> {
  let res: Response;
  try {
    res = await fetch('/api/qa/runs/start-binary', { method: 'POST', body: formData });
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' };
  }

  const raw = await res.text();
  let data: SubmitBinaryRunResult | null = null;
  if (raw) {
    try { data = JSON.parse(raw) as SubmitBinaryRunResult; } catch { data = null; }
  }

  if (!res.ok) {
    if (data?.error) return { error: data.error };
    if (res.status === 413) {
      return { error: 'The uploaded file is too large for the server to accept. Try a smaller build (under 150MB).' };
    }
    return { error: `Upload failed (HTTP ${res.status}). ${raw ? raw.slice(0, 300) : 'The server rejected the request.'}` };
  }

  if (!data?.runId) {
    return { error: 'The server accepted the upload but did not return a run id.' };
  }
  return { runId: data.runId };
}
