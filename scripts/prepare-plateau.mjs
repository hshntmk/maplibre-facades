#!/usr/bin/env node
// PLATEAU 建築物モデル（LOD1 3D Tiles / b3dm）から、フットプリント＋属性の GeoJSON を作る前処理。
//
//   node scripts/prepare-plateau.mjs [datasetId] [--out <dir>]
//     datasetId 既定: 13101_bldg_lod1（千代田区）/ 出力先の既定: examples/chiyoda/public/data
//
// - データセットの URL は PLATEAU データカタログ API から解決する（他都市にもそのまま使える）
// - 取得した b3dm は data/raw/<datasetId>/ にキャッシュする
// - 出力: <dir>/<datasetId>.geojson（属性名は PLATEAU 3D Tiles のフラット化された名前のまま。
//   正規化はライブラリ側の PlateauAdapter の責務）

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import draco3d from 'draco3dgltf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_URL = 'https://api.plateau.reearth.io/datacatalog/plateau-datasets';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'examples/chiyoda/public/data');
const datasetId = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1) ?? '13101_bldg_lod1';
const rawDir = path.join(ROOT, 'data/raw', datasetId);
const outFile = path.join(outDir, `${datasetId}.geojson`);

// 出力する属性（3D Tiles のバッチテーブル上の名前）
const KEEP_TOP_LEVEL = [
  'gml_id',
  'gml:name',
  'bldg:class',
  'bldg:usage',
  'bldg:measuredHeight',
  'bldg:storeysAboveGround',
  'bldg:storeysBelowGround',
  'bldg:address',
  'uro:BuildingDetailAttribute_uro:fireproofStructureType',
  'uro:BuildingDetailAttribute_uro:buildingRoofEdgeArea',
  'uro:BuildingDetailAttribute_uro:surveyYear',
  '_zmin',
  '_zmax',
];

// ---------------------------------------------------------------- fetch helpers

async function fetchCached(url, file) {
  try {
    return await fs.readFile(file);
  } catch {
    process.stdout.write(`  download ${path.basename(file)} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
    return buf;
  }
}

async function resolveDataset(id) {
  const buf = await fetchCached(CATALOG_URL, path.join(ROOT, 'data/raw/catalog.json'));
  const ds = JSON.parse(buf.toString('utf8')).datasets.find((d) => d.id === id);
  if (!ds) throw new Error(`dataset ${id} not found in PLATEAU catalog`);
  if (ds.format !== '3D Tiles' || ds.type_en !== 'bldg') {
    throw new Error(`dataset ${id} is ${ds.type_en}/${ds.format}; expected bldg/3D Tiles`);
  }
  return ds;
}

function leafContents(node, acc = []) {
  const children = node.children ?? [];
  // refine: REPLACE なので、葉タイルだけで全建物がそろう
  if (children.length === 0 && node.content) acc.push(node.content.uri ?? node.content.url);
  for (const c of children) leafContents(c, acc);
  return acc;
}

// ---------------------------------------------------------------- b3dm parsing

function readBatchTable(json, bin, length) {
  const table = {};
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      table[key] = value;
    } else if (value && typeof value === 'object' && 'byteOffset' in value) {
      const Ctor = {
        DOUBLE: Float64Array, FLOAT: Float32Array, INT: Int32Array, UNSIGNED_INT: Uint32Array,
        SHORT: Int16Array, UNSIGNED_SHORT: Uint16Array, BYTE: Int8Array, UNSIGNED_BYTE: Uint8Array,
      }[value.componentType];
      const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[value.type ?? 'SCALAR'];
      // アラインメントをそろえるため、新しい ArrayBuffer にコピーしてから型付き配列を作る
      const copy = new Uint8Array(bin.subarray(value.byteOffset, value.byteOffset + length * comps * Ctor.BYTES_PER_ELEMENT));
      table[key] = Array.from(new Ctor(copy.buffer, 0, length * comps));
    }
  }
  return table;
}

function parseB3dm(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'b3dm') throw new Error('not b3dm');
  const ftJson = dv.getUint32(12, true);
  const ftBin = dv.getUint32(16, true);
  const btJson = dv.getUint32(20, true);
  const btBin = dv.getUint32(24, true);
  let o = 28;
  const featureTable = JSON.parse(buf.toString('utf8', o, o + ftJson));
  o += ftJson + ftBin;
  const batchJson = btJson ? JSON.parse(buf.toString('utf8', o, o + btJson)) : {};
  o += btJson;
  const batchBin = buf.subarray(o, o + btBin);
  o += btBin;
  const length = featureTable.BATCH_LENGTH;
  return { length, batchTable: readBatchTable(batchJson, batchBin, length), glb: buf.subarray(o) };
}

function parseGlb(glb) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  let o = 12;
  let json;
  let bin;
  while (o < glb.byteLength) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const chunk = glb.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  return { json, bin };
}

let dracoModule;
async function decodeDraco(bytes, attrIds) {
  dracoModule ??= await draco3d.createDecoderModule({});
  const m = dracoModule;
  const decoder = new m.Decoder();
  const buffer = new m.DecoderBuffer();
  buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
  const mesh = new m.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  if (!status.ok()) throw new Error(`draco: ${status.error_msg()}`);

  const readAttr = (uniqueId) => {
    const attr = decoder.GetAttributeByUniqueId(mesh, uniqueId);
    const comps = attr.num_components();
    const n = mesh.num_points() * comps;
    const ptr = m._malloc(n * 4);
    decoder.GetAttributeDataArrayForAllPoints(mesh, attr, m.DT_FLOAT32, n * 4, ptr);
    const out = new Float32Array(m.HEAPF32.buffer, ptr, n).slice();
    m._free(ptr);
    return out;
  };
  const numIdx = mesh.num_faces() * 3;
  const ptr = m._malloc(numIdx * 4);
  decoder.GetTrianglesUInt32Array(mesh, numIdx * 4, ptr);
  const indices = new Uint32Array(m.HEAPU32.buffer, ptr, numIdx).slice();
  m._free(ptr);

  const result = { indices, position: readAttr(attrIds.POSITION), batchId: readAttr(attrIds._BATCHID) };
  m.destroy(mesh);
  m.destroy(buffer);
  m.destroy(decoder);
  return result;
}

async function readMeshes(glb) {
  const { json, bin } = parseGlb(glb);
  const rtc = json.extensions?.CESIUM_RTC?.center ?? [0, 0, 0];
  const out = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const ext = prim.extensions?.KHR_draco_mesh_compression;
      if (!ext) throw new Error('only Draco-compressed b3dm is supported for now');
      const bv = json.bufferViews[ext.bufferView];
      const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
      out.push(await decodeDraco(bytes, ext.attributes));
    }
  }
  return { rtc, meshes: out };
}

// ---------------------------------------------------------------- geodesy (WGS84)

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const B = A * (1 - F);
const EP2 = (A * A - B * B) / (B * B);

function ecefToGeodetic(x, y, z) {
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * B);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  const h = p / Math.cos(lat) - N;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI, h];
}

// ---------------------------------------------------------------- footprint extraction

/** LOD1（角柱）の屋根面の三角形から、境界辺をつないでリングを復元する */
function extractFootprint(tris, verts) {
  // verts: [lon, lat, h] の配列。局所平面（m）に投影して処理する
  const lat0 = (verts[tris[0][0]][1] * Math.PI) / 180;
  const mx = (Math.PI / 180) * A * Math.cos(lat0);
  const my = (Math.PI / 180) * A;
  const ref = verts[tris[0][0]];
  const local = (i) => [(verts[i][0] - ref[0]) * mx, (verts[i][1] - ref[1]) * my, verts[i][2]];

  let maxH = -Infinity;
  for (const t of tris) for (const i of t) maxH = Math.max(maxH, verts[i][2]);

  // 屋根 = 水平で最上部にある三角形
  const keyOf = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`; // 2cm で溶接
  const coordOf = new Map();
  const edges = new Map(); // "a|b" -> count (向き付き)
  for (const t of tris) {
    const p = t.map(local);
    if (Math.abs(p[0][2] - maxH) > 0.3 || Math.abs(p[1][2] - maxH) > 0.3 || Math.abs(p[2][2] - maxH) > 0.3) continue;
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1];
    const area2 = ux * vy - uy * vx;
    if (Math.abs(area2) < 1e-6) continue;
    const ks = p.map(keyOf);
    if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
    t.forEach((vi, j) => coordOf.set(ks[j], verts[vi]));
    // 上から見て CCW にそろえる
    const order = area2 > 0 ? [0, 1, 2] : [0, 2, 1];
    for (let j = 0; j < 3; j++) {
      const a = ks[order[j]], b = ks[order[(j + 1) % 3]];
      const rev = `${b}|${a}`;
      if (edges.has(rev)) edges.delete(rev); // 内部辺は打ち消し合う
      else edges.set(`${a}|${b}`, true);
    }
  }
  if (edges.size < 3) return null;

  // 境界辺をつないでリングにする
  const next = new Map();
  for (const e of edges.keys()) {
    const [a, b] = e.split('|');
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const rings = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring = [start];
      let cur = next.get(start).pop();
      let guard = 0;
      while (cur !== start && guard++ < 100000) {
        ring.push(cur);
        const outs = next.get(cur);
        if (!outs?.length) break;
        cur = outs.pop();
      }
      if (cur === start && ring.length >= 3) rings.push(ring.map((k) => coordOf.get(k)));
    }
  }
  if (!rings.length) return null;

  const toLocal = (c) => [(c[0] - ref[0]) * mx, (c[1] - ref[1]) * my];
  const signedArea = (ring) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = toLocal(ring[i]);
      const [x1, y1] = toLocal(ring[(i + 1) % ring.length]);
      s += x0 * y1 - x1 * y0;
    }
    return s / 2;
  };
  const simplified = rings.map((r) => simplifyRing(r, toLocal)).filter((r) => r.length >= 3);
  // 境界辺は屋根の外向きに CCW、穴は CW で出てくる
  const outers = simplified.filter((r) => signedArea(r) > 0).sort((a, b) => signedArea(b) - signedArea(a));
  const holes = simplified.filter((r) => signedArea(r) < 0);
  if (!outers.length) return null;
  const polys = outers.map((o) => [o]);
  for (const h of holes) {
    const target = polys.find((p) => pointInRing(toLocal(h[0]), p[0].map(toLocal))) ?? polys[0];
    target.push(h);
  }
  const close = (r) => [...r, r[0]].map((c) => [round(c[0], 7), round(c[1], 7)]);
  const coords = polys.map((p) => p.map(close));
  return {
    geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords },
    roofHeight: maxH,
  };
}

/** ほぼ一直線の頂点と極端に短い辺を除き、壁セグメントの分断を防ぐ */
function simplifyRing(ring, toLocal) {
  let pts = ring;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = toLocal(pts[(i - 1 + pts.length) % pts.length]);
      const b = toLocal(pts[i]);
      const c = toLocal(pts[(i + 1) % pts.length]);
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const bcx = c[0] - b[0], bcy = c[1] - b[1];
      const lab = Math.hypot(abx, aby), lbc = Math.hypot(bcx, bcy);
      const cross = (abx * bcy - aby * bcx) / (lab * lbc || 1);
      if (lab < 0.05 || Math.abs(cross) < 0.02) {
        changed = true;
        continue;
      }
      out.push(pts[i]);
    }
    if (out.length < 3) break;
    pts = out;
  }
  return pts;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- properties

function pickProperties(bt, i) {
  const props = {};
  for (const k of KEEP_TOP_LEVEL) {
    const v = bt[k]?.[i];
    if (v !== undefined && v !== null) props[k] = v;
  }
  // コード値や詳細用途はネストした attributes にしかない
  const attrs = bt.attributes?.[i];
  const a = typeof attrs === 'string' ? JSON.parse(attrs) : attrs;
  if (a) {
    if (a['bldg:usage_code'] != null) props['bldg:usage_code'] = a['bldg:usage_code'];
    if (a['bldg:class_code'] != null) props['bldg:class_code'] = a['bldg:class_code'];
    const detail = a['uro:BuildingDetailAttribute']?.[0];
    if (detail) {
      for (const k of ['uro:detailedUsage', 'uro:detailedUsage_code', 'uro:fireproofStructureType_code', 'uro:buildingStructureType', 'uro:buildingStructureType_code']) {
        if (detail[k] != null) props[`uro:BuildingDetailAttribute_${k}`] = detail[k];
      }
    }
    for (const kv of a['uro:KeyValuePairAttribute'] ?? []) {
      if (kv['uro:key'] === '建物構造コード') props['uro:KeyValuePairAttribute_建物構造コード'] = kv['uro:codeValue'];
    }
  }
  return props;
}

// ---------------------------------------------------------------- main

async function main() {
  const ds = await resolveDataset(datasetId);
  console.log(`${ds.name}  (${ds.year}, spec ${ds.spec}, LOD${ds.lod})`);
  const base = ds.url.slice(0, ds.url.lastIndexOf('/') + 1);
  const tileset = JSON.parse((await fetchCached(ds.url, path.join(rawDir, 'tileset.json'))).toString('utf8'));
  const leaves = leafContents(tileset.root);
  console.log(`${leaves.length} leaf tiles`);

  const features = new Map();
  let skipped = 0;
  for (const uri of leaves) {
    const buf = await fetchCached(new URL(uri, base).href, path.join(rawDir, uri));
    const { length, batchTable, glb } = parseB3dm(buf);
    const { rtc, meshes } = await readMeshes(glb);

    for (const { indices, position, batchId } of meshes) {
      // glTF は Y-up。3D Tiles の規約で Z-up（ECEF）に戻す: (x, y, z) -> (x, -z, y)
      const n = position.length / 3;
      const geo = new Array(n);
      for (let i = 0; i < n; i++) {
        geo[i] = ecefToGeodetic(rtc[0] + position[i * 3], rtc[1] - position[i * 3 + 2], rtc[2] + position[i * 3 + 1]);
      }
      const trisByBatch = new Map();
      for (let t = 0; t < indices.length; t += 3) {
        const bid = Math.round(batchId[indices[t]]);
        if (!trisByBatch.has(bid)) trisByBatch.set(bid, []);
        trisByBatch.get(bid).push([indices[t], indices[t + 1], indices[t + 2]]);
      }
      for (const [bid, tris] of trisByBatch) {
        if (bid < 0 || bid >= length) continue;
        const id = batchTable.gml_id?.[bid] ?? `${uri}#${bid}`;
        if (features.has(id)) continue; // タイルをまたぐ重複を除去
        const fp = extractFootprint(tris, geo);
        if (!fp) {
          skipped++;
          continue;
        }
        features.set(id, { type: 'Feature', id, properties: pickProperties(batchTable, bid), geometry: fp.geometry });
      }
    }
    console.log(`  ${uri}: ${length} features (total ${features.size})`);
  }

  const fc = {
    type: 'FeatureCollection',
    metadata: {
      source: 'PLATEAU',
      datasetId,
      name: ds.name,
      year: ds.year,
      spec: ds.spec,
      url: ds.url,
      license: 'PLATEAU Policy (CC BY 4.0 互換) / 出典: 国土交通省 Project PLATEAU',
    },
    features: [...features.values()],
  };
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(fc));
  const stat = await fs.stat(outFile);
  console.log(`wrote ${path.relative(ROOT, outFile)}: ${fc.features.length} buildings, ${(stat.size / 1e6).toFixed(1)} MB (skipped ${skipped})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
