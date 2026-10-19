import { useEffect, useState } from 'react';
import { uploadFile } from './upload';

type Status = 'waiting' | 'uploading' | 'done' | 'error';

interface Item {
  id: number;
  file: File;
  progress: number;
  status: Status;
  error?: string;
}

let nextId = 0;

export function App() {
  const [deviceName, setDeviceName] = useState<string>();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((info: { name: string }) => setDeviceName(info.name))
      .catch(() => setDeviceName(undefined));
  }, []);

  const update = (id: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  async function send(files: FileList | null) {
    if (!files?.length) return;
    const added = Array.from(files, (file) => ({ id: nextId++, file, progress: 0, status: 'waiting' as Status }));
    setItems((prev) => [...added, ...prev]);
    // 一次傳一個，避免手機同時開太多連線
    for (const item of added) {
      update(item.id, { status: 'uploading' });
      try {
        await uploadFile(item.file, (progress) => update(item.id, { progress }));
        update(item.id, { status: 'done', progress: 1 });
      } catch (err) {
        update(item.id, { status: 'error', error: (err as Error).message });
      }
    }
  }

  return (
    <main>
      <h1>傳到 {deviceName ?? 'Mac'}</h1>
      <label className="picker">
        選擇照片、影片或檔案
        <input type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ''))} />
      </label>
      <ul>
        {items.map((it) => (
          <li key={it.id} className={it.status}>
            <span className="name">{it.file.name}</span>
            <span className="meta">
              {it.status === 'error' ? it.error : it.status === 'done' ? '完成' : `${Math.round(it.progress * 100)}%`}
            </span>
            <progress value={it.progress} max={1} />
          </li>
        ))}
      </ul>
    </main>
  );
}
