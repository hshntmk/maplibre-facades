import type { SourceFeature } from '../sources/SourceConfig';

// 3D Tiles のタイルを展開した結果（フットプリントと生の属性）を IndexedDB に保存し、次からはダウンロードと展開を省く。
// アダプタやスタイルを通す前の値を保存するので、設定を変えても使える。
// 保存の形式は JSON を gzip したもの（CompressionStream がない環境では JSON の文字列のまま）。
// 合計の大きさと保存してからの日数に上限を持ち、超えたら最後に使った時刻が古いものから捨てる。

/** 保存の形式の版。フットプリントの復元方法や保存の形式を変えたら上げる（古い版のものは使わずに捨てる） */
export const TILE_CACHE_FORMAT = 1;
export const TILE_CACHE_DB = 'maplibre-facades';
const DATA_STORE = 'tileData';
const META_STORE = 'tileMeta';

export interface TileCacheMeta {
  key: string;
  /** 保存した大きさ（バイト） */
  size: number;
  /** 保存した時刻 (ms) */
  storedAt: number;
  /** 最後に使った時刻 (ms) */
  lastUsed: number;
}

/** 保存先。ブラウザでは IndexedDB、テストではメモリ */
export interface TileCacheBackend {
  getMeta(key: string): Promise<TileCacheMeta | undefined>;
  getData(key: string): Promise<ArrayBuffer | string | undefined>;
  put(meta: TileCacheMeta, data: ArrayBuffer | string): Promise<void>;
  touch(key: string, lastUsed: number): Promise<void>;
  delete(keys: string[]): Promise<void>;
  listMeta(): Promise<TileCacheMeta[]>;
  clear(): Promise<void>;
}

export interface TileCacheLimits {
  /** 合計の大きさの上限（バイト） */
  maxBytes: number;
  /** 保存してから使える期間 (ms) */
  maxAgeMs: number;
}

const prefix = `v${TILE_CACHE_FORMAT}|`;

export class TileCache {
  constructor(
    private readonly backend: TileCacheBackend,
    private readonly limits: TileCacheLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** タイルの URL と座標変換（同じ URL でも変換が違えば別のフットプリントになる）からキーを作る */
  static key(url: string, transform?: readonly number[]): string {
    return `${prefix}${url}|${transform ? transform.join(',') : ''}`;
  }

  /** 保存してあれば展開した結果を返す。なければ（期限切れ・読めない場合も）undefined */
  async get(key: string): Promise<SourceFeature[] | undefined> {
    try {
      const meta = await this.backend.getMeta(key);
      if (!meta) return undefined;
      const now = this.now();
      if (now - meta.storedAt > this.limits.maxAgeMs) {
        await this.backend.delete([key]);
        return undefined;
      }
      const data = await this.backend.getData(key);
      if (data === undefined) {
        await this.backend.delete([key]);
        return undefined;
      }
      const features = await decodeFeatures(data);
      this.backend.touch(key, now).catch(() => {});
      return features;
    } catch {
      return undefined;
    }
  }

  /** 保存して、上限を超えた分を捨てる。失敗しても（容量不足など）表示には影響しないので、エラーは出さない */
  async put(key: string, features: SourceFeature[]): Promise<void> {
    try {
      const data = await encodeFeatures(features);
      const size = typeof data === 'string' ? data.length * 2 : data.byteLength;
      if (size > this.limits.maxBytes) return;
      const now = this.now();
      await this.backend.put({ key, size, storedAt: now, lastUsed: now }, data);
      await this.evict();
    } catch {
      // 保存できなくても次回ダウンロードするだけ
    }
  }

  /** 古い形式・期限切れのものを捨て、合計が上限を超えていれば最後に使った時刻が古いものから捨てる */
  async evict(): Promise<void> {
    const now = this.now();
    const all = await this.backend.listMeta();
    const remove: string[] = [];
    const keep: TileCacheMeta[] = [];
    for (const m of all) {
      if (!m.key.startsWith(prefix) || now - m.storedAt > this.limits.maxAgeMs) remove.push(m.key);
      else keep.push(m);
    }
    keep.sort((a, b) => a.lastUsed - b.lastUsed);
    let total = keep.reduce((sum, m) => sum + m.size, 0);
    for (const m of keep) {
      if (total <= this.limits.maxBytes) break;
      remove.push(m.key);
      total -= m.size;
    }
    if (remove.length) await this.backend.delete(remove);
  }
}

export async function encodeFeatures(features: SourceFeature[]): Promise<ArrayBuffer | string> {
  const json = JSON.stringify(features);
  if (typeof CompressionStream === 'undefined') return json;
  return new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

export async function decodeFeatures(data: ArrayBuffer | string): Promise<SourceFeature[]> {
  if (typeof data === 'string') return JSON.parse(data) as SourceFeature[];
  const text = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text) as SourceFeature[];
}

// ---------------------------------------------------------------- IndexedDB

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** IndexedDB の保存先。メインスレッドと Worker のどちらでも使える */
export class IdbTileCacheBackend implements TileCacheBackend {
  private db?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(TILE_CACHE_DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      r.onsuccess = () => {
        const db = r.result;
        // 別のタブなどが DB を作り直すときは閉じて譲る（次に使うときに開き直す）
        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
    this.db.catch(() => (this.db = undefined));
    return this.db;
  }

  async getMeta(key: string): Promise<TileCacheMeta | undefined> {
    const db = await this.open();
    return request<TileCacheMeta | undefined>(db.transaction(META_STORE).objectStore(META_STORE).get(key));
  }

  async getData(key: string): Promise<ArrayBuffer | string | undefined> {
    const db = await this.open();
    return request<ArrayBuffer | string | undefined>(db.transaction(DATA_STORE).objectStore(DATA_STORE).get(key));
  }

  async put(meta: TileCacheMeta, data: ArrayBuffer | string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DATA_STORE, META_STORE], 'readwrite');
    tx.objectStore(DATA_STORE).put(data, meta.key);
    tx.objectStore(META_STORE).put(meta);
    await done(tx);
  }

  async touch(key: string, lastUsed: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const meta = await request<TileCacheMeta | undefined>(store.get(key));
    if (meta) store.put({ ...meta, lastUsed });
    await done(tx);
  }

  async delete(keys: string[]): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DATA_STORE, META_STORE], 'readwrite');
    for (const key of keys) {
      tx.objectStore(DATA_STORE).delete(key);
      tx.objectStore(META_STORE).delete(key);
    }
    await done(tx);
  }

  async listMeta(): Promise<TileCacheMeta[]> {
    const db = await this.open();
    return request<TileCacheMeta[]>(db.transaction(META_STORE).objectStore(META_STORE).getAll());
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DATA_STORE, META_STORE], 'readwrite');
    tx.objectStore(DATA_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await done(tx);
  }

  async close(): Promise<void> {
    const db = await this.db?.catch(() => undefined);
    db?.close();
    this.db = undefined;
  }
}

/** IndexedDB が使えなければ undefined（プライベートブラウズの一部・古い環境など） */
export function createTileCache(limits: TileCacheLimits): TileCache | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  return new TileCache(new IdbTileCacheBackend(), limits);
}

/** 保存したタイルをすべて消す（メインスレッドから呼べる）。IndexedDB が使えなければ何もしない */
export async function clearTileCache(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const backend = new IdbTileCacheBackend();
  try {
    await backend.clear();
  } finally {
    await backend.close();
  }
}

/** 保存しているタイルの数と合計の大きさ（バイト） */
export async function tileCacheUsage(): Promise<{ tiles: number; bytes: number }> {
  if (typeof indexedDB === 'undefined') return { tiles: 0, bytes: 0 };
  const backend = new IdbTileCacheBackend();
  try {
    const metas = await backend.listMeta();
    return { tiles: metas.length, bytes: metas.reduce((sum, m) => sum + m.size, 0) };
  } finally {
    await backend.close();
  }
}
