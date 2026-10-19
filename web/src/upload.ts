/**
 * 把一個檔案用 raw body 傳到 Mac。
 * 用 XMLHttpRequest 而不是 fetch，因為 fetch 拿不到上傳進度。
 */
export function uploadFile(file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error(safeError(xhr.responseText) ?? `HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('連線失敗'));
    xhr.send(file);
  });
}

function safeError(text: string): string | undefined {
  try {
    return JSON.parse(text).error;
  } catch {
    return undefined;
  }
}
