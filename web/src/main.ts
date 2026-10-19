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

picker.addEventListener('change', () => {
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
    animateLayout(() => {
      item.status = status;
      item.el.className = status;
      // 已完成的新的放上面；其他組照先來後到
      if (status === 'done') groups.done.list.prepend(item.el);
      else groups[status].list.append(item.el);
      updateGroups();
    });
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

function updateGroups() {
  for (const { section, list, count } of Object.values(groups)) {
    section.hidden = list.children.length === 0;
    count.textContent = `(${list.children.length})`;
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * FLIP 動畫：先記下每一列和每個組標題在畫面上的位置，做完 DOM 變動後，
 * 讓有移動的元素從舊位置滑到新位置，新出現的淡入。
 * 量位置時已經包含進行中動畫的位移，所以連續換組時會從目前看到的位置接著滑。
 */
function animateLayout(mutate: () => void) {
  const targets = () => groupsEl.querySelectorAll<HTMLElement>('li, .group-header');
  const before = new Map<HTMLElement, DOMRect>();
  for (const el of targets()) before.set(el, el.getBoundingClientRect());

  mutate();
  if (reduceMotion.matches) return;

  for (const el of targets()) {
    el.getAnimations().forEach((a) => a.cancel());
    const old = before.get(el);
    if (!old || old.height === 0) {
      // 新加入的列，或剛從隱藏變成顯示的組標題
      el.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], {
        duration: 250,
        easing: 'ease-out',
      });
      continue;
    }
    const dy = old.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
      duration: 350,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
  }
}
