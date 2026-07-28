import { Schema, model, models, deleteModel, type Model } from 'mongoose';

/**
 * Registers a Mongoose model in a way that survives Next.js hot reload WITHOUT
 * serving a stale schema.
 *
 * The usual `models.X ?? model('X', schema)` guard exists to avoid
 * OverwriteModelError, but it has a sharp edge in development: Mongoose's model
 * registry lives on the mongoose singleton and outlives an HMR module reload,
 * so once a model is compiled, later edits to its schema are silently ignored
 * until the whole dev server restarts. Adding a value to an `enum` and then
 * getting "`x` is not a valid enum value" is exactly that failure.
 *
 * In development we therefore drop the cached model and recompile it, so schema
 * edits take effect on reload. In production the model is compiled once and
 * reused, which is the behaviour we want there.
 */
/**
 * The return type is pinned to a single `Model<any>` rather than the union of
 * "cached model | freshly compiled model" — a union of Mongoose model types has
 * mutually incompatible call signatures, which makes ordinary `.find()` /
 * `.findById()` calls fail to typecheck at every call site. `any` matches how
 * these models are already consumed across the codebase (`.lean<any>()`).
 */
export function defineModel(name: string, schema: Schema): Model<any> {
  if (process.env.NODE_ENV !== 'production' && models[name]) {
    // Drop the stale compilation so the edited schema takes effect on reload.
    deleteModel(name);
  } else if (models[name]) {
    return models[name] as Model<any>;
  }
  return model<any>(name, schema);
}
