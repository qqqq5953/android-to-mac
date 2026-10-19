import { uploadFile } from './upload';
import './style.css';

type Status = 'waiting' | 'uploading' | 'done' | 'error';

interface Item {
  file: File;
  status: Status;
  el: HTMLLIElement;
  /** 上傳中才有，用來中斷這次上傳 */
  abort?: AbortController;
}

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

const title = $<HTMLHeadingElement>('#title');
const picker = $<HTMLInputElement>('#picker');
const groupsEl = $<HTMLDivElement>('#groups');
const template = $<HTMLTemplateElement>('#item-template');

/** 每個狀態一組：<section> 本身（沒檔案時隱藏）、清單、標題上的數量 */
const groups = Object.fromEntries(
  (['uploading', 'error', 'waiting', 'done'] as const).map((status) => {
    const section = $<HTMLElement>(`.group[data-status="${status}"]`);
    return [status, { section, list: $<HTMLUListElement>('ul', section), count: $('.count', section) }];
  }),
) as Record<Status, { section: HTMLElement; list: HTMLUListElement; count: Element }>;

/** 同時上傳的檔案數：小檔案多時能重疊連線等待時間，大檔案也不會互相搶頻寬搶太兇 */
const MAX_PARALLEL = 3;

const items = new Set<Item>();
const queue: Item[] = [];
let active = 0;

fetch('/api/info')
  .then((r) => r.json())
  .then((info: { name: string }) => {
    title.textContent = `傳到 ${info.name}`;
    document.title = title.textContent;
  })
  .catch(() => {});

const pickerLabel = picker.closest('label')!;
// 打開選擇器時就切成「讀取中」：使用者選完回到網頁時，瀏覽器可能還在複製檔案，
// change 要等複製完才會觸發，這段時間至少讓使用者知道有在處理
picker.addEventListener('click', () => pickerLabel.classList.add('loading'));
picker.addEventListener('cancel', () => pickerLabel.classList.remove('loading'));

picker.addEventListener('change', () => {
  pickerLabel.classList.remove('loading');
  const added = Array.from(picker.files ?? [], createItem);
  picker.value = ''; // 讓同一個檔案可以再選一次
  added.forEach(enqueue);
});

$('#clear-done').addEventListener('click', () => {
  animateLayout(() => {
    for (const item of items) if (item.status === 'done') detach(item);
  });
});

function createItem(file: File): Item {
  const el = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  $('.name', el).textContent = file.name;
  const item: Item = { file, status: 'waiting', el };
  $('.remove', el).addEventListener('click', () => animateLayout(() => detach(item)));
  $('.retry', el).addEventListener('click', () => enqueue(item));
  items.add(item);
  return item;
}

/** 移除一列；還在排隊的會在輪到時被跳過，上傳中的直接中斷 */
function detach(item: Item) {
  items.delete(item);
  item.abort?.abort();
  item.el.remove();
  updateGroups();
}

function enqueue(item: Item) {
  render(item, 'waiting', 0);
  queue.push(item);
  pump();
}

/** 有空位就從排隊中拿下一個來傳，最多同時 MAX_PARALLEL 個 */
function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const next = queue.shift()!;
    if (!items.has(next)) continue; // 排隊時被移除了
    active++;
    upload(next).finally(() => {
      active--;
      pump();
    });
  }
}

async function upload(item: Item) {
  render(item, 'uploading', 0);
  item.abort = new AbortController();
  try {
    await uploadFile(item.file, (ratio) => render(item, 'uploading', ratio), item.abort.signal);
    render(item, 'done', 1);
  } catch (err) {
    if (!item.abort.signal.aborted) render(item, 'error', 0, (err as Error).message);
  } finally {
    item.abort = undefined;
  }
}

function render(item: Item, status: Status, progress: number, error?: string) {
  // 換組（或第一次放進畫面）時才搬動，進度更新只改文字和進度條
  if (status !== item.status || !item.el.isConnected) {
    item.status = status;
    scheduleMove(item);
  }
  $<HTMLProgressElement>('progress', item.el).value = progress;
  $('.meta', item.el).textContent =
    status === 'done'
      ? '✓ 完成'
      : status === 'error'
        ? (error ?? '失敗')
        : status === 'uploading'
          ? `${Math.round(progress * 100)}%`
          : '等待中';
}

const pendingMoves = new Set<Item>();
let moveScheduled = false;

/**
 * 換組的 DOM 搬動統一在下一個畫面一次做完：小檔案傳很快時一秒可能換組幾十次，
 * 合併起來每個畫面最多只量一次位置、播一次動畫。
 */
function scheduleMove(item: Item) {
  pendingMoves.add(item);
  if (moveScheduled) return;
  moveScheduled = true;
  requestAnimationFrame(() => {
    moveScheduled = false;
    const moves = [...pendingMoves];
    pendingMoves.clear();
    animateLayout(() => {
      for (const it of moves) {
        if (!items.has(it)) continue; // 搬動前就被移除了
        it.el.className = it.status;
        // 已完成的新的放上面；其他組照先來後到
        if (it.status === 'done') groups.done.list.prepend(it.el);
        else groups[it.status].list.append(it.el);
      }
      updateGroups();
    });
  });
}

function updateGroups() {
  for (const { section, list, count } of Object.values(groups)) {
    section.hidden = list.children.length === 0;
    count.textContent = `(${list.children.length})`;
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** 清單超過這個數量就不播換組動畫：一直有列在飛也看不清楚，只會讓手機卡頓 */
const MAX_ANIMATED_ITEMS = 50;
/** 自己記錄哪些元素正在播動畫，不用每次都問每個元素的 getAnimations() */
const running = new Map<HTMLElement, Animation>();

/**
 * FLIP 動畫：先記下每一列和每個組標題在畫面上的位置，做完 DOM 變動後，
 * 讓有移動的元素從舊位置滑到新位置，新出現的淡入。
 * 量位置時已經包含進行中動畫的位移，所以連續換組時會從目前看到的位置接著滑。
 * 讀位置和改 DOM／取消動畫要分開成整批做，交錯的話每讀一次都會強迫瀏覽器重算版面。
 */
function animateLayout(mutate: () => void) {
  if (reduceMotion.matches || items.size > MAX_ANIMATED_ITEMS) return mutate();
  const targets = () => [...groupsEl.querySelectorAll<HTMLElement>('li, .group-header')];
  const before = new Map<HTMLElement, DOMRect>();
  for (const el of targets()) before.set(el, el.getBoundingClientRect());

  mutate();

  for (const a of running.values()) a.cancel();
  running.clear();
  const els = targets();
  const after = els.map((el) => el.getBoundingClientRect());

  const onScreen = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight;
  els.forEach((el, i) => {
    const old = before.get(el);
    const now = after[i];
    if (!onScreen(now) && (!old || !onScreen(old))) return; // 前後都在畫面外，不用播
    if (!old || old.height === 0) {
      // 新加入的列，或剛從隱藏變成顯示的組標題
      play(el, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], 250, 'ease-out');
      return;
    }
    const dy = old.top - now.top;
    if (Math.abs(dy) < 1) return;
    play(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], 350, 'cubic-bezier(0.2, 0.8, 0.2, 1)');
  });
}

function play(el: HTMLElement, keyframes: Keyframe[], duration: number, easing: string) {
  const animation = el.animate(keyframes, { duration, easing });
  running.set(el, animation);
  animation.onfinish = () => running.get(el) === animation && running.delete(el);
}
