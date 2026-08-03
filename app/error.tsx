'use client';

import { useEffect } from 'react';
import { AlertTriangle, DatabaseZap, RefreshCw } from 'lucide-react';

/**
 * Segment error boundary for everything under the root layout.
 *
 * Without one, any server-side throw — most commonly the database being
 * unreachable — reached the browser as an unhandled runtime error with a
 * mongoose stack trace, which tells the person looking at it nothing about what
 * to do. A workspace layout calls requireWorkspace() on every render, that hits
 * the database on every request, so a single connectivity problem took down
 * every page in the app with a red overlay.
 *
 * Errors thrown inside a LAYOUT are caught by the parent segment's boundary, so
 * this lives at the root: it is what covers the workspace layouts.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  // The server strips messages from production errors, so match on both the
  // message (dev) and the name (which survives when it is set explicitly).
  const isDbDown = /cannot reach the database|IP Access List|whitelist|MongooseServerSelection/i
    .test(`${error.name} ${error.message}`);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-amber-500/10 p-2 text-amber-500">
            {isDbDown ? <DatabaseZap className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold">
              {isDbDown ? 'Cannot reach the database' : 'Something went wrong'}
            </h1>

            {isDbDown ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  The application is running, but it could not connect to MongoDB. This is a
                  connectivity problem, not a problem with the page you asked for.
                </p>
                <p className="mt-3 text-sm font-medium">Most likely fix</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add this machine&apos;s current public IP address to the MongoDB Atlas
                  <span className="font-medium text-foreground"> Network Access </span>
                  list, then reload. Atlas allows connections per IP, so the entry stops matching
                  whenever the machine changes network or its address is reassigned.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                An unexpected error occurred while rendering this page.
              </p>
            )}

            {error.message ? (
              <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {error.message}
              </pre>
            ) : null}
            {error.digest ? (
              <p className="mt-2 text-[11px] text-muted-foreground">Error digest: {error.digest}</p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
              <a
                href="/"
                className="inline-flex items-center rounded-md border border-input px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Back home
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
