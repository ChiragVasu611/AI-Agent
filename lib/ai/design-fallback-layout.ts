import type { DesignElement, DesignScreen } from '@/lib/types';

const FRAME_W = 375;
const FRAME_H = 812;
const GUTTER = 120;

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, radius = 0): DesignElement {
  return { id: nextId('el'), type: 'rect', x, y, w, h, fill, radius };
}

function text(x: number, y: number, w: number, h: number, value: string, size: number, weight: number, color: string): DesignElement {
  return { id: nextId('el'), type: 'text', x, y, w, h, text: value, fontSize: size, fontWeight: weight, color };
}

function button(x: number, y: number, w: number, h: number, label: string, fill: string, textColor: string, target?: string | null): DesignElement {
  return { id: nextId('el'), type: 'button', x, y, w, h, text: label, fill, color: textColor, radius: 12, target: target ?? null };
}

function input(x: number, y: number, w: number, h: number, placeholder: string): DesignElement {
  return { id: nextId('el'), type: 'input', x, y, w, h, text: placeholder, radius: 10, fill: '#F2F3F5', color: '#8A8F98' };
}

function image(x: number, y: number, w: number, h: number, radius = 16): DesignElement {
  return { id: nextId('el'), type: 'image', x, y, w, h, radius, fill: '#E4E7EC' };
}

function icon(x: number, y: number, w: number, h: number, fill: string, target?: string | null): DesignElement {
  return { id: nextId('el'), type: 'icon', x, y, w, h, fill, target: target ?? null };
}

function row(x: number, y: number, w: number, h: number, surface: string, radius = 12): DesignElement {
  return rect(x, y, w, h, surface, radius);
}

type Palette = { primary: string; onPrimary: string; bg: string; surface: string; text: string; muted: string };

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/splash/, 'splash'],
  [/onboard/, 'onboarding'],
  [/forgot|reset.?password/, 'forgot-password'],
  [/otp|verify|verification/, 'otp'],
  [/sign ?up|register/, 'signup'],
  [/log ?in|sign ?in/, 'login'],
  [/search/, 'search'],
  [/cart|basket/, 'cart'],
  [/checkout|payment/, 'checkout'],
  [/notification|alert/, 'notifications'],
  [/setting|preference/, 'settings'],
  [/profile|account/, 'profile'],
  [/help|support|faq/, 'help'],
  [/empty/, 'empty'],
  [/error/, 'error'],
  [/loading|splash.?screen/, 'loading'],
  [/badge|achievement|reward/, 'rewards'],
  [/success|complete|confirmation|done/, 'success'],
  [/calendar|streak|schedule/, 'calendar'],
  [/setup|config|add|create|new|entry|edit|compose/, 'form'],
  [/detail/, 'detail'],
  [/home|dashboard|feed/, 'home'],
  [/list|browse|catalog|history|order/, 'listing'],
];

function categoryFor(name: string): string {
  const n = name.toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(n)) return cat;
  }
  return 'generic';
}

function buildScreenElements(
  category: string,
  screenName: string,
  palette: Palette,
  targets: { next: string | null; home: string | null; search: string | null; profile: string | null; notifications: string | null; detail: string | null; cart: string | null; success: string | null },
): DesignElement[] {
  const { primary, onPrimary, bg, surface, text: textColor, muted } = palette;
  const els: DesignElement[] = [rect(0, 0, FRAME_W, FRAME_H, bg)];

  switch (category) {
    case 'splash':
      els.push(rect(FRAME_W / 2 - 40, FRAME_H / 2 - 80, 80, 80, primary, 24));
      els.push(text(0, FRAME_H / 2 + 20, FRAME_W, 28, 'App Name', 20, 700, textColor));
      break;
    case 'onboarding':
      els.push(image(24, 80, FRAME_W - 48, 280));
      els.push(text(24, 390, FRAME_W - 48, 32, 'Welcome headline', 22, 700, textColor));
      els.push(text(24, 430, FRAME_W - 48, 60, 'Supporting copy that explains the value of this step.', 14, 400, muted));
      els.push(button(24, FRAME_H - 100, FRAME_W - 48, 52, 'Continue', primary, onPrimary, targets.next));
      break;
    case 'login':
      els.push(text(24, 100, FRAME_W - 48, 32, 'Welcome back', 24, 700, textColor));
      els.push(input(24, 160, FRAME_W - 48, 52, 'Email'));
      els.push(input(24, 224, FRAME_W - 48, 52, 'Password'));
      els.push(text(24, 288, 160, 20, 'Forgot password?', 12, 500, primary));
      els.push(button(24, FRAME_H - 160, FRAME_W - 48, 52, 'Sign In', primary, onPrimary, targets.home ?? targets.next));
      break;
    case 'signup':
      els.push(text(24, 100, FRAME_W - 48, 32, 'Create your account', 24, 700, textColor));
      els.push(input(24, 160, FRAME_W - 48, 52, 'Full name'));
      els.push(input(24, 224, FRAME_W - 48, 52, 'Email'));
      els.push(input(24, 288, FRAME_W - 48, 52, 'Password'));
      els.push(button(24, FRAME_H - 160, FRAME_W - 48, 52, 'Create Account', primary, onPrimary, targets.next));
      break;
    case 'forgot-password':
      els.push(text(24, 100, FRAME_W - 48, 32, 'Reset password', 24, 700, textColor));
      els.push(text(24, 140, FRAME_W - 48, 40, 'Enter the email associated with your account.', 13, 400, muted));
      els.push(input(24, 190, FRAME_W - 48, 52, 'Email'));
      els.push(button(24, 260, FRAME_W - 48, 52, 'Send Reset Link', primary, onPrimary, targets.next));
      break;
    case 'otp':
      els.push(text(24, 100, FRAME_W - 48, 32, 'Verify your number', 22, 700, textColor));
      els.push(text(24, 140, FRAME_W - 48, 32, 'Enter the 6-digit code we sent you.', 13, 400, muted));
      for (let i = 0; i < 4; i++) {
        els.push(rect(24 + i * 82, 190, 64, 64, surface, 12));
      }
      els.push(button(24, 280, FRAME_W - 48, 52, 'Verify', primary, onPrimary, targets.home ?? targets.next));
      break;
    case 'home':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Good morning', 20, 700, textColor));
      for (let i = 0; i < 3; i++) {
        els.push(row(24, 110 + i * 130, FRAME_W - 48, 110, surface, 16));
        els.push(image(40, 126 + i * 130, 78, 78, 10));
        els.push(text(130, 130 + i * 130, FRAME_W - 174, 20, `Card title ${i + 1}`, 15, 600, textColor));
        els.push(text(130, 156 + i * 130, FRAME_W - 174, 36, 'Short supporting description for this item.', 12, 400, muted));
      }
      els.push(rect(0, FRAME_H - 72, FRAME_W, 72, surface));
      {
        const navTargets = [null, targets.search, targets.notifications, targets.profile];
        for (let i = 0; i < 4; i++) {
          els.push(icon(30 + i * ((FRAME_W - 60) / 3), FRAME_H - 48, 24, 24, i === 0 ? primary : muted, navTargets[i]));
        }
      }
      break;
    case 'search':
      els.push(input(24, 60, FRAME_W - 48, 48, 'Search'));
      for (let i = 0; i < 5; i++) {
        els.push(row(24, 128 + i * 68, FRAME_W - 48, 56, surface, 12));
        els.push(text(40, 146 + i * 68, FRAME_W - 80, 20, `Result ${i + 1}`, 13, 500, textColor));
      }
      break;
    case 'listing':
      for (let i = 0; i < 6; i++) {
        const col = i % 2, r = Math.floor(i / 2);
        const w = (FRAME_W - 24 * 2 - 16) / 2;
        els.push(row(24 + col * (w + 16), 60 + r * 180, w, 160, surface, 14));
        els.push(image(24 + col * (w + 16) + 8, 60 + r * 180 + 8, w - 16, 100));
        els.push(text(24 + col * (w + 16) + 8, 60 + r * 180 + 116, w - 16, 16, `Item ${i + 1}`, 12, 600, textColor));
      }
      break;
    case 'detail':
      els.push(image(0, 0, FRAME_W, 280, 0));
      els.push(rect(0, 260, FRAME_W, FRAME_H - 260, bg, 24));
      els.push(text(24, 296, FRAME_W - 48, 28, 'Item title', 22, 700, textColor));
      els.push(text(24, 332, FRAME_W - 48, 60, 'Full description of this item goes here, wrapping across a few lines.', 13, 400, muted));
      els.push(button(24, FRAME_H - 96, FRAME_W - 48, 52, 'Continue', primary, onPrimary, targets.cart ?? targets.next));
      break;
    case 'cart':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Your Cart', 22, 700, textColor));
      for (let i = 0; i < 3; i++) {
        els.push(row(24, 108 + i * 96, FRAME_W - 48, 80, surface, 12));
        els.push(image(36, 116 + i * 96, 64, 64, 10));
        els.push(text(112, 128 + i * 96, FRAME_W - 160, 18, `Product ${i + 1}`, 13, 600, textColor));
        els.push(text(112, 152 + i * 96, 100, 16, '$24.00', 12, 500, muted));
      }
      els.push(rect(0, FRAME_H - 140, FRAME_W, 140, surface));
      els.push(text(24, FRAME_H - 116, 150, 20, 'Total', 14, 600, textColor));
      els.push(button(24, FRAME_H - 80, FRAME_W - 48, 52, 'Checkout', primary, onPrimary, targets.next));
      break;
    case 'checkout':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Checkout', 22, 700, textColor));
      els.push(icon(40, 122, 24, 24, primary));
      els.push(row(24, 108, FRAME_W - 48, 100, surface, 12));
      els.push(text(76, 128, FRAME_W - 112, 18, 'Shipping address', 13, 600, textColor));
      els.push(icon(40, 234, 24, 24, primary));
      els.push(row(24, 220, FRAME_W - 48, 100, surface, 12));
      els.push(text(76, 240, FRAME_W - 112, 18, 'Payment method', 13, 600, textColor));
      els.push(button(24, FRAME_H - 96, FRAME_W - 48, 52, 'Place Order', primary, onPrimary, targets.success ?? targets.home ?? targets.next));
      break;
    case 'profile': {
      els.push(image(FRAME_W / 2 - 44, 60, 88, 88, 44));
      els.push(text(0, 158, FRAME_W, 24, 'Jordan Rivera', 18, 700, textColor));
      const rows: Array<[string, string | null]> = [
        ['Account', null],
        ['Notifications', targets.notifications],
        ['Privacy', null],
        ['Sign out', null],
      ];
      rows.forEach(([label, target], i) => {
        els.push(row(24, 220 + i * 64, FRAME_W - 48, 52, surface, 12));
        els.push(icon(40, 236 + i * 64, 20, 20, primary, target));
        els.push(text(72, 236 + i * 64, FRAME_W - 112, 20, label, 13, 500, textColor));
      });
      break;
    }
    case 'settings':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Settings', 22, 700, textColor));
      for (let i = 0; i < 5; i++) {
        els.push(row(24, 108 + i * 64, FRAME_W - 48, 52, surface, 12));
        els.push(icon(40, 124 + i * 64, 20, 20, primary));
        els.push(text(72, 124 + i * 64, FRAME_W - 112, 20, ['Profile', 'Security', 'Notifications', 'Appearance', 'About'][i], 13, 500, textColor));
      }
      break;
    case 'notifications':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Notifications', 22, 700, textColor));
      for (let i = 0; i < 5; i++) {
        els.push(row(24, 108 + i * 76, FRAME_W - 48, 64, surface, 12));
        els.push(icon(40, 128 + i * 76, 24, 24, primary));
        els.push(text(76, 122 + i * 76, FRAME_W - 116, 18, `Notification ${i + 1}`, 13, 600, textColor));
        els.push(text(76, 144 + i * 76, FRAME_W - 116, 16, '2 minutes ago', 11, 400, muted));
      }
      break;
    case 'help':
      els.push(text(24, 60, FRAME_W - 48, 28, 'Help & Support', 22, 700, textColor));
      for (let i = 0; i < 4; i++) {
        els.push(row(24, 108 + i * 64, FRAME_W - 48, 52, surface, 12));
        els.push(icon(40, 124 + i * 64, 20, 20, primary));
        els.push(text(72, 124 + i * 64, FRAME_W - 112, 20, `FAQ topic ${i + 1}`, 13, 500, textColor));
      }
      break;
    case 'empty':
      els.push(rect(FRAME_W / 2 - 48, FRAME_H / 2 - 96, 96, 96, surface, 24));
      els.push(icon(FRAME_W / 2 - 16, FRAME_H / 2 - 64, 32, 32, muted));
      els.push(text(24, FRAME_H / 2 + 16, FRAME_W - 48, 24, 'Nothing here yet', 16, 600, textColor));
      els.push(text(24, FRAME_H / 2 + 44, FRAME_W - 48, 32, 'Items you add will show up here.', 12, 400, muted));
      break;
    case 'error':
      els.push(rect(FRAME_W / 2 - 48, FRAME_H / 2 - 96, 96, 96, '#FEE4E2', 24));
      els.push(icon(FRAME_W / 2 - 16, FRAME_H / 2 - 64, 32, 32, '#E5484D'));
      els.push(text(24, FRAME_H / 2 + 16, FRAME_W - 48, 24, 'Something went wrong', 16, 600, textColor));
      els.push(button(24, FRAME_H / 2 + 60, FRAME_W - 48, 52, 'Try Again', primary, onPrimary, targets.home ?? targets.next));
      break;
    case 'loading':
      els.push(rect(FRAME_W / 2 - 24, FRAME_H / 2 - 24, 48, 48, primary, 24));
      els.push(text(24, FRAME_H / 2 + 44, FRAME_W - 48, 20, 'Loading…', 13, 500, muted));
      break;
    case 'success':
      els.push(rect(FRAME_W / 2 - 48, FRAME_H / 2 - 96, 96, 96, '#DCFAE6', 48));
      els.push(icon(FRAME_W / 2 - 16, FRAME_H / 2 - 64, 32, 32, '#1FC16B'));
      els.push(text(24, FRAME_H / 2 + 16, FRAME_W - 48, 24, 'All done!', 18, 700, textColor));
      els.push(button(24, FRAME_H / 2 + 60, FRAME_W - 48, 52, 'Continue', primary, onPrimary, targets.home ?? targets.next));
      break;
    case 'rewards':
      els.push(text(24, 60, FRAME_W - 48, 28, screenName, 22, 700, textColor));
      for (let i = 0; i < 4; i++) {
        const col = i % 2, r = Math.floor(i / 2);
        const w = (FRAME_W - 24 * 2 - 16) / 2;
        els.push(row(24 + col * (w + 16), 110 + r * 140, w, 120, surface, 14));
        els.push(icon(24 + col * (w + 16) + w / 2 - 16, 126 + r * 140, 32, 32, primary));
        els.push(text(24 + col * (w + 16) + 8, 174 + r * 140, w - 16, 16, `Badge ${i + 1}`, 12, 600, textColor));
      }
      break;
    case 'calendar':
      els.push(text(24, 60, FRAME_W - 48, 28, screenName, 22, 700, textColor));
      els.push(row(24, 108, FRAME_W - 48, 260, surface, 16));
      for (let i = 0; i < 28; i++) {
        const col = i % 7, r = Math.floor(i / 7);
        els.push(rect(36 + col * 44, 130 + r * 50, 32, 32, i % 4 === 0 ? primary : bg, 8));
      }
      els.push(text(24, 388, FRAME_W - 48, 20, 'Recent activity', 14, 600, textColor));
      for (let i = 0; i < 2; i++) {
        els.push(row(24, 420 + i * 64, FRAME_W - 48, 52, surface, 12));
        els.push(text(44, 436 + i * 64, FRAME_W - 88, 20, `Streak day ${i + 1}`, 13, 500, textColor));
      }
      break;
    case 'form':
      els.push(text(24, 60, FRAME_W - 48, 28, screenName, 22, 700, textColor));
      els.push(text(24, 96, FRAME_W - 48, 32, 'Fill in the details below.', 13, 400, muted));
      els.push(input(24, 140, FRAME_W - 48, 52, 'Title'));
      els.push(input(24, 204, FRAME_W - 48, 52, 'Description'));
      els.push(input(24, 268, FRAME_W - 48, 52, 'Category'));
      els.push(button(24, FRAME_H - 100, FRAME_W - 48, 52, 'Save', primary, onPrimary, targets.next));
      break;
    default:
      els.push(text(24, 60, FRAME_W - 48, 28, screenName, 22, 700, textColor));
      els.push(text(24, 96, FRAME_W - 48, 32, 'Overview and key details for this screen.', 13, 400, muted));
      for (let i = 0; i < 4; i++) {
        els.push(row(24, 140 + i * 68, FRAME_W - 48, 56, surface, 12));
        els.push(icon(40, 156 + i * 68, 24, 24, primary));
        els.push(text(80, 156 + i * 68, FRAME_W - 120, 24, `${screenName} item ${i + 1}`, 13, 500, textColor));
      }
  }

  return els;
}

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

export function extractHexColors(value: unknown, out: Set<string> = new Set()): string[] {
  if (typeof value === 'string') {
    const matches = value.match(HEX_RE);
    matches?.forEach((m) => out.add(m));
  } else if (Array.isArray(value)) {
    value.forEach((v) => extractHexColors(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => extractHexColors(v, out));
  }
  return Array.from(out);
}

export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.trim().toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? name : `${name} ${count + 1}`;
  });
}

export function buildFallbackScreens(screenNames: string[], hexColors: string[], style: string): DesignScreen[] {
  idCounter = 0;
  const rawNames = screenNames.length > 0 ? screenNames : ['Splash', 'Onboarding', 'Login', 'Home', 'Detail', 'Profile', 'Settings'];
  const names = dedupeNames(rawNames);
  const primary = hexColors[0] ?? '#4F46E5';
  const isDark = style.toLowerCase().includes('enterprise') || style.toLowerCase().includes('premium');
  const palette: Palette = {
    primary,
    onPrimary: '#FFFFFF',
    bg: isDark ? '#111214' : '#FAFAFB',
    surface: isDark ? '#1B1C1F' : '#FFFFFF',
    text: isDark ? '#F5F5F6' : '#1A1B1E',
    muted: isDark ? '#8A8F98' : '#6B7280',
  };

  const ids = names.map((_, i) => `screen-${i}`);
  const categories = names.map(categoryFor);

  const firstIdOf = (cat: string): string | null => {
    const idx = categories.indexOf(cat);
    return idx === -1 ? null : ids[idx];
  };

  const homeId = firstIdOf('home');
  const searchId = firstIdOf('search');
  const profileId = firstIdOf('profile') ?? firstIdOf('settings');
  const notificationsId = firstIdOf('notifications');
  const detailId = firstIdOf('detail');
  const cartId = firstIdOf('cart');
  const successId = firstIdOf('success');

  return names.map((name, i) => {
    const category = categories[i];
    const targets = {
      next: ids[i + 1] ?? null,
      home: homeId !== ids[i] ? homeId : null,
      search: searchId !== ids[i] ? searchId : null,
      profile: profileId !== ids[i] ? profileId : null,
      notifications: notificationsId !== ids[i] ? notificationsId : null,
      detail: detailId !== ids[i] ? detailId : null,
      cart: cartId !== ids[i] ? cartId : null,
      success: successId !== ids[i] ? successId : null,
    };
    return {
      id: ids[i],
      name,
      canvasX: i * (FRAME_W + GUTTER),
      canvasY: 0,
      width: FRAME_W,
      height: FRAME_H,
      background: palette.bg,
      elements: buildScreenElements(category, name, palette, targets),
    };
  });
}
