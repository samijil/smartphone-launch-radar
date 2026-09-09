/**
 * Collecte automatique de candidats depuis des pages publiques officielles.
 * Les candidats restent en revue tant qu'une date de lancement/disponibilité
 * explicite n'a pas été trouvée dans une source officielle.
 */
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_FILE = 'data/official-sources.json';
const CANDIDATE_FILE = 'data/research-candidates.json';
const MAX_ARTICLES_PER_SOURCE = 24;
const PHONE_RE = /\b(phone|smartphone|iphone|galaxy\s+[szaf]|pixel\s*\d|pixel phone|fold|flip|find\s*[nxr]|reno\s*\d|xiaomi\s*\d|redmi|poco|razr|motorola edge|oneplus|honor magic|vivo\s*[xy]|nubia|nothing phone)\b/i;
const EXCLUDE_RE = /\b(watch|buds|earbuds|tablet|pad|laptop|macbook|book|tv|monitor|washer|dryer|ssd|microwave|range|refrigerator)\b/i;
const GENERIC_TITLE_RE = /^(iphone news|.*newsroom|.*smartphones?\s*\|.*|view all phones?)$/i;
const NON_HTML_PATH_RE = /\.(?:pdf|zip|rar|7z|docx?|xlsx?|pptx?|mp4|webm|mp3)(?:$|[?#])/i;

function clean(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function decodeEntities(value = '') {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
function canonicalUrl(value) {
  try {
    const url = new URL(decodeEntities(value));
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
function abs(href, base) {
  try { return canonicalUrl(new URL(decodeEntities(href), base).href); } catch { return null; }
}
function allowed(url, hosts) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some(x => h === x || h.endsWith('.' + x));
  } catch {
    return false;
  }
}
function slug(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 96);
}
function candidateUrl(url, base) {
  if (!url || NON_HTML_PATH_RE.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const baseUrl = new URL(base);
    if (parsed.origin === baseUrl.origin && parsed.pathname === baseUrl.pathname && parsed.search === baseUrl.search) return false;
    return true;
  } catch {
    return false;
  }
}
function isUsefulTitle(title) {
  const normalized = clean(title);
  return normalized.length >= 8 && normalized.length <= 220 && !GENERIC_TITLE_RE.test(normalized)
    && PHONE_RE.test(normalized) && !EXCLUDE_RE.test(normalized);
}
function extractLinks(html, base, hosts) {
  const links = new Map();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = abs(m[1], base);
    const title = clean(m[2]);
    if (!url || !allowed(url, hosts) || !candidateUrl(url, base) || !isUsefulTitle(title)) continue;
    links.set(url, title);
  }
  return [...links.entries()].slice(0, MAX_ARTICLES_PER_SOURCE).map(([url, title]) => ({ url, title }));
}
function monthNumber(name) {
  const map = {
    january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12,
    janvier:1, 'février':2, fevrier:2, mars:3, avril:4, mai:5, juin:6, juillet:7, 'août':8, aout:8, septembre:9, octobre:10, novembre:11, 'décembre':12, decembre:12
  };
  return map[name.toLowerCase()];
}
function isoDateFromParts(day, monthName, year) {
  const month = monthNumber(monthName);
  if (!month) return null;
  const y = Number(year || new Date().getUTCFullYear());
  const d = Number(day);
  const test = new Date(Date.UTC(y, month - 1, d));
  if (d < 1 || d > 31 || test.getUTCMonth() !== month - 1 || test.getUTCDate() !== d) return null;
  return test.toISOString();
}
function explicitLaunchDate(text) {
  const patterns = [
    /(?:available|on shelves|goes on sale|launch(?:es|ing)?|arriv(?:es|ing))[^.]{0,120}?(?:on|from)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
    /(?:available|on shelves|goes on sale|launch(?:es|ing)?|arriv(?:es|ing))[^.]{0,120}?(?:on|from)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s*(\d{4}))?/i,
    /(?:disponible|commercialis[ée]|lancement|arrive)[^.]{0,120}?(?:dès|à partir du|le)\s+(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre)(?:\s+(\d{4}))?/i
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    if (/^[A-Za-z]/.test(m[1])) return isoDateFromParts(m[2], m[1], m[3]);
    return isoDateFromParts(m[1], m[2], m[3]);
  }
  return null;
}
function titleOf(html, fallback) {
  return clean(
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1]
    || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
    || fallback
  );
}
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'smartphone-launch-radar/1.2 (+GitHub Actions official-source collector)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (/application\/pdf|application\/octet-stream|application\/zip/i.test(contentType) || NON_HTML_PATH_RE.test(res.url)) {
    throw new Error(`Unsupported content type: ${contentType || 'binary'}`);
  }
  return { text: await res.text(), finalUrl: canonicalUrl(res.url) || url };
}

const sources = JSON.parse(await readFile(SOURCE_FILE, 'utf8')).sources ?? [];
let previous = { generatedAt: null, events: [], errors: [] };
try { previous = JSON.parse(await readFile(CANDIDATE_FILE, 'utf8')); } catch {}

const previousByUrl = new Map();
for (const item of previous.events ?? []) {
  const url = canonicalUrl(item.officialUrl);
  if (url && candidateUrl(url, item.sourceUrl || url) && isUsefulTitle(item.name || '')) previousByUrl.set(url, { ...item, officialUrl: url });
}

const collectedByUrl = new Map();
const errors = [];

for (const source of sources) {
  try {
    const index = await fetchText(source.url);
    const links = extractLinks(index.text, index.finalUrl, source.allowedHosts);
    for (const link of links) {
      try {
        const page = await fetchText(link.url);
        const title = titleOf(page.text, link.title);
        const text = clean(page.text).slice(0, 50000);
        if (!isUsefulTitle(title) || !PHONE_RE.test(title + ' ' + text.slice(0, 5000)) || EXCLUDE_RE.test(title)) continue;

        const officialUrl = canonicalUrl(page.finalUrl || link.url);
        if (!officialUrl || !candidateUrl(officialUrl, source.url)) continue;

        const date = explicitLaunchDate(text);
        const prior = previousByUrl.get(officialUrl);
        collectedByUrl.set(officialUrl, {
          id: prior?.id || `${source.id}-${slug(title)}`,
          name: title,
          brand: source.brand,
          date,
          timezone: 'UTC',
          region: 'GLOBAL',
          status: date ? 'UPCOMING' : 'TBC',
          confidence: 'OFFICIAL',
          summary: text.slice(0, 600),
          specifications: prior?.specifications || {},
          image: prior?.image || '',
          officialUrl,
          sourceUrl: source.url,
          collectedAt: new Date().toISOString(),
          requiresReview: !date
        });
      } catch (error) {
        errors.push({ source: source.id, url: link.url, error: String(error.message || error) });
      }
    }
  } catch (error) {
    errors.push({ source: source.id, url: source.url, error: String(error.message || error) });
  }
}

const byId = new Map();
for (const item of collectedByUrl.values()) {
  const key = item.id;
  const prior = byId.get(key);
  if (!prior || (item.date && !prior.date)) byId.set(key, item);
}

const payload = {
  generatedAt: new Date().toISOString(),
  sourceCount: sources.length,
  events: [...byId.values()].sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt))),
  errors
};

await writeFile(CANDIDATE_FILE, JSON.stringify(payload, null, 2) + '\n');
console.log(`Official-source collection complete: ${collectedByUrl.size} unique URL candidate(s), ${payload.events.length} stored, ${errors.length} fetch error(s).`);
