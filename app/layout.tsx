import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { Toaster } from '@/components/ui/sonner';

// Inter is the single font family for the entire platform. Both CSS vars
// point at it — `--font-display` is kept (rather than removed) so the many
// existing `.font-display` class usages across every workspace keep working
// without touching each call site; it simply renders Inter now instead of a
// second typeface.
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Enterprise AI Agent Framework',
  description: 'One platform. Every AI agent. Build, test, and ship mobile apps from a reference URL.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
