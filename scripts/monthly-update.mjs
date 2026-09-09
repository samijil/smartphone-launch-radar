/**
 * Prépare un cycle mensuel sans inventer de lancement. Les sources candidates
 * doivent être consignées dans data/research-candidates.json par un collecteur
 * ou une revue humaine; seules les entrées avec une URL officielle et une date
 * ISO sont promues. Une valeur OFFICIAL existante n'est jamais rétrogradée.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const now = new Date(); const month = now.toISOString().slice(0, 7);
const data = JSON.parse(await readFile('data/events.json', 'utf8'));
let candidates = [];
try { candidates = JSON.parse(await readFile('data/research-candidates.json', 'utf8')).events ?? []; } catch { /* aucune collecte vérifiée disponible */ }
let officialSeeds = [];
try { officialSeeds = JSON.parse(await readFile('data/official-seed-events.json', 'utf8')).events ?? []; } catch { /* aucune amorce officielle disponible */ }
candidates = [...officialSeeds, ...candidates];
const old = new Map(data.events.map(e => [e.id, e]));
const valid = [...new Map(candidates.map(item => [item.id, item])).values()].filter(e => e.confidence === 'OFFICIAL' && e.officialUrl && !Number.isNaN(Date.parse(e.date)) && e.date.startsWith(month));
for (const item of valid) { const prior = old.get(item.id); old.set(item.id, prior?.confidence === 'OFFICIAL' ? { ...item, ...prior } : item); }
data.month = month; data.updatedAt = now.toISOString(); data.events = [...old.values()].filter(e => e.date.startsWith(month));
data.sourcesNote = `Mise à jour automatisée du ${now.toISOString()}: seules les annonces disposant d'une URL officielle et d'une date ISO sont publiées automatiquement. Les résultats rapportés et non confirmés nécessitent une revue.`;
await writeFile('data/events.json', `${JSON.stringify(data, null, 2)}\n`);
await mkdir('reports', { recursive: true });
await writeFile(`reports/monthly-update-${month}.md`, `# Rapport de mise à jour — ${month}\n\n- Exécuté : ${now.toISOString()}\n- Candidats officiels validés : ${valid.length}\n- Événements publiés : ${data.events.length}\n- Règle : aucune donnée OFFICIAL existante n’est rétrogradée.\n`);
console.log(`Mise à jour prudente terminée pour ${month}: ${valid.length} candidat(s) officiel(s).`);
