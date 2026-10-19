import type { IncomingMessage } from 'node:http';
import { createWriteStream } from 'node:fs';
import { access, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.js';

export interface SavedFile {
  fileName: string;
  size: number;
}

/**
 * 協定：POST /api/upload
 *   Header `X-File-Name`：encodeURIComponent 過的檔名
 *   Body：檔案原始 bytes（不是 multipart），邊收邊寫入硬碟
 * 先寫到 .part 暫存檔，收完才改名，避免傳到一半的檔案被當成完整檔案。
 */
export async function handleUpload(req: IncomingMessage, saveDir: string): Promise<SavedFile> {
  const header = req.headers['x-file-name'];
  if (typeof header !== 'string' || !header) throw new HttpError(400, '缺少 X-File-Name header');

  const fileName = sanitize(decodeURIComponent(header));
  const finalPath = await uniquePath(saveDir, fileName);
  const tempPath = `${finalPath}.part`;

  let size = 0;
  req.on('data', (chunk: Buffer) => (size += chunk.length));
  try {
    await pipeline(req, createWriteStream(tempPath));
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw new HttpError(400, `傳輸中斷：${(err as Error).message}`);
  }

  const expected = Number(req.headers['content-length']);
  if (Number.isFinite(expected) && expected !== size) {
    await unlink(tempPath).catch(() => {});
    throw new HttpError(400, `檔案不完整：收到 ${size} / ${expected} bytes`);
  }

  await rename(tempPath, finalPath);
  return { fileName: path.basename(finalPath), size };
}

/** 只留檔名本身，防止 ../ 之類的路徑穿越 */
function sanitize(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[\x00-\x1f:]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : 'untitled';
}

/** 檔名重複時改成 photo (1).jpg、photo (2).jpg… */
async function uniquePath(dir: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName);
  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i === 0 ? fileName : `${name} (${i})${ext}`);
    const taken = await Promise.any([access(candidate), access(`${candidate}.part`)]).then(
      () => true,
      () => false,
    );
    if (!taken) return candidate;
  }
}
