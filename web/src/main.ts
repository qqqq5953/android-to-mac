import { uploadFile } from './upload';
import './style.css';

type Status = 'waiting' | 'uploading' | 'done' | 'error';

interface Item {
  file: File;
  status: Status;
  el: HTMLLIElement;
}

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

const title = $<HTMLHeadingElement>('#title');
const picker = $<HTMLInputElement>('#picker');
const toolbar = $<HTMLDivElement>('#toolbar');
const list = $<HTMLUListElement>('#list');
const template = $<HTMLTemplateElement>('#item-template');

const items = new Set<Item>();
const queue: Item[] = [];
let running = false;

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
  item.el.remove();
  updateToolbar();
}

/** 一次傳一個，避免手機同時開太多連線 */
async function enqueue(item: Item) {
  render(item, 'waiting', 0);
  queue.push(item);
  if (running) return;
  running = true;
  while (queue.length) {
    const next = queue.shift()!;
    if (!items.has(next)) continue;
    render(next, 'uploading', 0);
    try {
      await uploadFile(next.file, (ratio) => render(next, 'uploading', ratio));
      render(next, 'done', 1);
    } catch (err) {
      render(next, 'error', 0, (err as Error).message);
    }
  }
  running = false;
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
