import { toSnapshot, fromSnapshot } from './snapshot.js';

const DB_NAME = 'meal';
const DB_VERSION = 1;
const STORES = ['shops', 'dishes', 'events'];

let dbPromise = null;

/**
 * 注意：这里没有 onblocked 处理器。DB_VERSION 恒为 1 时不会触发它 ——
 * 但**任何一次 DB_VERSION 升版前必须先补上**：只要还有一个旧标签页开着
 * 这个库，open() 就会一直 blocked 且没有超时，Promise 永远不落地，
 * 页面停在空白卡片上。届时至少要 reject 一个中文错误提示用户关掉其他标签页。
 */
function openDB() {
  // ⚠️⚠️⚠️ 临时验收补丁 —— 真机验收清单第 14 条（存储失败回退界面）专用。
  // 验收完成后必须 `git revert` 掉这一条 commit。留在线上等于整个 app 不可用。
  // 每次调用都返回一个全新的 rejected promise，不写 dbPromise —— 这样「重试」
  // 按钮会重新走一遍加载并再次失败，正好验证它确实重新发起了请求。
  // （不能在 Promise 构造器里 reject 并顺手把 dbPromise 置 null：执行器是
  // 同步跑的，跑完之后外层那次赋值才落地，会把 null 又覆盖回去。）
  return Promise.reject(new Error('本地存储不可用（验收用的人为故障）'));

  // eslint-disable-next-line no-unreachable
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
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
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
        // abort 不一定伴随请求错误：WebKit 会在页面被挂起（切到别的 App）时
        // 直接中断进行中的事务。不接这个事件，Promise 就永远悬着 ——
        // loadAll() 不返回、render() 的 catch 不执行、失败态和重试按钮都不出现。
        tx.onabort = () => reject(tx.error ?? new Error('事务被中断'));
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

/**
 * targetTs 是可选的回指：反馈事件（rated / paid / sick）用它指明自己评的是
 * 哪一条观察值。不传就不写这个字段 —— 旧事件与导入的快照没有它，归约那边
 * 会退回启发式，因此不需要任何迁移。
 */
export async function appendEvent({ slot, dishId, type, value = null, targetTs = null }) {
  const event = { id: newId(), ts: Date.now(), slot, dishId, type, value };
  if (targetTs != null) event.targetTs = targetTs;
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
    // 同 run()：页面挂起导致的 abort 必须让 Promise 落地。
    // 下面 catch 里那次主动 tx.abort() 会先 reject 真正的错误，
    // 之后这个处理器再触发也只是对已 settle 的 Promise 的空操作。
    tx.onabort = () => reject(tx.error ?? new Error('导入失败：事务被中断'));
    tx.oncomplete = () => resolve();
    try {
      for (const name of STORES) {
        const store = tx.objectStore(name);
        store.clear();
        for (const row of data[name]) store.put(row);
      }
    } catch (err) {
      // 先 reject 再 abort：无论 abort 事件何时派发，用户看到的都是
      // 真正的原因，而不是笼统的「事务被中断」。
      reject(err);
      tx.abort();
    }
  });
}
