import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDevHttpsCert } from './scripts/https.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const peercomputeRepo = path.resolve(__dirname, '../peercompute');
const peercomputeEntry = path.resolve(peercomputeRepo, 'peercompute/src/peercompute/index.js');

export default defineConfig(({ command }) => ({
  root: '.',
  base: './',
  server: {
    port: 5199,
    https: command === 'serve' ? ensureDevHttpsCert() : undefined,
    fs: {
      allow: [__dirname, peercomputeRepo]
    }
  },
  resolve: {
    alias: {
      '@peercompute': peercomputeEntry
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'docs'),
    assetsDir: 'assets',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
}));
