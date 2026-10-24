import { url } from './paths';
import type { CatalogRequest, CatalogResult } from './catalog-worker';
let worker: Worker | undefined,
  sequence = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  number,
  {
    resolve: (result: CatalogResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function queryCatalog(request: CatalogRequest): Promise<CatalogResult> {
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL('./catalog-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve(data.result);
      if (!pending.size)
        idleTimer = setTimeout(() => {
          if (!pending.size) {
            worker?.terminate();
            worker = undefined;
          }
        }, 60000);
    };
    worker.onerror = () => {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('Не удалось загрузить поиск'));
      }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      if (!pending.size) {
        worker?.terminate();
        worker = undefined;
      }
      reject(new Error('Индекс ещё не загружен. Повторите поиск'));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({
      id,
      request,
      indexUrl: url('search-index.json'),
      base: import.meta.env.BASE_URL,
    });
  });
}
