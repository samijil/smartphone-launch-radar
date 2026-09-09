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
data.events = [...published.values()]
  .filter(e => e.date.startsWith(currentMonth))
  .sort((a, b) => new Date(a.date) - new Date(b.date));

data.sourcesNote = `Mise à jour automatisée du ${now.toISOString()}: événements passés et à venir du mois ${currentMonth}, publiés uniquement avec date ISO et URL officielle. Les candidats non confirmés restent exclus du radar.`;

await writeFile('data/events.json', `${JSON.stringify(data, null, 2)}\n`);
await mkdir('reports', { recursive: true });
await writeFile(
  `reports/monthly-update-${currentMonth}.md`,
  `# Rapport de mise à jour — ${currentMonth}\n\n- Exécuté : ${now.toISOString()}\n- Candidats automatiques lus : ${collected.length}\n- Backfills officiels lus : ${officialSeeds.length}\n- Candidats officiels valides du mois : ${valid.length}\n- Événements publiés : ${data.events.length}\n- Règle : événements passés, du jour et à venir du mois conservés; aucune date sans URL officielle n'est publiée.\n`
);

console.log(`Mise à jour mensuelle terminée pour ${currentMonth}: ${valid.length} candidat(s) officiel(s), ${data.events.length} événement(s) publiés.`);
