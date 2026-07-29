'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Theme provider.
 *
 * `next-themes` was already a dependency (the Sonner toaster reads `useTheme`)
 * but no provider was ever mounted and Tailwind had no `darkMode` strategy, so
 * dark mode could not be selected and the `dark:` variants already present in a
 * few components were inert. Mounting it here activates the `.dark` token block
 * without altering any component's behaviour.
 *
 * `attribute="class"` matches `darkMode: 'class'` in the Tailwind config.
 * `disableTransitionOnChange` prevents every colour on the page from animating
 * at once when the theme flips, which reads as a flash rather than a transition.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
