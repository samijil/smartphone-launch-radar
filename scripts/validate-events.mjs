import { readFile } from 'node:fs/promises';

const allowedStatus = new Set(['COMPLETED', 'UPCOMING', 'LIVE', 'TBC']);
const allowedConfidence = new Set(['OFFICIAL', 'REPORTED', 'UNCONFIRMED']);
const required = ['id','name','brand','date','timezone','region','status','confidence','summary','specifications'];
const urlFields = ['officialUrl', 'productUrl', 'eventUrl', 'streamUrl', 'youtubeUrl', 'pressUrl', 'reservationUrl', 'sourceUrl', 'image'];

let payload;
try {
  payload = JSON.parse(await readFile('data/events.json', 'utf8'));
} catch (error) {
  console.error(`JSON illisible: ${error.message}`);
  process.exit(1);
}

const errors = [];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month || '')) errors.push('month doit être YYYY-MM');
if (!Array.isArray(payload.events)) errors.push('events doit être un tableau');

const ids = new Set();
const officialUrls = new Set();

for (const [i, e] of (payload.events || []).entries()) {
  const where = `events[${i}]`;
  for (const key of required) if (!(key in e)) errors.push(`${where}.${key} est requis`);

  if (!e.id || typeof e.id !== 'string') errors.push(`${where}.id invalide`);
  else if (ids.has(e.id)) errors.push(`${where}.id est dupliqué`);
  else ids.add(e.id);

  if (!allowedStatus.has(e.status)) errors.push(`${where}.status invalide`);
  if (!allowedConfidence.has(e.confidence)) errors.push(`${where}.confidence invalide`);
  if (e.date && Number.isNaN(Date.parse(e.date))) errors.push(`${where}.date doit être une date ISO valide`);
  if (e.status === 'TBC' && e.confidence === 'OFFICIAL' && e.date) errors.push(`${where}: une date officielle doit être UPCOMING, LIVE ou COMPLETED`);
  if (e.confidence === 'OFFICIAL' && !e.officialUrl) errors.push(`${where}.officialUrl est requis pour une entrée OFFICIAL`);
  if (e.confidence === 'OFFICIAL' && !e.image) errors.push(`${where}.image officielle est requise pour une entrée publiée OFFICIAL`);

  for (const key of urlFields) {
    if (e[key] == null || e[key] === '') continue;
    try {
      const url = new URL(e[key]);
      if (!/^https?:$/.test(url.protocol)) errors.push(`${where}.${key} doit utiliser http(s)`);
    } catch {
      errors.push(`${where}.${key} doit être une URL absolue`);
    }
  }

  if (e.officialUrl) {
    if (officialUrls.has(e.officialUrl)) errors.push(`${where}.officialUrl est dupliquée`);
    officialUrls.add(e.officialUrl);
  }

  if (!e.image || !/^https?:\/\//.test(e.image)) errors.push(`${where}.image doit être une URL http(s) officielle`);
}

if (errors.length) {
  console.error(errors.map(x => `• ${x}`).join('\n'));
  process.exit(1);
}

console.log(`✓ data/events.json valide (${payload.events.length} événement(s), ${payload.month})`);
