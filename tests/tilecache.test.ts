import { describe, expect, it } from 'vitest';
import type { SourceFeature } from '../src/sources/SourceConfig';
import { resolveTileCacheOptions } from '../src/sources/SourceConfig';
import { TileCache, decodeFeatures, encodeFeatures, type TileCacheBackend, type TileCacheMeta } from '../src/worker/TileCache';
import { validateLayerOptions } from '../src/layer/validateOptions';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../src/style/presets';

/** テスト用のメモリ上の保存先 */
class MemoryBackend implements TileCacheBackend {
  meta = new Map<string, TileCacheMeta>();
  data = new Map<string, ArrayBuffer | string>();
  async getMeta(key: string) { return this.meta.get(key); }
  async getData(key: string) { return this.data.get(key); }
  async put(meta: TileCacheMeta, data: ArrayBuffer | string) { this.meta.set(meta.key, meta); this.data.set(meta.key, data); }
  async touch(key: string, lastUsed: number) { const m = this.meta.get(key); if (m) this.meta.set(key, { ...m, lastUsed }); }
  async delete(keys: string[]) { for (const k of keys) { this.meta.delete(k); this.data.delete(k); } }
  async listMeta() { return [...this.meta.values()]; }
  async clear() { this.meta.clear(); this.data.clear(); }
}

const feature = (id: string, n = 4): SourceFeature => ({
  properties: { 'gml:id': id, 'bldg:measuredHeight': 31.5, attributes: JSON.stringify({ 'bldg:usage': '業務施設' }), flag: true, none: null },
  geometry: { kind: 'footprint', polygons: [[Array.from({ length: n }, (_, i) => [139.7 + i * 1e-5, 35.68 + ((i * 7) % 3) * 1e-5] as [number, number])]] },
});

const DAY = 86400000;

describe('TileCache', () => {
  it('round-trips features through gzip without losing precision', async () => {
    const features = [feature('a'), feature('b', 12)];
    const data = await encodeFeatures(features);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(await decodeFeatures(data)).toEqual(features);
  });

  it('separates keys by format version, URL and transform', () => {
    expect(TileCache.key('https://x/a.b3dm')).toBe('v1|https://x/a.b3dm|');
    expect(TileCache.key('https://x/a.b3dm', [1, 0, 0, 1])).not.toBe(TileCache.key('https://x/a.b3dm'));
  });

  it('returns stored tiles and misses unknown or expired ones', async () => {
    let now = 1000;
    const backend = new MemoryBackend();
    const cache = new TileCache(backend, { maxBytes: 1e9, maxAgeMs: 30 * DAY }, () => now);
    const key = TileCache.key('https://x/a.b3dm');
    expect(await cache.get(key)).toBeUndefined();
    await cache.put(key, [feature('a')]);
    expect(await cache.get(key)).toEqual([feature('a')]);
    now += 31 * DAY;
    expect(await cache.get(key)).toBeUndefined();
    expect(backend.meta.size).toBe(0); // 期限切れは捨てる
  });

  it('evicts least recently used tiles over the size limit, and old formats', async () => {
    let now = 0;
    const backend = new MemoryBackend();
    await backend.put({ key: 'v0|old|', size: 10, storedAt: 0, lastUsed: 0 }, 'x');
    const probe = await encodeFeatures([feature('a', 40)]);
    const size = (probe as ArrayBuffer).byteLength;
    const cache = new TileCache(backend, { maxBytes: size * 2.5, maxAgeMs: 30 * DAY }, () => now);
    const keys = ['a', 'b', 'c'].map((u) => TileCache.key(u));
    now = 1; await cache.put(keys[0], [feature('a', 40)]);
    now = 2; await cache.put(keys[1], [feature('a', 40)]);
    now = 3; await cache.get(keys[0]); // a を最近使った
    await new Promise((r) => setTimeout(r, 0)); // touch は応答を待たない
    now = 4; await cache.put(keys[2], [feature('a', 40)]);
    expect([...backend.meta.keys()].sort()).toEqual([keys[0], keys[2]].sort()); // b が捨てられ、古い形式も消える
  });

  it('never throws when the backend fails', async () => {
    const broken: TileCacheBackend = new Proxy(new MemoryBackend(), { get: () => async () => { throw new Error('quota'); } });
    const cache = new TileCache(broken, { maxBytes: 1e9, maxAgeMs: DAY });
    await expect(cache.put('k', [feature('a')])).resolves.toBeUndefined();
    await expect(cache.get('k')).resolves.toBeUndefined();
  });
});

describe('cache options', () => {
  it('defaults to enabled and can be turned off', () => {
    expect(resolveTileCacheOptions(undefined)).toEqual({ enabled: true, maxSizeMB: 200, maxAgeDays: 2 });
    expect(resolveTileCacheOptions(false)).toBeUndefined();
    expect(resolveTileCacheOptions({ maxSizeMB: 50 })).toEqual({ enabled: true, maxSizeMB: 50, maxAgeDays: 2 });
    expect(resolveTileCacheOptions({ enabled: false })).toBeUndefined();
  });

  it('validates source.cache', () => {
    const base = { id: 'x', styles: PRESET_STYLES, styleRules: DEFAULT_STYLE_RULES };
    const source = (cache: unknown) => ({ ...base, source: { type: '3dtiles', url: 'https://x/tileset.json', cache } });
    expect(() => validateLayerOptions(source(true))).not.toThrow();
    expect(() => validateLayerOptions(source({ maxSizeMB: 100, maxAgeDays: 7 }))).not.toThrow();
    expect(() => validateLayerOptions(source('yes'))).toThrow(/source.cache/);
    expect(() => validateLayerOptions(source({ maxSizeMB: 0 }))).toThrow(/maxSizeMB/);
  });
});
