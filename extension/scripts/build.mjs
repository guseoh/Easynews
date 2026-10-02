import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/sidepanel.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: true,
  logLevel: 'info',
});
for (const file of ['sidepanel.html', 'sidepanel.css']) {
  await copyFile(new URL(`../public/${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
}
await copyFile(new URL('../manifest.json', import.meta.url), new URL('../dist/manifest.json', import.meta.url));
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/readability-LICENSE.md', 'licenses/Apache-2.0.txt']) {
  await copyFile(new URL(`../../${file}`, import.meta.url), new URL(`../dist/${file.split('/').at(-1)}`, import.meta.url));
}
