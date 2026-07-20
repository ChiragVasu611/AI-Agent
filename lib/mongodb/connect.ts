import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ai-agent';

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

export async function connectToDatabase() {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
