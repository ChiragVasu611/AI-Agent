const PALETTE = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

/** Deterministic placeholder "screenshot" — there is no real device to capture from (see Devices page). */
export function placeholderScreenshot(screenName: string, module: string): string {
  const color = PALETTE[Math.abs(hashCode(screenName)) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="667" viewBox="0 0 375 667">
    <rect width="375" height="667" fill="#111214"/>
    <rect x="0" y="0" width="375" height="64" fill="${color}"/>
    <text x="24" y="40" font-family="sans-serif" font-size="20" fill="white">${escapeXml(screenName)}</text>
    <rect x="24" y="96" width="327" height="120" rx="12" fill="#1B1C1F"/>
    <rect x="24" y="232" width="327" height="80" rx="12" fill="#1B1C1F"/>
    <rect x="24" y="328" width="327" height="80" rx="12" fill="#1B1C1F"/>
    <text x="24" y="620" font-family="sans-serif" font-size="12" fill="#8A8F98">Simulated capture · ${escapeXml(module)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
