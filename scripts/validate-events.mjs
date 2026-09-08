import { readFile } from 'node:fs/promises';
const allowedStatus = new Set(['COMPLETED', 'UPCOMING', 'LIVE', 'TBC']);
const allowedConfidence = new Set(['OFFICIAL', 'REPORTED', 'UNCONFIRMED']);
const urlFields = ['officialUrl', 'productUrl', 'eventUrl', 'streamUrl', 'youtubeUrl', 'pressUrl', 'reservationUrl'];
let payload;
try { payload = JSON.parse(await readFile('data/events.json', 'utf8')); } catch (error) { console.error(`JSON illisible: ${error.message}`); process.exit(1); }
const errors = [];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month || '')) errors.push('month doit être YYYY-MM');
if (!Array.isArray(payload.events)) errors.push('events doit être un tableau');
for (const [i, e] of (payload.events || []).entries()) {
  const where = `events[${i}]`;
  for (const key of ['id','name','brand','date','timezone','region','status','confidence','summary','specifications','image']) if (!(key in e)) errors.push(`${where}.${key} est requis`);
  if (!allowedStatus.has(e.status)) errors.push(`${where}.status invalide`);
  if (!allowedConfidence.has(e.confidence)) errors.push(`${where}.confidence invalide`);
  if (e.date && Number.isNaN(Date.parse(e.date))) errors.push(`${where}.date doit être une date ISO valide`);
  if (e.status === 'TBC' && e.confidence === 'OFFICIAL' && e.date) errors.push(`${where}: une date officielle doit être UPCOMING, LIVE ou COMPLETED`);
  for (const key of urlFields) if (e[key] != null) try { new URL(e[key]); } catch { errors.push(`${where}.${key} doit être une URL absolue`); }
}
if (errors.length) { console.error(errors.map(x => `• ${x}`).join('\n')); process.exit(1); }
console.log(`✓ data/events.json valide (${payload.events.length} événement(s), ${payload.month})`);
