import { access, readFile } from 'node:fs/promises';

const required = [
  'dist/index.html',
  'dist/src/main.js',
  'dist/src/style.css',
  'dist/data/events.json'
];

for (const path of required) await access(path);

const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('./src/main.js') || !html.includes('./src/style.css')) {
  throw new Error('dist/index.html does not reference the expected application assets');
}

const payload = JSON.parse(await readFile('dist/data/events.json', 'utf8'));
if (!Array.isArray(payload.events)) throw new Error('Built event payload is invalid');

console.log(`✓ Build integrity verified (${required.length} required assets, ${payload.events.length} event(s))`);
