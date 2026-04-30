import type { Layout, LayoutTab } from "./types";

const DB_NAME = "pstbg3shwavep-tab-cache";
const DB_VERSION = 1;
const TABS_META_STORE = "tabsMeta";
const TAB_LAYOUTS_STORE = "tabLayouts";

const EMPTY_LAYOUT: Layout = { unit: "in", tools: [] };

export type CachedTabMeta = {
  id: string;
  name: string;
  authorId?: string | null;
  canEdit?: boolean;
  hasLayout: boolean;
  clonedFromId?: string | null;
  clonedFromName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  layoutUpdatedAt?: string | null;
};

export type CachedTabLayout = {
  id: string;
  updatedAt?: string;
  layout: Layout;
};

export function toCachedTabMeta(tab: LayoutTab): CachedTabMeta {
  const hasLayout = tab.hasLayout !== false;

  return {
    id: tab.id,
    name: tab.name,
    ...(tab.authorId !== undefined ? { authorId: tab.authorId } : {}),
    ...(tab.canEdit !== undefined ? { canEdit: tab.canEdit } : {}),
    hasLayout,
    clonedFromId: tab.clonedFromId ?? null,
    clonedFromName: tab.clonedFromName ?? null,
    ...(tab.createdAt ? { createdAt: tab.createdAt } : {}),
    ...(tab.updatedAt ? { updatedAt: tab.updatedAt } : {}),
    layoutUpdatedAt: hasLayout ? tab.updatedAt ?? null : null,
  };
}

export function tabFromCachedMeta(meta: CachedTabMeta): LayoutTab {
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.authorId !== undefined ? { authorId: meta.authorId } : {}),
    ...(meta.canEdit !== undefined ? { canEdit: meta.canEdit } : {}),
    hasLayout: false,
    clonedFromId: meta.clonedFromId ?? null,
    clonedFromName: meta.clonedFromName ?? null,
    layout: EMPTY_LAYOUT,
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
  };
}

export function cachedLayoutForTab(tab: LayoutTab): CachedTabLayout | null {
  if (tab.hasLayout === false) return null;
  return {
    id: tab.id,
    ...(tab.updatedAt ? { updatedAt: tab.updatedAt } : {}),
    layout: tab.layout,
  };
}

export function isCachedLayoutFresh(
  metaOrTab: Pick<CachedTabMeta | LayoutTab, "updatedAt">,
  cachedLayout: CachedTabLayout | null,
): cachedLayout is CachedTabLayout {
  if (!cachedLayout) return false;
  return !metaOrTab.updatedAt || cachedLayout.updatedAt === metaOrTab.updatedAt;
}

export function applyCachedLayout(tab: LayoutTab, cachedLayout: CachedTabLayout | null): LayoutTab {
  if (!isCachedLayoutFresh(tab, cachedLayout)) return tab;

  return {
    ...tab,
    hasLayout: true,
    layout: cachedLayout.layout,
  };
}

export async function readCachedTabs(activeTabId: string | null): Promise<LayoutTab[]> {
  const db = await openTabCache();
  if (!db) return [];

  const metas = await getAll<CachedTabMeta>(db, TABS_META_STORE);
  const activeMeta = activeTabId ? metas.find((meta) => meta.id === activeTabId) ?? null : null;
  const activeLayout = activeMeta ? await readCachedLayout(activeMeta.id) : null;

  return metas.map((meta) => {
    const tab = tabFromCachedMeta(meta);
    if (meta.id !== activeMeta?.id || !isCachedLayoutFresh(meta, activeLayout)) return tab;
    return {
      ...tab,
      hasLayout: true,
      layout: activeLayout.layout,
    };
  });
}

export async function readCachedLayout(tabId: string): Promise<CachedTabLayout | null> {
  const db = await openTabCache();
  if (!db) return null;
  return await get<CachedTabLayout>(db, TAB_LAYOUTS_STORE, tabId);
}

export async function writeTabCacheSnapshot(tabs: LayoutTab[]): Promise<void> {
  const db = await openTabCache();
  if (!db) return;

  const nextIds = new Set(tabs.map((tab) => tab.id));
  const [metaKeys, layoutKeys] = await Promise.all([
    getAllKeys(db, TABS_META_STORE),
    getAllKeys(db, TAB_LAYOUTS_STORE),
  ]);
  const tx = db.transaction([TABS_META_STORE, TAB_LAYOUTS_STORE], "readwrite");
  const metaStore = tx.objectStore(TABS_META_STORE);
  const layoutStore = tx.objectStore(TAB_LAYOUTS_STORE);

  tabs.forEach((tab) => {
    metaStore.put(toCachedTabMeta(tab));
    const layout = cachedLayoutForTab(tab);
    if (layout) {
      layoutStore.put(layout);
    }
  });

  metaKeys.forEach((key) => {
    if (typeof key === "string" && !nextIds.has(key)) {
      metaStore.delete(key);
    }
  });
  layoutKeys.forEach((key) => {
    if (typeof key === "string" && !nextIds.has(key)) {
      layoutStore.delete(key);
    }
  });

  await transactionDone(tx);
}

export async function clearTabCache(): Promise<void> {
  const db = await openTabCache();
  if (!db) return;

  const tx = db.transaction([TABS_META_STORE, TAB_LAYOUTS_STORE], "readwrite");
  tx.objectStore(TABS_META_STORE).clear();
  tx.objectStore(TAB_LAYOUTS_STORE).clear();
  await transactionDone(tx);
}

function indexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function openTabCache(): Promise<IDBDatabase | null> {
  if (!indexedDbAvailable()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TABS_META_STORE)) {
        db.createObjectStore(TABS_META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(TAB_LAYOUTS_STORE)) {
        db.createObjectStore(TAB_LAYOUTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open tab cache"));
  });
}

function get<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName}`));
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName}`));
  });
}

function getAllKeys(db: IDBDatabase, storeName: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Unable to read ${storeName} keys`));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Tab cache transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Tab cache transaction aborted"));
  });
}
