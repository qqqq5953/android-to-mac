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
const toolbar = $<HTMLDivElement>('#toolbar');
const list = $<HTMLUListElement>('#list');
const template = $<HTMLTemplateElement>('#item-template');

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
  const batch = document.createDocumentFragment();
  const added = Array.from(picker.files ?? [], (file) => createItem(file, batch));
  list.prepend(batch); // 新選的一批放最上面，批次內維持選取順序
  picker.value = ''; // 讓同一個檔案可以再選一次
  added.forEach(enqueue);
});

$('#clear-done').addEventListener('click', () => {
  for (const item of items) if (item.status === 'done') remove(item);
});

function createItem(file: File, parent: ParentNode): Item {
  const el = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  $('.name', el).textContent = file.name;
  const item: Item = { file, status: 'waiting', el };
  $('.remove', el).addEventListener('click', () => remove(item));
  $('.retry', el).addEventListener('click', () => enqueue(item));
  items.add(item);
  parent.appendChild(el);
  return item;
}

function remove(item: Item) {
  items.delete(item); // 還在排隊的會在輪到時被跳過
  item.abort?.abort(); // 上傳中的直接中斷
  item.el.remove();
  updateToolbar();
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
  item.status = status;
  item.el.className = status;
  $<HTMLProgressElement>('progress', item.el).value = progress;
  $('.meta', item.el).textContent =
    status === 'done'
      ? '✓ 完成'
      : status === 'error'
        ? (error ?? '失敗')
        : status === 'uploading'
          ? `${Math.round(progress * 100)}%`
          : '等待中';
  updateToolbar();
}

function updateToolbar() {
  toolbar.hidden = ![...items].some((it) => it.status === 'done');
}
