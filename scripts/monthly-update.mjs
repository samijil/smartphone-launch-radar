/**
 * Construit le radar du mois courant sans inventer de lancement.
 * Le cycle fusionne les annonces découvertes automatiquement et les backfills
 * officiels vérifiés. Les événements passés, du jour et à venir du mois sont
 * conservés tant qu'ils disposent d'une date ISO et d'une URL officielle.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const now = new Date();
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' })
  .formatToParts(now)
  .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
const currentMonth = `${month.year}-${month.month}`;

const FETCH_TIMEOUT_MS = 15000;
async function fetchOfficialHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'smartphone-launch-radar/1.5 official-media-enricher', accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { html: await res.text(), url: res.url };
  } finally { clearTimeout(timer); }
}
function absoluteUrl(value, base) { try { return new URL(value, base).href; } catch { return null; } }
function metaValue(html, key) {
  const lower = String(key).toLowerCase();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (tag.match(/(?:property|name|itemprop)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content=["']([^"']+)["']/i) || [])[1];
    if (name && content && name.toLowerCase() === lower) return content.replace(/&amp;/g, '&');
  }
  return null;
}
function pageImage(html, base, hint = '') {
  const meta = metaValue(html, 'og:image') || metaValue(html, 'twitter:image') || metaValue(html, 'image');
  if (meta) return absoluteUrl(meta, base);
  const imgs = [...html.matchAll(/<img\\b[^>]*>/gi)];
  const words = hint.toLowerCase().split(/[^a-z0-9]+/i).filter(x => x.length >= 3);
  let fallback = null;
  for (const match of imgs) {
    const tag = match[0];
    const src = (tag.match(/(?:src|data-src|data-original)=["']([^"']+)["']/i) || [])[1];
    if (!src || /^data:image/i.test(src)) continue;
    const url = absoluteUrl(src, base);
    if (!url) continue;
    if (!fallback) fallback = url;
    const text = ((tag.match(/(?:alt|title)=["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
    if (words.some(w => text.includes(w))) return url;
  }
  if (fallback) return fallback;
  const urls = html.match(/https?:[^"'\\s<>]+\\.(?:avif|webp|png|jpe?g)(?:\\?[^"'\\s<>]*)?/gi) || [];
  const normalizedHint = hint.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const preferred = urls.find(u => u.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(normalizedHint.slice(0, 8)));
  return preferred || urls[0] || null;
}
function mediaLink(html, base) {
  const video = metaValue(html, 'og:video') || metaValue(html, 'og:video:url');
  if (video) return absoluteUrl(video, base);
  const hit = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^"'\s<]+|youtu\.be\/[^"'\s<]+)/i);
  return hit ? hit[0] : null;
}
function storeLink(html, base) {
  const re = /<a\b([^>]+)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let hit;
  while ((hit = re.exec(html))) {
    const label = (hit[1] + ' ' + hit[3] + ' ' + hit[4]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (/(buy|purchase|shop|order|pre-?order|réserver|acheter|commander|购买|预售|订金)/i.test(label)) {
      const url = absoluteUrl(hit[2], base);
      if (url && /^https?:/.test(url) && !/(?:\/order\/list|\/shop\/privilege|\/products\/?$)/i.test(new URL(url).pathname)) return url;
    }
  }
  return null;
}
async function enrichOfficialMedia(event) {
  const out = { ...event };
  const pages = [event.officialUrl, event.sourceUrl].filter(Boolean);
  const results = await Promise.all(pages.map(async page => {
    try { return { page, ...(await fetchOfficialHtml(page)) }; }
    catch (error) { return { page, error: String(error.message || error) }; }
  }));
  for (const fetched of results) {
    if (fetched.error) {
      out.enrichmentErrors = [...(out.enrichmentErrors || []), { url: fetched.page, error: fetched.error }];
      continue;
    }
    if (!out.image) {
      const image = pageImage(fetched.html, fetched.url, out.name);
      if (image) out.image = image;
    }
    if (!out.streamUrl) {
      const stream = mediaLink(fetched.html, fetched.url);
      if (stream) out.streamUrl = stream;
    }
    if (!out.productUrl) {
      const product = storeLink(fetched.html, fetched.url);
      if (product) out.productUrl = product;
    }
  }
  if (!out.image && out.officialUrl) {
    out.image = 'https://image.thum.io/get/width/1200/crop/675/noanimate/' + encodeURIComponent(out.officialUrl);
    out.imageFallback = 'official-page-snapshot';
  }
  return out;
}

const data = JSON.parse(await readFile('data/events.json', 'utf8'));

async function readEvents(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

const collected = await readEvents('data/research-candidates.json');
const officialSeeds = await readEvents('data/official-seed-events.json');

// Seed events win over a duplicate automated candidate only when both have the
// same id: the seed is the manually verified canonical backfill.
const byId = new Map();
for (const item of [...collected, ...officialSeeds]) byId.set(item.id, item);

const valid = [...byId.values()].filter(e =>
  e?.confidence === 'OFFICIAL' &&
  typeof e.officialUrl === 'string' &&
  e.officialUrl.length > 0 &&
  typeof e.date === 'string' &&
  !Number.isNaN(Date.parse(e.date)) &&
  e.date.startsWith(currentMonth)
);

const published = new Map();
for (const event of data.events || []) {
  if (typeof event.date === 'string' && event.date.startsWith(currentMonth)) published.set(event.id, event);
}
for (const item of valid) {
  const prior = published.get(item.id);
  published.set(item.id, prior?.confidence === 'OFFICIAL'
    ? { ...prior, ...item, specifications: { ...(prior.specifications || {}), ...(item.specifications || {}) } }
    : item);
}

data.month = currentMonth;
data.updatedAt = now.toISOString();
data.events = await Promise.all(
  [...published.values()]
    .filter(e => e.date.startsWith(currentMonth))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(enrichOfficialMedia)
);

data.sourcesNote = `Mise à jour automatisée du ${now.toISOString()}: événements du mois enrichis depuis leurs pages officielles avec photos, diffusion/replay et liens d'achat ou précommande lorsqu'ils existent.`;

await writeFile('data/events.json', `${JSON.stringify(data, null, 2)}\n`);
await mkdir('reports', { recursive: true });
await writeFile(
  `reports/monthly-update-${currentMonth}.md`,
  `# Rapport de mise à jour — ${currentMonth}\n\n- Exécuté : ${now.toISOString()}\n- Candidats automatiques lus : ${collected.length}\n- Backfills officiels lus : ${officialSeeds.length}\n- Candidats officiels valides du mois : ${valid.length}\n- Événements publiés : ${data.events.length}\n- Règle : événements passés, du jour et à venir du mois conservés; aucune date sans URL officielle n'est publiée.\n`
);

console.log(`Mise à jour mensuelle terminée pour ${currentMonth}: ${valid.length} candidat(s) officiel(s), ${data.events.length} événement(s) publiés.`);
