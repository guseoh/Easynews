import { copyFile } from 'node:fs/promises';
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM.md']) {
  await copyFile(new URL(`../../vendor/siwc-local/${name}`, import.meta.url), new URL(`../../vendor/siwc-local/dist/${name}`, import.meta.url));
}
