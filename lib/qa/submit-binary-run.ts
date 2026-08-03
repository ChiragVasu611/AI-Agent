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
 *
 * Uses XMLHttpRequest rather than fetch for ONE reason: fetch cannot report
 * upload progress. A real app binary is 100MB+, and pushing it to the server is
 * by far the longest part of starting a run — measured at ~32s of a 38s wait for
 * a 105MB APK, with metadata parsing (1.0s) and the disk write (0.5s) together
 * under two seconds. That time is inherent, since the bytes have to arrive, but
 * it must not be INVISIBLE: the Start button previously sat on an indefinite
 * spinner for half a minute with no sign anything was happening, which is
 * indistinguishable from a hang. `onProgress` lets the caller show how far the
 * upload has actually got.
 */
export interface SubmitBinaryRunResult {
  runId?: string;
  error?: string;
}

export interface SubmitProgress {
  /** 0-100, or null while the total size is not yet known. */
  percent: number | null;
  loadedBytes: number;
  totalBytes: number;
  /** True once every byte is sent and we are awaiting the server's reply. */
  processing: boolean;
}

export function submitBinaryRun(
  formData: FormData,
  onProgress?: (p: SubmitProgress) => void,
): Promise<SubmitBinaryRunResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/qa/runs/start-binary');

    xhr.upload.onprogress = (e) => {
      onProgress?.({
        // Capped at 99 while bytes are still moving: 100% is reserved for
        // "upload finished, server working", so the label never claims to be
        // done while it is not.
        percent: e.lengthComputable ? Math.min(99, Math.round((e.loaded / e.total) * 100)) : null,
        loadedBytes: e.loaded,
        totalBytes: e.lengthComputable ? e.total : 0,
        processing: false,
      });
    };

    // Bytes are all sent; the server is now parsing the APK and creating the
    // run. Reported distinctly so the button can say so rather than sitting at
    // 99% looking stuck for the couple of seconds that takes.
    xhr.upload.onload = () => {
      onProgress?.({ percent: 100, loadedBytes: 0, totalBytes: 0, processing: true });
    };

    xhr.onerror = () => resolve({ error: 'Could not reach the server. Check your connection and try again.' });
    xhr.onabort = () => resolve({ error: 'The upload was cancelled.' });
    xhr.ontimeout = () => resolve({ error: 'The upload timed out before the server responded.' });

    xhr.onload = () => {
      const raw = xhr.responseText ?? '';
      let data: SubmitBinaryRunResult | null = null;
      if (raw) {
        try { data = JSON.parse(raw) as SubmitBinaryRunResult; } catch { data = null; }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        if (data?.error) return resolve({ error: data.error });
        if (xhr.status === 413) {
          return resolve({ error: 'The uploaded file is too large for the server to accept. Try a smaller build (under 500MB).' });
        }
        return resolve({
          error: `Upload failed (HTTP ${xhr.status}). ${raw ? raw.slice(0, 300) : 'The server rejected the request.'}`,
        });
      }

      if (!data?.runId) {
        return resolve({ error: 'The server accepted the upload but did not return a run id.' });
      }
      return resolve({ runId: data.runId });
    };

    xhr.send(formData);
  });
}
