import { chromium } from 'playwright';

export interface AuditFinding {
  category: string;
  item: string;
  status: 'pass' | 'fail' | 'warn';
  severity: 'critical' | 'high' | 'medium' | 'low';
  detail: string;
  recommendation: string;
}

export interface WebsiteAuditResult {
  findings: AuditFinding[];
  rawMeta: Record<string, unknown>;
}

const NAV_TIMEOUT_MS = 20000;

function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

async function checkTextResource(baseUrl: string, path: string): Promise<{ exists: boolean; status: number }> {
  try {
    const url = new URL(path, baseUrl).toString();
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    return { exists: res.ok, status: res.status };
  } catch {
    return { exists: false, status: 0 };
  }
}

export async function runWebsiteAudit(rawUrl: string): Promise<WebsiteAuditResult> {
  const url = normalizeUrl(rawUrl);
  const findings: AuditFinding[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const navStart = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => null);
    const loadMs = Date.now() - navStart;
    const status = response?.status() ?? 0;

    if (!response || status >= 400) {
      findings.push({
        category: 'Technical', item: 'Page reachability', status: 'fail', severity: 'critical',
        detail: `The page returned HTTP ${status || 'no response'}.`,
        recommendation: 'Ensure the URL is publicly reachable and returns a 2xx status before running further audits.',
      });
      return { findings, rawMeta: { finalUrl: url, status } };
    }

    const extracted = await page.evaluate(() => {
      const title = document.title || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
      const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
      const lang = document.documentElement.getAttribute('lang') || '';
      const h1s = Array.from(document.querySelectorAll('h1')).map((h) => h.textContent?.trim() || '');
      const headingCounts = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => ({
        tag, count: document.querySelectorAll(tag).length,
      }));
      const images = Array.from(document.querySelectorAll('img'));
      const imagesMissingAlt = images.filter((img) => !img.getAttribute('alt')?.trim()).length;
      const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).length;
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const origin = window.location.origin;
      let internalLinks = 0;
      let externalLinks = 0;
      const sampleLinks: string[] = [];
      anchors.forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        try {
          const resolved = new URL(href, origin).toString();
          if (resolved.startsWith(origin)) internalLinks += 1;
          else { externalLinks += 1; if (sampleLinks.length < 5) sampleLinks.push(resolved); }
        } catch { /* ignore unparsable href */ }
      });

      return {
        title, metaDesc, canonical, viewport, lang, h1s, headingCounts,
        totalImages: images.length, imagesMissingAlt, structuredData,
        internalLinks, externalLinks, sampleExternalLinks: sampleLinks,
      };
    });

    // --- Title ---
    if (!extracted.title) {
      findings.push({ category: 'Metadata', item: 'Title tag', status: 'fail', severity: 'critical', detail: 'No <title> tag found.', recommendation: 'Add a unique, descriptive title tag (50-60 characters).' });
    } else if (extracted.title.length < 15 || extracted.title.length > 65) {
      findings.push({ category: 'Metadata', item: 'Title tag', status: 'warn', severity: 'medium', detail: `Title is ${extracted.title.length} characters ("${extracted.title}").`, recommendation: 'Keep titles between 50-60 characters for full SERP display.' });
    } else {
      findings.push({ category: 'Metadata', item: 'Title tag', status: 'pass', severity: 'low', detail: `"${extracted.title}" (${extracted.title.length} chars).`, recommendation: '' });
    }

    // --- Meta description ---
    if (!extracted.metaDesc) {
      findings.push({ category: 'Metadata', item: 'Meta description', status: 'fail', severity: 'high', detail: 'No meta description found.', recommendation: 'Add a compelling 140-160 character meta description with a clear call to action.' });
    } else if (extracted.metaDesc.length < 70 || extracted.metaDesc.length > 170) {
      findings.push({ category: 'Metadata', item: 'Meta description', status: 'warn', severity: 'medium', detail: `Meta description is ${extracted.metaDesc.length} characters.`, recommendation: 'Aim for 140-160 characters so it is not truncated in search results.' });
    } else {
      findings.push({ category: 'Metadata', item: 'Meta description', status: 'pass', severity: 'low', detail: `${extracted.metaDesc.length} characters.`, recommendation: '' });
    }

    // --- Heading structure ---
    const h1Count = extracted.headingCounts.find((h) => h.tag === 'h1')?.count ?? 0;
    if (h1Count === 0) {
      findings.push({ category: 'Content Structure', item: 'H1 heading', status: 'fail', severity: 'high', detail: 'No H1 heading found on the page.', recommendation: 'Add exactly one H1 that summarizes the page topic.' });
    } else if (h1Count > 1) {
      findings.push({ category: 'Content Structure', item: 'H1 heading', status: 'warn', severity: 'medium', detail: `${h1Count} H1 tags found.`, recommendation: 'Use a single H1 per page; demote extras to H2/H3.' });
    } else {
      findings.push({ category: 'Content Structure', item: 'H1 heading', status: 'pass', severity: 'low', detail: `"${extracted.h1s[0]}"`, recommendation: '' });
    }

    // --- Images / alt tags ---
    if (extracted.totalImages === 0) {
      findings.push({ category: 'Accessibility', item: 'Images', status: 'warn', severity: 'low', detail: 'No images found on the page.', recommendation: 'Consider adding relevant imagery to support content and engagement.' });
    } else if (extracted.imagesMissingAlt > 0) {
      findings.push({ category: 'Accessibility', item: 'Alt tags', status: 'fail', severity: extracted.imagesMissingAlt > extracted.totalImages / 2 ? 'high' : 'medium', detail: `${extracted.imagesMissingAlt} of ${extracted.totalImages} images are missing alt text.`, recommendation: 'Add descriptive alt text to every meaningful image for accessibility and image search.' });
    } else {
      findings.push({ category: 'Accessibility', item: 'Alt tags', status: 'pass', severity: 'low', detail: `All ${extracted.totalImages} images have alt text.`, recommendation: '' });
    }

    // --- Internal / external links ---
    if (extracted.internalLinks === 0) {
      findings.push({ category: 'Links', item: 'Internal links', status: 'fail', severity: 'medium', detail: 'No internal links found.', recommendation: 'Add internal links to related pages to distribute authority and aid crawling.' });
    } else {
      findings.push({ category: 'Links', item: 'Internal links', status: 'pass', severity: 'low', detail: `${extracted.internalLinks} internal link(s) found.`, recommendation: '' });
    }
    findings.push({ category: 'Links', item: 'External links', status: extracted.externalLinks > 0 ? 'pass' : 'warn', severity: 'low', detail: `${extracted.externalLinks} external link(s) found.`, recommendation: extracted.externalLinks === 0 ? 'A small number of authoritative outbound links can support topical trust.' : '' });

    // --- URL structure ---
    const parsedUrl = new URL(url);
    const hasQueryParams = parsedUrl.search.length > 0;
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const hasUppercase = /[A-Z]/.test(parsedUrl.pathname);
    const hasUnderscore = parsedUrl.pathname.includes('_');
    if (hasQueryParams || hasUppercase || hasUnderscore || pathSegments.length > 5) {
      findings.push({ category: 'Technical', item: 'URL structure', status: 'warn', severity: 'low', detail: `URL: ${parsedUrl.pathname}${parsedUrl.search}`, recommendation: 'Prefer short, lowercase, hyphenated URLs without query parameters or deep nesting.' });
    } else {
      findings.push({ category: 'Technical', item: 'URL structure', status: 'pass', severity: 'low', detail: `URL: ${parsedUrl.pathname}`, recommendation: '' });
    }

    // --- Robots.txt / Sitemap (real fetch) ---
    const [robots, sitemap] = await Promise.all([
      checkTextResource(url, '/robots.txt'),
      checkTextResource(url, '/sitemap.xml'),
    ]);
    findings.push({
      category: 'Technical', item: 'robots.txt', status: robots.exists ? 'pass' : 'warn', severity: robots.exists ? 'low' : 'medium',
      detail: robots.exists ? 'robots.txt is present and reachable.' : `robots.txt not found (HTTP ${robots.status || 'unreachable'}).`,
      recommendation: robots.exists ? '' : 'Add a robots.txt file to guide crawler behavior.',
    });
    findings.push({
      category: 'Technical', item: 'sitemap.xml', status: sitemap.exists ? 'pass' : 'warn', severity: sitemap.exists ? 'low' : 'medium',
      detail: sitemap.exists ? 'sitemap.xml is present and reachable.' : `sitemap.xml not found (HTTP ${sitemap.status || 'unreachable'}).`,
      recommendation: sitemap.exists ? '' : 'Add and submit an XML sitemap to help search engines discover your pages.',
    });

    // --- Canonical tag ---
    findings.push({
      category: 'Technical', item: 'Canonical tag', status: extracted.canonical ? 'pass' : 'warn', severity: extracted.canonical ? 'low' : 'medium',
      detail: extracted.canonical ? `Canonical: ${extracted.canonical}` : 'No canonical tag found.',
      recommendation: extracted.canonical ? '' : 'Add a self-referencing canonical tag to prevent duplicate content issues.',
    });

    // --- Structured data ---
    findings.push({
      category: 'Technical', item: 'Structured data', status: extracted.structuredData > 0 ? 'pass' : 'warn', severity: extracted.structuredData > 0 ? 'low' : 'medium',
      detail: extracted.structuredData > 0 ? `${extracted.structuredData} JSON-LD block(s) found.` : 'No structured data (JSON-LD) found.',
      recommendation: extracted.structuredData > 0 ? '' : 'Add JSON-LD structured data (Organization, Product, FAQPage, etc.) to enable rich search results.',
    });

    // --- Performance (real page load time) ---
    findings.push({
      category: 'Performance', item: 'Page load time', status: loadMs < 1500 ? 'pass' : loadMs < 3500 ? 'warn' : 'fail',
      severity: loadMs < 1500 ? 'low' : loadMs < 3500 ? 'medium' : 'high',
      detail: `DOM content loaded in ${loadMs}ms.`,
      recommendation: loadMs < 1500 ? '' : 'Reduce render-blocking resources and optimize assets to bring load time under ~1.5s.',
    });

    // --- Mobile responsiveness ---
    findings.push({
      category: 'Mobile', item: 'Viewport meta tag', status: extracted.viewport ? 'pass' : 'fail', severity: extracted.viewport ? 'low' : 'high',
      detail: extracted.viewport ? `viewport: ${extracted.viewport}` : 'No viewport meta tag found.',
      recommendation: extracted.viewport ? '' : 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile responsiveness.',
    });

    // --- Accessibility: lang attribute ---
    findings.push({
      category: 'Accessibility', item: 'HTML lang attribute', status: extracted.lang ? 'pass' : 'warn', severity: extracted.lang ? 'low' : 'medium',
      detail: extracted.lang ? `lang="${extracted.lang}"` : 'No lang attribute on <html>.',
      recommendation: extracted.lang ? '' : 'Set a lang attribute on the <html> element for accessibility and language targeting.',
    });

    // --- Broken links (sample a few external links with a HEAD request) ---
    let brokenCount = 0;
    for (const link of extracted.sampleExternalLinks) {
      try {
        const res = await fetch(link, { method: 'HEAD', redirect: 'follow' });
        if (res.status >= 400) brokenCount += 1;
      } catch {
        brokenCount += 1;
      }
    }
    if (extracted.sampleExternalLinks.length > 0) {
      findings.push({
        category: 'Links', item: 'Broken links (sampled)', status: brokenCount > 0 ? 'fail' : 'pass', severity: brokenCount > 0 ? 'medium' : 'low',
        detail: `${brokenCount} of ${extracted.sampleExternalLinks.length} sampled external link(s) failed to resolve.`,
        recommendation: brokenCount > 0 ? 'Fix or remove broken outbound links.' : '',
      });
    }

    return { findings, rawMeta: { finalUrl: url, status, ...extracted } };
  } finally {
    await browser.close();
  }
}
