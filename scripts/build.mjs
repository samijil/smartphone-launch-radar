import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'src', 'data', 'public']) {
  try { await cp(path, `dist/${path}`, { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log('✓ Dashboard statique généré dans dist/');
