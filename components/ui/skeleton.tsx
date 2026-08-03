import { cn } from '@/lib/utils';

/**
 * A resting `bg-muted` block with a soft light sweep passing over it, instead
 * of a flat opacity pulse — the same shimmer treatment premium dashboards use
 * for loading state. `overflow-hidden` on the root clips the sweep to exactly
 * the size callers already pass via `className` (e.g. `h-10 w-32`), so every
 * existing call site keeps its sizing unchanged.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/10" />
    </div>
  );
}

export { Skeleton };
