import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const certDir = path.join(repoRoot, 'certs');
const keyPath = path.join(certDir, 'dev-key.pem');
const certPath = path.join(certDir, 'dev-cert.pem');

function getLocalIPv4Addresses() {
  const ips = new Set();
  const nets = os.networkInterfaces();
  for (const ifname of Object.keys(nets)) {
    for (const net of nets[ifname] || []) {
      if (!net) continue;
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;
      if (net.address.startsWith('169.254.')) continue;
      ips.add(net.address);
    }
  }
  return Array.from(ips);
}

export function ensureDevHttpsCert() {
  try {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };
    }
  } catch (_) {
    // fall through to regenerate
  }

  fs.mkdirSync(certDir, { recursive: true });

  const ips = getLocalIPv4Addresses();
  const subjectAltName = [
    'DNS:localhost',
    'IP:127.0.0.1',
    ...ips.map((ip) => `IP:${ip}`)
  ].join(',');

  const cmd = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '3650',
      '-subj',
      '/CN=hackerbaby-dev',
      '-addext',
      `subjectAltName=${subjectAltName}`,
      '-keyout',
      keyPath,
      '-out',
      certPath
    ],
    { stdio: 'inherit' }
  );

  if (cmd.status !== 0) {
    throw new Error('Failed to generate dev HTTPS certificate (is openssl installed?)');
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}
