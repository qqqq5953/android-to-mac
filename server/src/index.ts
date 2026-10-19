import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { handleUpload } from './upload.js';
import { serveStatic } from './static.js';
import { HttpError } from './errors.js';
import { advertise } from './mdns.js';

const PORT = Number(process.env.PORT ?? 8765);
const SAVE_DIR = process.env.SAVE_DIR ?? path.join(os.homedir(), 'Downloads', 'FromAndroid');
const DEVICE_NAME = process.env.DEVICE_NAME ?? computerName();
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

/** mDNS 服務類型，Android App 會用這個名字找 Mac */
export const SERVICE_TYPE = 'android2mac';

await mkdir(SAVE_DIR, { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: DEVICE_NAME, version: 1 }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const saved = await handleUpload(req, SAVE_DIR);
      console.log(`✔ 收到 ${saved.fileName} (${formatBytes(saved.size)})`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(saved));
      return;
    }
    if (req.method === 'GET') {
      await serveStatic(WEB_DIR, url.pathname, res);
      return;
    }
    res.writeHead(404).end();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    console.error('✘', err instanceof Error ? err.message : err);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'unknown error' }));
  }
});

// 上傳大檔案可能很久，關掉預設的 request timeout
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  const addresses = lanAddresses();
  console.log(`📥 檔案會存到 ${SAVE_DIR}`);
  console.log('🌐 手機瀏覽器開（QR code 是第一個）：');
  for (const { iface, ip } of addresses) console.log(`   http://${ip}:${PORT}  (${iface})`);
  if (addresses[0]) qrcode.generate(`http://${addresses[0].ip}:${PORT}`, { small: true });

  const stopAdvertising = advertise(DEVICE_NAME, SERVICE_TYPE, PORT);
  console.log(`📡 mDNS 廣播中：_${SERVICE_TYPE}._tcp「${DEVICE_NAME}」`);

  const shutdown = () => {
    stopAdvertising();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

/**
 * 列出本機 IPv4 位址，Wi-Fi／有線網卡（Mac 上是 en0、en1…）排前面，
 * VPN（utun）、虛擬機或 Docker 的橋接網卡（bridge、vmnet）手機通常連不到，排後面。
 */
function lanAddresses(): { iface: string; ip: string }[] {
  const list = Object.entries(os.networkInterfaces()).flatMap(([iface, infos]) =>
    (infos ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ iface, ip: i.address })),
  );
  const rank = ({ iface }: { iface: string }) => (/^(en|eth|wl)/.test(iface) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b));
}

function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Mac 上用「系統設定 > 一般 > 關於本機」裡的名稱（例如「Andy 的 MacBook Pro」） */
function computerName(): string {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim();
    } catch {}
  }
  return os.hostname().replace(/\.local$/, '');
}
