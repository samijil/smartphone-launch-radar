import { access, readFile } from 'node:fs/promises';

const required = ['dist/index.html','dist/src/main.js','dist/src/style.css','dist/data/events.json'];
for (const path of required) await access(path);
const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('./src/main.js') || !html.includes('./src/style.css')) throw new Error('dist/index.html does not reference expected application assets');
const payload = JSON.parse(await readFile('dist/data/events.json', 'utf8'));
if (!Array.isArray(payload.events)) throw new Error('Built event payload is invalid');
for (const e of payload.events) if (!e.image || !/^https?:\/\//.test(e.image)) throw new Error(`Published event lacks official image: ${e.id}`);
console.log(`✓ Build integrity verified (${required.length} required assets, ${payload.events.length} event(s), all with official images)`);
