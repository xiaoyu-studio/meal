import { toSnapshot, fromSnapshot } from './snapshot.js';

const DB_NAME = 'meal';
const DB_VERSION = 1;
const STORES = ['shops', 'dishes', 'events'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(req ? req.result : undefined);
      }),
  );
}

export function newId() {
  return crypto.randomUUID();
}

export async function loadAll() {
  const [shops, dishes, events] = await Promise.all(
    STORES.map((name) => run(name, 'readonly', (s) => s.getAll())),
  );
  return { shops, dishes, events };
}

export function putShop(shop) {
  return run('shops', 'readwrite', (s) => s.put(shop));
}

export function putDish(dish) {
  return run('dishes', 'readwrite', (s) => s.put(dish));
}

export function deleteDish(id) {
  return run('dishes', 'readwrite', (s) => s.delete(id));
}

/** 删店连带删掉它名下所有菜品，避免留下无法跳转的孤儿菜。 */
export async function deleteShop(id) {
  const { dishes } = await loadAll();
  for (const d of dishes.filter((d) => d.shopId === id)) {
    await deleteDish(d.id);
  }
  return run('shops', 'readwrite', (s) => s.delete(id));
}

export async function setHygiene(shopId, hygiene) {
  const { shops } = await loadAll();
  const shop = shops.find((s) => s.id === shopId);
  if (!shop) return;
  await putShop({ ...shop, hygiene });
}

export async function appendEvent({ slot, dishId, type, value = null }) {
  const event = { id: newId(), ts: Date.now(), slot, dishId, type, value };
  await run('events', 'readwrite', (s) => s.add(event));
  return event;
}

export async function exportSnapshot() {
  return toSnapshot(await loadAll(), Date.now());
}

/** 整库替换。先校验再清空，校验失败时旧数据分毫不动。 */
export async function importSnapshot(obj) {
  const data = fromSnapshot(obj);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of data[name]) store.put(row);
    }
  });
}
