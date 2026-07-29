'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Theme switcher. Presentation-only: it sets the next-themes preference, which
 * toggles the `.dark` class and therefore the token block. No application state,
 * data, or behaviour depends on it.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Rendering the resolved icon before hydration would mismatch the server HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {/* Both icons are present pre-hydration; CSS decides which shows. */}
          {mounted && theme === 'dark'
            ? <Moon className="h-[18px] w-[18px]" />
            : <Sun className="h-[18px] w-[18px]" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => setTheme(o.value)}
            className="cursor-pointer gap-2"
            aria-current={mounted && theme === o.value ? 'true' : undefined}
          >
            <o.icon className="h-4 w-4" />
            <span className="flex-1">{o.label}</span>
            {mounted && theme === o.value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
