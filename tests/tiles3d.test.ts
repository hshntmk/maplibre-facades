import { existsSync, readFileSync } from 'node:fs';
import createDecoderModule from 'draco3d/draco_decoder_nodejs.js';
import { describe, expect, it, vi } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { parseTileContent, usesDraco } from '../src/sources/tiles3d/content';
import { featuresFromTile } from '../src/sources/tiles3d/footprints';
import { getDracoModule } from '../src/sources/tiles3d/draco';
import { selectTiles, type CameraState } from '../src/sources/tiles3d/TileSelector';
import type { TileNode } from '../src/sources/tiles3d/Tileset';
import { mercatorX, mercatorY, meterInMercator } from '../src/math/mercator';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../src/style/presets';
import { RecordFactory, meshRecords, runBuildPipeline } from '../src/worker/buildPipeline';
import { TileStore } from '../src/worker/TileStore';

// ---------------------------------------------------------------- b3dm → フットプリント

const TILE = 'data/raw/13101_bldg_lod1/data/data6.b3dm';
const GEOJSON = 'examples/chiyoda/public/data/13101_bldg_lod1.geojson';

describe.runIf(existsSync(TILE) && existsSync(GEOJSON))('b3dm (PLATEAU 千代田区 LOD1)', () => {
  it('reconstructs the same footprints and attributes as the preprocessing script', async () => {
    const buf = new Uint8Array(readFileSync(TILE));
    expect(usesDraco(buf)).toBe(true);
    const wasmBinary = readFileSync('node_modules/draco3d/draco_decoder.wasm');
    const draco = await createDecoderModule({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
    const content = parseTileContent(buf, draco);
    const features = featuresFromTile(content);
    expect(features.length).toBe(content.batchLength);

    const fc = JSON.parse(readFileSync(GEOJSON, 'utf8')) as { features: { id: string; properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[] };
    const byId = new Map(fc.features.map((f) => [f.id, f]));
    const plateau = createAdapter({ name: 'plateau' });
    for (const f of features) {
      const id = f.properties.gml_id as string;
      const ref = byId.get(id);
      expect(ref, id).toBeDefined();
      // 外周の頂点数と位置が一致する（1cm 未満の差）
      const ring = f.geometry.polygons[0][0];
      const refRing = ref!.geometry.coordinates[0].slice(0, -1);
      expect(ring.length).toBe(refRing.length);
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const rx = refRing.reduce((s, p) => s + p[0], 0) / refRing.length;
      expect(Math.abs(cx - rx) * 91000).toBeLessThan(0.01);
      // ネストした attributes からも、GeoJSON と同じ共通モデルになる
      const a = plateau.toRecord(f.properties, f.geometry, { sourceId: 't' })!;
      const b = plateau.toRecord(ref!.properties, f.geometry, { sourceId: 't' })!;
      expect({ category: a.category, storeys: a.storeys, height: a.height, fire: a.fireResistance }).toEqual({
        category: b.category,
        storeys: b.storeys,
        height: b.height,
        fire: b.fireResistance,
      });
    }
  });
});

// ---------------------------------------------------------------- タイルの選択

const LNG = 139.76, LAT = 35.68;
const deg = (m: number) => m / 111000;

function node(id: string, sizeM: number, geometricError: number, children: TileNode[] = [], offsetM = 0): TileNode {
  const lng = LNG + deg(offsetM);
  return {
    id,
    depth: id.split('/').length - 1,
    contentUrl: `${id}.b3dm`,
    geometricError,
    refine: 'REPLACE',
    children,
    bounds: { west: lng - deg(sizeM / 2), east: lng + deg(sizeM / 2), south: LAT - deg(sizeM / 2), north: LAT + deg(sizeM / 2), minHeight: 0, maxHeight: 50 },
  };
}

/** 中心を真上から見下ろす正射影風の行列（クリップ空間 ±1 が ±halfM メートル） */
function camera(heightM: number, halfM = 2000): CameraState {
  const cx = mercatorX(LNG), cy = mercatorY(LAT), meter = meterInMercator(LAT);
  const k = 1 / (halfM * meter);
  // 列優先: clip = (merc - center) * k, w = 1
  const matrix = [k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k * 0.001, 0, -cx * k, cy * k, 0, 1];
  return { matrix, position: [cx, cy, heightM * meter], viewportHeight: 1000, fov: Math.PI / 4 };
}

describe('selectTiles', () => {
  const tree = () => node('root', 1000, 400, [node('a', 500, 0, [], -250), node('b', 500, 0, [], 250)]);

  it('uses the coarse tile when far away', () => {
    const sel = selectTiles(tree(), camera(200000), 16, () => true);
    expect(sel.render.map((n) => n.id)).toEqual(['root']);
  });

  it('refines to children when close, once they are loaded', () => {
    const sel = selectTiles(tree(), camera(300), 16, () => true);
    expect(sel.render.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(sel.load).toHaveLength(0);
  });

  it('keeps the parent until all visible children are ready, and requests them nearest first', () => {
    const ready = new Set(['root', 'a']);
    const sel = selectTiles(tree(), camera(300), 16, (n) => ready.has(n.id));
    expect(sel.render.map((n) => n.id)).toEqual(['root']);
    expect(sel.load.map((l) => l.node.id)).toEqual(['b']);
  });

  it('draws every visible tileset under a bundled (ADD) parent without content', () => {
    const ward = (id: string, offset: number) => node(id, 1000, 400, [node(`${id}/a`, 500, 0, [], offset - 250), node(`${id}/b`, 500, 0, [], offset + 250)], offset);
    const bundle: TileNode = { ...node('all', 4000, Number.POSITIVE_INFINITY, [ward('w1', -600), ward('w2', 600), ward('far', 40000)]), contentUrl: undefined, refine: 'ADD', depth: -1 };
    const far = selectTiles(bundle, camera(200000), 16, () => true);
    expect(far.render.map((n) => n.id).sort()).toEqual(['w1', 'w2']);
    const near = selectTiles(bundle, camera(300), 16, () => true);
    expect(near.render.map((n) => n.id).sort()).toEqual(['w1/a', 'w1/b', 'w2/a', 'w2/b']);
  });

  it('loads coarse tiles first, then nearer ones', () => {
    const t = node('root', 4000, 1e6, [node('root/near', 500, 1e6, [node('root/near/leaf', 200, 0, [], 0)], 0), node('root/far', 500, 1e6, [], 1500)]);
    const sel = selectTiles(t, camera(300), 16, () => false);
    expect(sel.load.map((l) => l.node.id)).toEqual(['root', 'root/near', 'root/far', 'root/near/leaf']);
  });

  it('reports waiting children and fallback parents as used, so they are not evicted', () => {
    const ready = new Set(['root', 'a']);
    const sel = selectTiles(tree(), camera(300), 16, (n) => ready.has(n.id));
    expect(sel.render.map((n) => n.id)).toEqual(['root']);
    expect(sel.used.map((n) => n.id).sort()).toEqual(['a', 'b', 'root']);
  });

  it('culls tiles outside the view', () => {
    const t = node('root', 1000, 400, [node('near', 400, 0, [], 0), node('far', 400, 0, [], 30000)]);
    const sel = selectTiles(t, camera(300), 16, () => true);
    expect(sel.render.map((n) => n.id)).toEqual(['near']);
  });
});

// ---------------------------------------------------------------- タイル境界をまたぐ壁面の判定

const LEAVES = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 14, 15, 16, 17].map((i) => `data/raw/13101_bldg_lod1/data/data${i}.b3dm`);

describe.runIf(LEAVES.every((f) => existsSync(f)) && existsSync(GEOJSON))('tile boundaries (千代田区 LOD1 の全詳細タイル)', () => {
  it('classifies walls across tile boundaries like the single-piece GeoJSON', async () => {
    const styleNames = Object.keys(PRESET_STYLES);
    const config = { adapter: { name: 'plateau' }, styleRules: DEFAULT_STYLE_RULES, styleNames };
    const wasmBinary = readFileSync('node_modules/draco3d/draco_decoder.wasm');
    const draco = await createDecoderModule({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
    const factory = new RecordFactory(config);
    const store = new TileStore();
    for (const [i, file] of LEAVES.entries()) {
      const features = featuresFromTile(parseTileContent(new Uint8Array(readFileSync(file)), draco));
      const { records, skipped } = await factory.build(features, file);
      store.set(String(i), records, skipped);
    }
    const sum = (withNeighbors: boolean) => {
      let party = 0, total = 0;
      for (let i = 0; i < LEAVES.length; i++) {
        const e = store.get(String(i))!;
        const { stats } = meshRecords(e.records, withNeighbors ? store.neighborsOf(String(i)) : [], config);
        party += stats.facades.party;
        total += stats.total;
      }
      return { party, total };
    };
    const tiled = sum(true);
    const isolated = sum(false);

    const fc = JSON.parse(readFileSync(GEOJSON, 'utf8')) as { features: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[] };
    const whole = await runBuildPipeline(
      fc.features.map((f) => ({ properties: f.properties, geometry: { kind: 'footprint' as const, polygons: [f.geometry.coordinates.map((r) => r.slice(0, -1) as [number, number][])] } })),
      config,
      'geojson',
    );
    console.log(`party walls: whole ${(whole.stats.facades.party / 1000).toFixed(1)} km / tiled ${(tiled.party / 1000).toFixed(1)} km / without neighbors ${(isolated.party / 1000).toFixed(1)} km`);
    // タイル側は細い三角形の除外と凸包での代用で、前処理スクリプト（GeoJSON）が取りこぼす建物も拾う
    expect(tiled.total).toBeGreaterThanOrEqual(whole.stats.total);
    expect(tiled.total - whole.stats.total).toBeLessThanOrEqual(whole.stats.total * 0.001);
    // 隣のタイルを見ないと境界の界壁を取りこぼす。見れば一括処理とほぼ同じになる
    expect(isolated.party).toBeLessThan(whole.stats.facades.party);
    expect(Math.abs(tiled.party - whole.stats.facades.party) / whole.stats.facades.party).toBeLessThan(0.005);
  }, 120000);
});

// ---------------------------------------------------------------- Draco の wasm

describe('getDracoModule', () => {
  it('reports a non-wasm response as a source error and retries next time', async () => {
    const wasm = readFileSync('node_modules/draco3d/draco_decoder.wasm');
    const responses = [new Response('<!doctype html>'), new Response(wasm)];
    vi.stubGlobal('fetch', async () => responses.shift()!);
    try {
      const err = await getDracoModule('https://example.com/draco_decoder.wasm').catch((e) => e);
      expect(err).toMatchObject({ code: 'source' });
      expect(err.message).toContain('not a WebAssembly file');
      await expect(getDracoModule('https://example.com/draco_decoder.wasm')).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
