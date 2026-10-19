import { existsSync, readFileSync } from 'node:fs';
import createDecoderModule from 'draco3d/draco_decoder_nodejs.js';
import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { parseTileContent, tileFormat, usesDraco } from '../src/sources/tiles3d/content';
import { ecefToGeodetic, extractFootprint, featuresFromTile } from '../src/sources/tiles3d/footprints';

// 3D Tiles 1.1 の glb タイル（EXT_mesh_features + EXT_structural_metadata）

// ---------------------------------------------------------------- 合成した glb

const A = 6378137, E2 = 6.69437999014e-3;
function geodeticToEcef(lon: number, lat: number, h: number): [number, number, number] {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * Math.sin(p)];
}

/** 経緯度の矩形を底面とする箱（三角形 12 枚） */
function box(lon: number, lat: number, size: number, height: number): [number, number, number][][] {
  const d = size / 111000;
  const c = [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d]];
  const lo = c.map(([x, y]) => geodeticToEcef(x, y, 0)), hi = c.map(([x, y]) => geodeticToEcef(x, y, height));
  const tris: [number, number, number][][] = [[hi[0], hi[1], hi[2]], [hi[0], hi[2], hi[3]], [lo[0], lo[2], lo[1]], [lo[0], lo[3], lo[2]]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]]);
  }
  return tris;
}

/** glb を組み立てる。bufferViews は 8 バイト境界にそろえて BIN に詰める */
function buildGlb(json: Record<string, unknown>, views: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const bufferViews = views.map((v) => {
    const pad = (8 - (offset % 8)) % 8;
    if (pad) parts.push(new Uint8Array(pad));
    offset += pad;
    parts.push(v);
    const view = { buffer: 0, byteOffset: offset, byteLength: v.byteLength };
    offset += v.byteLength;
    return view;
  });
  const binLength = Math.ceil(offset / 4) * 4;
  const bin = new Uint8Array(binLength);
  let o = 0;
  for (const p of parts) {
    bin.set(p, o);
    o += p.byteLength;
  }
  const text = new TextEncoder().encode(JSON.stringify({ ...json, bufferViews, buffers: [{ byteLength: binLength }] }));
  const jsonBytes = new Uint8Array(Math.ceil(text.byteLength / 4) * 4).fill(0x20);
  jsonBytes.set(text);
  const out = new Uint8Array(12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  dv.setUint32(20 + jsonBytes.byteLength, bin.byteLength, true);
  dv.setUint32(24 + jsonBytes.byteLength, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.byteLength);
  return out;
}

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const strings = (list: string[]) => {
  const enc = list.map((s) => new TextEncoder().encode(s));
  const offsets = new Uint32Array(list.length + 1);
  enc.forEach((e, i) => (offsets[i + 1] = offsets[i] + e.byteLength));
  const values = new Uint8Array(offsets[list.length]);
  enc.forEach((e, i) => values.set(e, offsets[i]));
  return { values, offsets: bytes(offsets) };
};

/** 建物 2 棟（6m 角・高さ 10m と 8m 角・高さ 20m）。2 棟目は 3 棟目（建物でない頂点 = nullFeatureId）の三角形を含む */
function syntheticTile(): Uint8Array {
  const center = geodeticToEcef(139.78, 35.71, 0);
  // glTF の Y-up に戻した中心を node.translation に置く: ECEF (x, y, z) = glTF (x, -z, y)
  const translation = [center[0], center[2], -center[1]];
  const buildings = [box(139.78, 35.71, 6, 10), box(139.7803, 35.71, 8, 20)];
  const stray = [[geodeticToEcef(139.7801, 35.7102, 0), geodeticToEcef(139.7802, 35.7102, 0), geodeticToEcef(139.7801, 35.7103, 0)]];
  const positions: number[] = [], ids: number[] = [];
  const add = (tris: [number, number, number][][], id: number) => {
    for (const t of tris) for (const [x, y, z] of t) {
      positions.push(x - center[0], z - center[2], -(y - center[1]));
      ids.push(id);
    }
  };
  buildings.forEach((b, i) => add(b, i));
  add(stray as [number, number, number][][], 65535);
  const n = ids.length;
  const gml = strings(['bldg_a', 'bldg_b']);
  const usage = strings(['共同住宅', '￿']);
  const views = [
    bytes(new Float32Array(positions)), // 0
    bytes(new Uint16Array(ids)), // 1
    bytes(Uint32Array.from({ length: n }, (_, i) => i)), // 2
    gml.values, gml.offsets, // 3, 4
    usage.values, usage.offsets, // 5, 6
    bytes(new Int8Array([5, -128])), // 7: storeys（2 棟目は noData）
    bytes(new Float64Array([10.2, 19.8])), // 8: measuredHeight
    new Uint8Array([0b10]), // 9: BOOLEAN
    bytes(new Uint16Array([1, 0])), // 10: ENUM
  ];
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_mesh_features', 'EXT_structural_metadata'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, _FEATURE_ID_0: 1 }, indices: 2, extensions: { EXT_mesh_features: { featureIds: [{ featureCount: 2, attribute: 0, propertyTable: 0, nullFeatureId: 65535 }] } } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: n, type: 'SCALAR' },
      { bufferView: 2, componentType: 5125, count: n, type: 'SCALAR' },
    ],
    extensions: {
      EXT_structural_metadata: {
        schema: {
          id: 'test',
          enums: { Kind: { valueType: 'UINT16', values: [{ name: 'low', value: 0 }, { name: 'high', value: 1 }] } },
          classes: {
            building: {
              properties: {
                gml_id: { type: 'STRING' },
                'bldg:usage': { type: 'STRING', noData: '￿' },
                'bldg:storeysAboveGround': { type: 'SCALAR', componentType: 'INT8', noData: -128 },
                'bldg:measuredHeight': { type: 'SCALAR', componentType: 'FLOAT64' },
                flag: { type: 'BOOLEAN' },
                kind: { type: 'ENUM', enumType: 'Kind' },
              },
            },
          },
        },
        propertyTables: [
          {
            class: 'building',
            count: 2,
            properties: {
              gml_id: { values: 3, stringOffsets: 4 },
              'bldg:usage': { values: 5, stringOffsets: 6 },
              'bldg:storeysAboveGround': { values: 7 },
              'bldg:measuredHeight': { values: 8 },
              flag: { values: 9 },
              kind: { values: 10 },
            },
          },
        ],
      },
    },
  };
  return buildGlb(json, views);
}

describe('glb tiles (3D Tiles 1.1)', () => {
  it('reads EXT_structural_metadata property tables', () => {
    const buf = syntheticTile();
    expect(tileFormat(buf)).toBe('glb');
    expect(usesDraco(buf)).toBe(false);
    const c = parseTileContent(buf, undefined);
    expect(c.batchLength).toBe(2);
    expect(c.batchTable.gml_id).toEqual(['bldg_a', 'bldg_b']);
    expect(c.batchTable['bldg:usage']).toEqual(['共同住宅', null]);
    expect(c.batchTable['bldg:storeysAboveGround']).toEqual([5, null]);
    expect(c.batchTable['bldg:measuredHeight']).toEqual([10.2, 19.8]);
    expect(c.batchTable.flag).toEqual([false, true]);
    expect(c.batchTable.kind).toEqual(['high', 'low']);
  });

  it('places vertices in ECEF via node.translation and drops null features', () => {
    const c = parseTileContent(syntheticTile(), undefined);
    const m = c.meshes[0];
    // 建物でない三角形（nullFeatureId）は捨てる: 2 棟 × 12 枚
    expect(m.indices.length / 3).toBe(24);
    const [lon, lat, h] = ecefToGeodetic(m.positions[0], m.positions[1], m.positions[2]);
    expect(lon).toBeCloseTo(139.78, 5);
    expect(lat).toBeCloseTo(35.71, 5);
    expect(Math.abs(h - 10)).toBeLessThan(0.01);

    const features = featuresFromTile(c);
    expect(features.map((f) => f.properties.gml_id)).toEqual(['bldg_a', 'bldg_b']);
    expect(features[0].geometry.polygons[0][0]).toHaveLength(4);
    const record = createAdapter({ name: 'plateau' }).toRecord(features[0].properties, features[0].geometry, { sourceId: 't' })!;
    expect(record.category).toBe('apartment');
    expect(record.storeys).toBe(5);
  });

  it('rejects unknown tile formats', () => {
    expect(() => tileFormat(new TextEncoder().encode('pnts....'))).toThrow(/unsupported tile content/);
  });
});

// ---------------------------------------------------------------- フットプリント: 量子化で反転した細い三角形

describe('extractFootprint with quantized roofs', () => {
  it('ignores near-collinear slivers whose orientation flipped', () => {
    // 屋根 = 五角形。頂点 0 は辺 A-B のほぼ上にあり、細い三角形 (0, A, B) の向きが量子化で反転している
    const lon0 = 139.78, lat0 = 35.71;
    const m = (x: number, y: number, z: number): [number, number, number] => [lon0 + x / 90400, lat0 + y / 110940, z];
    const P0 = m(0, 0, 10), A = m(1.32, -1.72, 10), B = m(-4.9, 6.37, 10), C = m(5.69, 1.67, 10), D = m(-0.59, 9.74, 10);
    const ground = [m(0, 0, 0), m(1.32, -1.72, 0)];
    const geo = [P0, A, B, C, D, ...ground];
    // (0, A, B) は面積ほぼ 0 で、上から見て時計回り（反転）
    const tris = [0, 1, 2, 1, 3, 2, 3, 4, 2, 5, 6, 1];
    const fp = extractFootprint(tris, geo);
    expect(fp).not.toBeNull();
    expect(fp!.polygons).toHaveLength(1);
    expect(fp!.polygons[0][0].length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------- 実データ（台東区 2025、Draco 圧縮）

const TAITO = 'data/raw/13106/18/232844/39517_bldg_Building.glb';

describe.runIf(existsSync(TAITO))('glb (PLATEAU 台東区 LOD1)', () => {
  it('reconstructs every building with its attributes', async () => {
    const buf = new Uint8Array(readFileSync(TAITO));
    expect(usesDraco(buf)).toBe(true);
    const wasmBinary = readFileSync('node_modules/draco3d/draco_decoder.wasm');
    const draco = await createDecoderModule({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
    const c = parseTileContent(buf, draco);
    const features = featuresFromTile(c);
    expect(features).toHaveLength(c.batchLength);
    const plateau = createAdapter({ name: 'plateau' });
    const records = features.map((f) => plateau.toRecord(f.properties, f.geometry, { sourceId: 't' })!);
    expect(records.every((r) => r && r.height > 0)).toBe(true);
    expect(records.filter((r) => r.category === 'apartment').length).toBeGreaterThan(0);
    // 台東区（東経 139.76〜139.81、北緯 35.69〜35.74）の中にある
    const [lon, lat] = features[0].geometry.polygons[0][0][0];
    expect(lon).toBeGreaterThan(139.76);
    expect(lon).toBeLessThan(139.81);
    expect(lat).toBeGreaterThan(35.69);
    expect(lat).toBeLessThan(35.74);
  });
});
