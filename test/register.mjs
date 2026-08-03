/**
 * Test module hooks.
 *
 * Node 24 runs TypeScript directly via type stripping, so the suite needs no
 * transpiler and no test-framework dependency — `node --test` is enough. The one
 * gap is that Node does not read tsconfig `paths`, so this maps the project's
 * `@/…` alias onto the repository root.
 */
import { registerHooks } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { existsSync, statSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tries the extensions a bundler would, so extensionless imports resolve.
 *
 * `base` itself is only accepted when it is a FILE. A bare `existsSync` check is
 * true for directories too, which resolved `@/lib/qa/drivers` to the directory
 * and made Node reject it as an unsupported directory import instead of falling
 * through to its `index.ts`.
 */
function withExtension(base) {
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`,
    resolve(base, 'index.ts'), resolve(base, 'index.tsx'), resolve(base, 'index.js')]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Project alias: `@/lib/...` → <root>/lib/...
    if (specifier.startsWith('@/')) {
      const found = withExtension(resolve(ROOT, specifier.slice(2)));
      return nextResolve(pathToFileURL(found ?? resolve(ROOT, specifier.slice(2))).href, context);
    }

    // Relative imports inside the source tree omit file extensions, which
    // TypeScript and the bundler both accept but Node's ESM resolver does not.
    // Resolve them the same way rather than rewriting every import in the app.
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
      const found = withExtension(resolve(dirname(parentPath), specifier));
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }

    return nextResolve(specifier, context);
  },
});
