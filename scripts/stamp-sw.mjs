// Post-build: stamp the service worker's cache name with a hash of the built
// index.html, so every deploy installs a fresh SW whose activation purges the
// previous deploy's cache (otherwise old hashed bundles accumulate forever).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(__dirname, '../docs');
const swPath = path.join(docs, 'sw.js');

const indexHtml = fs.readFileSync(path.join(docs, 'index.html'));
const build = crypto.createHash('sha256').update(indexHtml).digest('hex').slice(0, 10);

const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('__BUILD__')) {
  throw new Error('sw.js is missing the __BUILD__ placeholder');
}
fs.writeFileSync(swPath, sw.replace('__BUILD__', build));
console.log(`stamped docs/sw.js cache: hackerbaby-${build}`);
