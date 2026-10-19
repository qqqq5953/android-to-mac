import { File } from 'expo-file-system';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useZeroconf } from 'react-native-zeroconf';
import { normalizeUrl, type Target, useSavedTarget } from './src/target';
import { fetchInfo, uploadFile } from './src/upload';

/** 和 server/src/index.ts 的 SERVICE_TYPE 一致 */
const SERVICE_TYPE = 'android2mac';

type Status = 'waiting' | 'uploading' | 'done' | 'error';

interface Item {
  uri: string;
  name: string;
  size: number | null;
  progress: number;
  status: Status;
  error?: string;
}

export default function App() {
  const c = useColors();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { target, loaded, save } = useSavedTarget();
  const { services, isScanning, restart } = useZeroconf({ type: SERVICE_TYPE });
  const [items, setItems] = useState<Item[]>([]);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string>();

  const discovered = useMemo<Target[]>(
    () =>
      services
        .filter((s) => s.ipv4.length > 0)
        .map((s) => ({ name: s.name, url: `http://${s.ipv4[0]}:${s.port}` })),
    [services],
  );

  // 記住的 Mac 換了 IP（例如熱點重新分配）時，用 mDNS 找到的新位址更新
  useEffect(() => {
    const found = target && discovered.find((d) => d.name === target.name);
    if (found && found.url !== target.url) save(found);
  }, [discovered, target]);

  // 從分享選單進來：把檔案列出來，已經記住 Mac 的話直接開始傳
  useEffect(() => {
    if (!loaded || !hasShareIntent || !shareIntent.files?.length) return;
    const shared = shareIntent.files.map<Item>((f) => ({
      uri: f.path,
      name: f.fileName,
      size: f.size,
      progress: 0,
      status: 'waiting',
    }));
    resetShareIntent();
    setItems(shared);
    if (target) send(shared, target);
    else setPicking(true);
  }, [loaded, hasShareIntent]);

  const sendingRef = useRef(false);
  async function send(list: Item[], to: Target) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const update = (uri: string, patch: Partial<Item>) =>
      setItems((prev) => prev.map((it) => (it.uri === uri ? { ...it, ...patch } : it)));

    // 一次傳一個，進度比較好懂，也不會同時開太多連線
    for (const item of list.filter((it) => it.status !== 'done')) {
      update(item.uri, { status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadFile(to.url, item.uri, item.name, (progress) => update(item.uri, { progress }));
        update(item.uri, { status: 'done', progress: 1 });
        deleteCachedCopy(item.uri);
      } catch (err) {
        update(item.uri, { status: 'error', error: (err as Error).message });
      }
    }
    sendingRef.current = false;
    setSending(false);
  }

  function choose(next: Target) {
    save(next);
    setPicking(false);
    if (items.some((it) => it.status !== 'done')) send(items, next);
  }

  async function addManual() {
    setManualError(undefined);
    const url = normalizeUrl(manual);
    try {
      choose({ name: await fetchInfo(url), url });
      setManual('');
    } catch {
      setManualError(`連不到 ${url}，確認 Mac 上的 server 有開、兩台在同一個網路`);
    }
  }

  const allDone = items.length > 0 && items.every((it) => it.status === 'done');
  const hasFailed = items.some((it) => it.status === 'error');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <StatusBar style="auto" />
      <Text style={[styles.title, { color: c.text }]}>傳到 Mac</Text>

      {/* 目前的 Mac */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.label, { color: c.muted }]}>傳送到</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.deviceName, { color: c.text }]}>{target?.name ?? '尚未選擇'}</Text>
            {target && <Text style={{ color: c.muted }}>{target.url}</Text>}
          </View>
          <Pressable onPress={() => setPicking((p) => !p)} disabled={sending}>
            <Text style={[styles.link, { color: sending ? c.muted : c.accent }]}>{picking ? '收起' : '更換'}</Text>
          </Pressable>
        </View>
      </View>

      {/* 選擇 Mac：mDNS 自動找 + 手動輸入 */}
      {(picking || (loaded && !target)) && (
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: c.muted, flex: 1 }]}>附近的 Mac</Text>
            {isScanning && <ActivityIndicator size="small" />}
            <Pressable onPress={restart}>
              <Text style={[styles.link, { color: c.accent }]}>重新搜尋</Text>
            </Pressable>
          </View>
          {discovered.length === 0 && (
            <Text style={{ color: c.muted, marginVertical: 8 }}>找不到的話，確認 Mac 上有執行 npm start，或在下面手動輸入</Text>
          )}
          {discovered.map((d) => (
            <Pressable key={d.url} onPress={() => choose(d)} style={styles.deviceRow}>
              <Text style={[styles.deviceName, { color: c.text }]}>💻 {d.name}</Text>
              <Text style={{ color: c.muted }}>{d.url}</Text>
            </Pressable>
          ))}
          <View style={[styles.row, { marginTop: 12 }]}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="手動輸入，例如 192.168.0.167"
              placeholderTextColor={c.muted}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={addManual}
              style={[styles.input, { color: c.text, borderColor: c.border }]}
            />
            <Pressable onPress={addManual} disabled={!manual.trim()}>
              <Text style={[styles.link, { color: manual.trim() ? c.accent : c.muted }]}>連線</Text>
            </Pressable>
          </View>
          {manualError && <Text style={{ color: c.error, marginTop: 6 }}>{manualError}</Text>}
        </View>
      )}

      {/* 檔案清單 */}
      {items.length === 0 ? (
        <Text style={[styles.hint, { color: c.muted }]}>在相簿或檔案 App 選好檔案，按「分享」→「傳到 Mac」</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.uri}
          renderItem={({ item }) => <FileRow item={item} />}
          style={{ flexGrow: 0 }}
        />
      )}

      {hasFailed && !sending && target && (
        <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={() => send(items, target)}>
          <Text style={styles.buttonText}>重試失敗的檔案</Text>
        </Pressable>
      )}
      {allDone && (
        <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={() => BackHandler.exitApp()}>
          <Text style={styles.buttonText}>完成</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function FileRow({ item }: { item: Item }) {
  const c = useColors();
  const status =
    item.status === 'done'
      ? '✓ 完成'
      : item.status === 'error'
        ? item.error
        : item.status === 'uploading'
          ? `${Math.round(item.progress * 100)}%`
          : '等待中';
  return (
    <View style={[styles.card, { backgroundColor: c.card }]}>
      <View style={styles.row}>
        <Text style={[styles.fileName, { color: c.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.size != null && <Text style={{ color: c.muted }}>{formatBytes(item.size)}</Text>}
      </View>
      <View style={[styles.track, { backgroundColor: c.border }]}>
        <View
          style={[
            styles.bar,
            { width: `${item.progress * 100}%`, backgroundColor: item.status === 'error' ? c.error : c.accent },
          ]}
        />
      </View>
      <Text style={{ color: item.status === 'error' ? c.error : c.muted, marginTop: 4 }}>{status}</Text>
    </View>
  );
}

/** expo-share-intent 會把分享的檔案複製一份到 App 的暫存資料夾，傳完就刪掉 */
function deleteCachedCopy(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
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

function useColors() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#000', card: '#1c1c1e', text: '#f5f5f7', muted: '#98989d', border: '#38383a', accent: '#2997ff', error: '#ff453a' }
    : { bg: '#f5f5f7', card: '#fff', text: '#1d1d1f', muted: '#6e6e73', border: '#e5e5ea', accent: '#0071e3', error: '#d70015' };
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  label: { fontSize: 13, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deviceName: { fontSize: 17, fontWeight: '600' },
  deviceRow: { paddingVertical: 10 },
  link: { fontSize: 16, fontWeight: '600' },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  hint: { textAlign: 'center', marginTop: 32, fontSize: 15, lineHeight: 22 },
  fileName: { flex: 1, fontSize: 16 },
  track: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  bar: { height: '100%' },
  button: { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
