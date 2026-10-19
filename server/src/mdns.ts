import { spawn } from 'node:child_process';
import { Bonjour } from 'bonjour-service';

/**
 * 在區網廣播 _<type>._tcp 服務，回傳停止廣播的函式。
 *
 * macOS 用系統內建的 dns-sd，交給 mDNSResponder 處理。
 * 不用 bonjour-service 是因為它會用本機主機名稱另外宣告 A 紀錄，
 * 和系統的 mDNSResponder 衝突，macOS 會因此把主機名稱改成「xxx-2.local」。
 */
export function advertise(name: string, type: string, port: number): () => void {
  if (process.platform === 'darwin') {
    const child = spawn('dns-sd', ['-R', name, `_${type}._tcp`, 'local', String(port)], { stdio: 'ignore' });
    child.on('error', (err) => console.error('✘ mDNS 廣播失敗：', err.message));
    return () => child.kill();
  }

  // 其他平台沒有 dns-sd：用獨立的主機名稱，避免和系統的主機名稱衝突
  const bonjour = new Bonjour();
  bonjour.publish({ name, type, port, host: `${type}-${port}.local` });
  return () => bonjour.destroy();
}
