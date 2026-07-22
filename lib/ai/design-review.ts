import type { DesignElement, DesignScreen } from '@/lib/types';

export interface DesignReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'accessibility' | 'ux' | 'ui' | 'consistency' | 'responsive';
  screen: string;
  message: string;
  elementId?: string;
}

export interface DesignReviewResult {
  overallScore: number;
  uxScore: number;
  uiScore: number;
  accessibilityScore: number;
  consistencyScore: number;
  responsiveScore: number;
  issues: DesignReviewIssue[];
  generatedAt: string;
}

const TERMINAL_CATEGORIES = /splash|loading|empty|error|success|otp/i;

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two hex colors; null if either color can't be parsed. */
function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function backgroundFor(el: DesignElement, screen: DesignScreen): string {
  if ((el.type === 'button' || el.type === 'input') && el.fill) return el.fill;
  return screen.background;
}

function isLargeText(el: DesignElement): boolean {
  const size = el.fontSize ?? 14;
  const weight = el.fontWeight ?? 400;
  return size >= 18 || (size >= 14 && weight >= 700);
}

export function reviewDesign(screens: DesignScreen[]): DesignReviewResult {
  const issues: DesignReviewIssue[] = [];
  let contrastIssues = 0;
  let touchTargetIssues = 0;
  let missingCtaIssues = 0;
  let spacingIssues = 0;
  const backgroundsSeen = new Set<string>();
  const structuralSignatures = new Map<string, number>();

  for (const screen of screens) {
    backgroundsSeen.add(screen.background.toLowerCase());
    let hasButton = false;
    const positioned = [...screen.elements].sort((a, b) => a.y - b.y);

    for (const el of screen.elements) {
      if (el.type === 'button') hasButton = true;

      // Contrast: any element carrying visible text against its effective background.
      if (el.text && el.color) {
        const bg = backgroundFor(el, screen);
        const ratio = contrastRatio(el.color, bg);
        const threshold = isLargeText(el) ? 3 : 4.5;
        if (ratio != null && ratio < threshold) {
          contrastIssues += 1;
          issues.push({
            severity: ratio < threshold - 1.5 ? 'high' : 'medium',
            category: 'accessibility',
            screen: screen.name,
            elementId: el.id,
            message: `Text "${el.text.slice(0, 30)}" has a contrast ratio of ${ratio.toFixed(2)}:1 against its background (needs ${threshold}:1).`,
          });
        }
      }

      // Touch targets: interactive elements should be at least 44x44.
      const isInteractive = el.type === 'button' || el.type === 'input' || (el.type === 'icon' && el.target);
      if (isInteractive && (el.h < 44 || el.w < 32)) {
        touchTargetIssues += 1;
        issues.push({
          severity: 'medium',
          category: 'accessibility',
          screen: screen.name,
          elementId: el.id,
          message: `${el.type === 'button' ? 'Button' : el.type === 'input' ? 'Input field' : 'Icon'} is ${Math.round(el.w)}×${Math.round(el.h)}px — below the 44×44px minimum touch target.`,
        });
      }

      const sig = `${el.type}:${Math.round(el.w / 8)}:${Math.round(el.h / 8)}`;
      structuralSignatures.set(sig, (structuralSignatures.get(sig) ?? 0) + 1);
    }

    if (!hasButton && !TERMINAL_CATEGORIES.test(screen.name)) {
      missingCtaIssues += 1;
      issues.push({
        severity: 'high',
        category: 'ux',
        screen: screen.name,
        message: `"${screen.name}" has no visible call-to-action button — users may not know how to proceed.`,
      });
    }

    // Spacing consistency: vertical gaps between stacked elements should sit on a 4px grid.
    let offGrid = 0;
    for (let i = 1; i < positioned.length; i++) {
      const gap = positioned[i].y - (positioned[i - 1].y + positioned[i - 1].h);
      if (gap > 0 && gap % 4 !== 0) offGrid += 1;
    }
    if (positioned.length > 2 && offGrid / positioned.length > 0.3) {
      spacingIssues += 1;
      issues.push({
        severity: 'low',
        category: 'ui',
        screen: screen.name,
        message: `"${screen.name}" has inconsistent vertical spacing — several gaps don't align to a 4px grid.`,
      });
    }

    // Responsive: frames should match a standard mobile/tablet/desktop width.
    if (![375, 768, 1024, 1280, 1440].includes(screen.width)) {
      issues.push({
        severity: 'low',
        category: 'responsive',
        screen: screen.name,
        message: `"${screen.name}" uses a non-standard frame width (${screen.width}px) — verify it maps to a real breakpoint.`,
      });
    }
  }

  const paletteFragmentation = Math.max(0, backgroundsSeen.size - 3);
  if (paletteFragmentation > 0) {
    issues.push({
      severity: 'low',
      category: 'consistency',
      screen: 'Design System',
      message: `${backgroundsSeen.size} distinct screen background colors detected — consolidate into a shared design-token palette for consistency.`,
    });
  }

  const totalElements = screens.reduce((sum, s) => sum + s.elements.length, 0) || 1;
  const accessibilityScore = Math.max(20, Math.round(100 - Math.min(65, (contrastIssues * 6 + touchTargetIssues * 4) / Math.max(1, screens.length) * 3)));
  const uxScore = Math.max(20, Math.round(100 - Math.min(55, missingCtaIssues * 10)));
  const uiScore = Math.max(20, Math.round(100 - Math.min(45, (spacingIssues / Math.max(1, screens.length)) * 60)));
  const consistencyScore = Math.max(20, Math.round(100 - Math.min(35, paletteFragmentation * 5)));
  const responsiveScore = Math.max(30, Math.round(100 - issues.filter((i) => i.category === 'responsive').length * 8));

  const overallScore = Math.round(
    accessibilityScore * 0.3 + uxScore * 0.25 + uiScore * 0.2 + consistencyScore * 0.15 + responsiveScore * 0.1,
  );

  // totalElements only informs proportional scoring above; keep referenced to avoid an unused-var lint on tiny designs.
  void totalElements;

  return {
    overallScore,
    uxScore,
    uiScore,
    accessibilityScore,
    consistencyScore,
    responsiveScore,
    issues,
    generatedAt: new Date().toISOString(),
  };
}
