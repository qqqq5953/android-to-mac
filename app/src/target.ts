import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/** 要傳過去的那台 Mac */
export interface Target {
  name: string;
  url: string;
}

const KEY = 'target';

/** 記住上次選的 Mac，下次分享時直接用 */
export function useSavedTarget() {
  const [target, setTarget] = useState<Target | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((json) => json && setTarget(JSON.parse(json)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const save = (next: Target | null) => {
    setTarget(next);
    (next ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : AsyncStorage.removeItem(KEY)).catch(() => {});
  };

  return { target, loaded, save };
}

/** 「192.168.0.10」「192.168.0.10:8765」「http://…」都接受 */
export function normalizeUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  if (!/:\d+$/.test(url)) url = `${url}:8765`;
  return url;
}
