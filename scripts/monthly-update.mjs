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
      if (url && /^https?:/.test(url) && !/(?:\/order\/list|\/shop\/privilege|\/shop\/goto\/)/i.test(url)) return url;
    }
  }
  return null;
}
async function enrichOfficialMedia(event) {
  const out = { ...event };
  if (out.productUrl && /(?:\/order\/list|\/shop\/privilege)/i.test(new URL(out.productUrl).pathname)) delete out.productUrl;
  if (out.brand === 'Apple' && out.productUrl) delete out.productUrl;
  if (out.brand === 'HONOR' && out.productUrl && /(?:&#x|\/shop\/https|\/shop\/privilege)/i.test(out.productUrl)) delete out.productUrl;
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
  if (out.brand === 'Apple') delete out.productUrl;
  if (out.brand === 'HONOR' && out.productUrl && /(?:&#x|\/shop\/https|\/shop\/privilege)/i.test(out.productUrl)) delete out.productUrl;
  if (!out.image && out.sourceUrl && out.sourceUrl !== out.officialUrl) {
    out.image = 'https://image.thum.io/get/width/1200/crop/675/noanimate/' + encodeURIComponent(out.sourceUrl);
    out.imageFallback = 'source-page-snapshot';
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

const valid = [...byId.values()].filter(e => {
  if (!e || !['OFFICIAL', 'REPORTED'].includes(e.confidence)) return false;
  if (typeof e.date !== 'string' || Number.isNaN(Date.parse(e.date)) || !e.date.startsWith(currentMonth)) return false;
  // OFFICIAL requires a manufacturer page. REPORTED is allowed from a trusted
  // specialist source, but must retain the article URL as its traceable source.
  if (e.confidence === 'OFFICIAL') return typeof e.officialUrl === 'string' && e.officialUrl.length > 0;
  return typeof (e.sourceUrl || e.officialUrl) === 'string' && (e.sourceUrl || e.officialUrl).length > 0;
});

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
const uniqueByOfficialUrl = new Map();
for (const event of [...published.values()].filter(e => e.date.startsWith(currentMonth)).sort((a,b)=>new Date(a.date)-new Date(b.date))) {
  const key = String(event.officialUrl || event.sourceUrl || event.id).replace(/\/$/, '');
  const prior = uniqueByOfficialUrl.get(key);
  if (!prior) uniqueByOfficialUrl.set(key, event);
  else {
    const priorScore = (prior.confidence === 'OFFICIAL' ? 2 : 0) + Object.keys(prior.specifications || {}).length;
    const score = (event.confidence === 'OFFICIAL' ? 2 : 0) + Object.keys(event.specifications || {}).length;
    if (score > priorScore) uniqueByOfficialUrl.set(key, event);
  }
}
const enrichedEvents = await Promise.all([...uniqueByOfficialUrl.values()].map(enrichOfficialMedia));
function normalizeModel(value) {
  return String(value || '')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function modelMatch(text) {
  const value = normalizeModel(text);
  const patterns = [
    [/\b(?:Apple\s+)?iPhone\s+(?:Duo|Ultra|Air(?:\s+\d+)?|\d{1,2}(?:\s+(?:Pro(?:\s+Max)?|Plus|Mini|Ultra|Air))?)\b/i, 'Apple'],
    [/\b(?:Samsung\s+)?Galaxy\s+(?:Z\s+)?(?:Fold|Flip)\s*\d+(?:\s+(?:Ultra|FE|Pro))?\b/i, 'Samsung'],
    [/\b(?:Samsung\s+)?Galaxy\s+S\d{1,2}(?:\s+(?:Ultra|Plus|FE|Edge))?\b/i, 'Samsung'],
    [/\bXiaomi\s+\d{1,2}(?:\s+(?:Fold|Ultra|Pro(?:\s+Max)?|T(?:\s+Pro)?|Lite))?\b/i, 'Xiaomi'],
    [/\bRedmi\s+(?:Note\s+)?\d{1,2}(?:\s+(?:Pro(?:\s+Max)?|Ultra|Plus))?\b/i, 'Xiaomi'],
    [/\bPOCO\s+[A-Z]?\d{1,2}(?:\s+(?:Pro|Ultra|Plus|GT))?\b/i, 'Xiaomi'],
    [/\bHuawei\s+(?:Mate\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?|Pura\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)\b/i, 'Huawei'],
    [/\b(?:HONOR|Honor)\s+(?:Magic\s+\d+(?:\s+(?:Pro|Lite|Ultra))?|Magic\s*V\d+(?:\s+(?:Pro|Ultimate))?)\b/i, 'HONOR'],
    [/\bOPPO\s+(?:Find\s+[A-Za-z0-9]+(?:\s+(?:Pro|Ultra))?|Reno\s+\d+(?:\s+(?:Pro|F))?)\b/i, 'OPPO'],
    [/\bOnePlus\s+\d+(?:[A-Z])?(?:\s+(?:Pro|R|T))?\b/i, 'OnePlus'],
    [/\b(?:vivo|Vivo)\s+[A-Z]\d+(?:\s+(?:Pro(?:\s+Max)?|Ultra|e))?\b/i, 'vivo'],
    [/\biQOO\s+\d+(?:\s+(?:Pro|Ultra|Neo))?\b/i, 'iQOO'],
    [/\bNothing\s+Phone\s*\(\d+\)(?:\s+[A-Za-z0-9]+)?\b/i, 'Nothing'],
    [/\bMotorola\s+(?:Razr|Edge)\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?\b/i, 'Motorola'],
    [/\bGoogle\s+Pixel\s+\d+(?:\s+(?:Pro(?:\s+XL)?|Fold|a))?\b/i, 'Google'],
    [/\bSony\s+Xperia\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?\b/i, 'Sony'],
    [/\b(?:realme|Realme)\s+(?:GT\s+\d+(?:\s+(?:Pro|Ultra))?|\d+\s+Pro(?:\s+Plus)?)\b/i, 'realme'],
    [/\bInfinix\s+[A-Za-z]+\s+\d+(?:\s+(?:Pro|Plus|Ultra))?(?:\s+5G)?\b/i, 'Infinix']
  ];
  for (const [pattern, brand] of patterns) {
    const hit = value.match(pattern);
    if (hit) {
      const label = normalizeModel(hit[0]).replace(/^Apple\s+/i, '').replace(/^Samsung\s+/i, '').replace(/^HONOR\b/i, 'HONOR');
      return { brand, label, key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') };
    }
  }
  return null;
}

function deviceIdentity(event) {
  const fromTitle = modelMatch(event.name);
  if (fromTitle) return fromTitle;
  const fromSummary = modelMatch(String(event.summary || '').slice(0, 2500));
  if (fromSummary) return fromSummary;
  const fallback = normalizeModel(event.name).toLowerCase()
    .replace(/\b(launch|launched|launches|launching|announcement|announced|teaser|teased|reveal|revealed|event|keynote|availability|available|pre[- ]?order|preorder|pricing|price|sale|unveiling|unveiled|review|hands-on|impressions|specifications|full phone specifications)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { brand: event.brand, label: normalizeModel(event.name), key: fallback || event.id };
}

const grouped = new Map();
for (const event of enrichedEvents) {
  const identity = deviceIdentity(event);
  const key = identity.key || event.id;
  const normalized = {
    ...event,
    brand: identity.brand || event.brand,
    deviceModel: identity.label || event.name,
    groupKey: key
  };
  const group = grouped.get(key);
  if (!group) {
    grouped.set(key, {
      ...normalized,
      name: normalized.deviceModel,
      announcements: [{ ...event, brand: normalized.brand, deviceModel: normalized.deviceModel }],
      groupKey: key
    });
    continue;
  }

  group.announcements.push({ ...event, brand: normalized.brand, deviceModel: normalized.deviceModel });
  const groupPriority = (group.confidence === 'OFFICIAL' ? 10 : 0) + (group.image ? 2 : 0) + Object.keys(group.specifications || {}).length;
  const eventPriority = (event.confidence === 'OFFICIAL' ? 10 : 0) + (event.image ? 2 : 0) + Object.keys(event.specifications || {}).length;
  if (eventPriority > groupPriority || (new Date(event.date) < new Date(group.date) && event.confidence === group.confidence)) {
    const announcements = group.announcements;
    Object.assign(group, normalized);
    group.name = normalized.deviceModel;
    group.announcements = announcements;
    group.groupKey = key;
  }
  group.confidence = group.announcements.some(x => x.confidence === 'OFFICIAL') ? 'OFFICIAL' : 'REPORTED';
  group.image = group.image || event.image;
  group.streamUrl = group.streamUrl || event.streamUrl;
  group.productUrl = group.productUrl || event.productUrl;
  group.officialUrl = group.confidence === 'OFFICIAL' ? (group.officialUrl || event.officialUrl) : group.officialUrl;
  group.sourceUrl = group.sourceUrl || event.sourceUrl;
  group.specifications = { ...(group.specifications || {}), ...(event.specifications || {}) };
}
for (const group of grouped.values()) {
  group.announcements.sort((a,b)=>new Date(a.date)-new Date(b.date));
  group.announcementCount = group.announcements.length;
  if (group.announcements.length > 1) {
    const bestImage = group.announcements.find(x => x.image)?.image;
    if (bestImage) group.image = bestImage;
  }
}
data.events = [...grouped.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));

const officialCount = data.events.filter(e => e.confidence === 'OFFICIAL').length;
const reportedCount = data.events.filter(e => e.confidence === 'REPORTED').length;
data.sourcesNote = `Mise à jour automatisée du ${now.toISOString()}: ${officialCount} événement(s) confirmés officiellement et ${reportedCount} événement(s) rapportés par des médias spécialisés fiables, avec niveau de confiance affiché. Photos, diffusion et liens commerciaux sont enrichis lorsqu'ils existent.`;

await writeFile('data/events.json', `${JSON.stringify(data, null, 2)}\n`);
await mkdir('reports', { recursive: true });
await writeFile(
  `reports/monthly-update-${currentMonth}.md`,
  `# Rapport de mise à jour — ${currentMonth}\n\n- Exécuté : ${now.toISOString()}\n- Candidats automatiques lus : ${collected.length}\n- Backfills officiels lus : ${officialSeeds.length}\n- Candidats publiables du mois (OFFICIAL + REPORTED) : ${valid.length}\n- Événements publiés : ${data.events.length}\n- Règle : OFFICIAL exige une page constructeur; REPORTED exige une source spécialisée fiable et une date ISO. Le niveau de confiance est affiché dans le dashboard.\n`
);

console.log(`Mise à jour mensuelle terminée pour ${currentMonth}: ${valid.length} candidat(s) OFFICIAL/REPORTED, ${data.events.length} événement(s) publiés.`);
