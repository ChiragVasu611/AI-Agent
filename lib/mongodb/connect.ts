import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ai-agent';

/**
 * How long to wait for a server before giving up.
 *
 * Was 30s, which is a long time for a page to hang before showing anything at
 * all — and when the cause is a network-level block (an Atlas IP allowlist
 * silently dropping packets) the full 30s is always spent, on every request,
 * because there is nothing to reject the connection early. 10s is well beyond a
 * healthy connect and turns a hang into a prompt, explainable failure.
 */
const SERVER_SELECTION_TIMEOUT_MS = Number(process.env.MONGODB_TIMEOUT_MS ?? 10_000);

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

/** The cluster host, safe to show — never the username or password. */
function safeTarget(uri: string): string {
  try {
    return new URL(uri).host || 'the configured MongoDB host';
  } catch {
    return 'the configured MongoDB host';
  }
}

/**
 * A database that cannot be reached is an OPERATIONAL condition, not a
 * programming error, and it needs to read like one.
 *
 * Mongoose's own `MongooseServerSelectionError` surfaced to the UI as an
 * unhandled runtime error with a driver stack trace, which says nothing about
 * what to actually do. This keeps the driver's diagnosis but leads with the
 * concrete next step, and is tagged so an error boundary can recognise it.
 */
export class DatabaseUnavailableError extends Error {
  readonly isDatabaseUnavailable = true;

  constructor(target: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Cannot reach the database at ${target}. `
      + 'The server is running, but the database refused or dropped the connection. '
      + 'The usual cause is that this machine\'s public IP address is not on the MongoDB Atlas '
      + 'IP Access List — that list is per-network, so it stops matching whenever the machine '
      + 'moves to a different network or its IP is reassigned. '
      + 'Add the current public IP under Atlas → Network Access, then reload. '
      + `(Driver detail: ${detail})`,
    );
    this.name = 'DatabaseUnavailableError';
    this.cause = cause;
  }
}

export async function connectToDatabase() {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS })
      .catch((err) => {
        // Clear the cached promise so the next request retries rather than
        // replaying this rejection forever — the allowlist may have just been
        // fixed, and the user should not have to restart the server to find out.
        cache.promise = null;
        throw new DatabaseUnavailableError(safeTarget(MONGODB_URI), err);
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
