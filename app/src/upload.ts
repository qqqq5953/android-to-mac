import { File } from 'expo-file-system';

/**
 * 把一個檔案傳到 Mac，協定和 server/src/upload.ts 一致：
 * POST /api/upload，檔名放在 X-File-Name header，body 是檔案原始 bytes。
 * 由原生端從硬碟串流上傳，大影片也不會整個讀進記憶體。
 */
export async function uploadFile(
  baseUrl: string,
  fileUri: string,
  fileName: string,
  onProgress: (ratio: number) => void,
): Promise<void> {
  const file = new File(fileUri);
  const task = file.createUploadTask(`${baseUrl}/api/upload`, {
    httpMethod: 'POST',
    headers: { 'X-File-Name': encodeURIComponent(fileName), 'Content-Type': 'application/octet-stream' },
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && onProgress(bytesSent / totalBytes),
  });
  try {
    const res = await task.uploadAsync();
    if (res.status >= 300) throw new Error(errorMessage(res.body) ?? `HTTP ${res.status}`);
  } finally {
    task.release();
  }
}

/** 確認這個網址是不是我們的 Mac server，回傳裝置名稱 */
export async function fetchInfo(baseUrl: string, timeoutMs = 3000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/info`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info: { name: string } = await res.json();
    return info.name;
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(body: string): string | undefined {
  try {
    return JSON.parse(body).error;
  } catch {
    return undefined;
  }
}
